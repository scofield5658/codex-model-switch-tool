"""macOS graceful relaunch. This helper never force-kills the application."""
import json
import subprocess
import sys
import time
from pathlib import Path
from .store import ConfigError, atomic

def restart_plan(confirmed_idle,platform=None):
    if confirmed_idle is not True: raise ConfigError('重启前请确认所有窗口中的任务均已结束。')
    if (platform or sys.platform)!='darwin': raise ConfigError('当前系统请手动退出并重新启动 Codex。')
    return {'bundleId':'com.openai.codex','forceKill':False}

def schedule_restart(confirmed_idle, directory):
    restart_plan(confirmed_idle)
    subprocess.Popen([sys.executable,'-m','backend.restart',str(directory)],cwd=Path(__file__).resolve().parent.parent,
        stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True,close_fds=True)
    return {'scheduled':True,'message':'已安排正常退出并重新打开；若系统取消退出，请手动重启。'}

def run(directory, runner=subprocess.run, sleeper=time.sleep):
    log=Path(directory)/'restart-status.json'
    def record(status): atomic(log,json.dumps({'status':status,'time':time.time()}))
    sleeper(2)
    try:
        record('quitting')
        runner(['/usr/bin/osascript','-e','with timeout of 20 seconds\n tell application id "com.openai.codex" to quit\nend timeout'],check=True,timeout=25,capture_output=True)
        # Do not reopen until the previous application has actually exited.
        for _ in range(30):
            result=runner(['/usr/bin/osascript','-e','application id "com.openai.codex" is running'],check=True,timeout=5,capture_output=True,text=True)
            if result.stdout.strip()=='false': break
            sleeper(1)
        else: record('quit-not-completed'); return False
        runner(['/usr/bin/open','-b','com.openai.codex'],check=True,timeout=10,capture_output=True)
        record('launch-requested'); return True
    except (subprocess.SubprocessError,OSError):
        record('manual-restart-required'); return False

if __name__=='__main__': run(sys.argv[1])
