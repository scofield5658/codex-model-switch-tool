import unittest, threading, json
from http.server import HTTPServer, BaseHTTPRequestHandler
from backend.network import discover, health
from backend.store import ConfigError

class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args): pass
    def do_GET(self):
        if self.path=='/v1/redirect':
            self.send_response(302); self.send_header('Location','http://other.invalid/models'); self.end_headers(); return
        if self.headers.get('Authorization')!='Bearer test-only-key':
            self.send_response(401); self.end_headers(); self.wfile.write(b'test-only-key echoed'); return
        self.send_response(200); self.end_headers()
        self.wfile.write(json.dumps({'data':[{'id':'k3'},{'id':'k3'},{'id':'k3-256k'}]}).encode())
    def do_POST(self):
        body=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        self.send_response(200 if body.get('model')=='k3' else 400); self.end_headers()
        self.wfile.write(b'{"object":"response","status":"completed","output":[{"content":[{"text":"ok"}]}]}')

class NetworkTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server=HTTPServer(('127.0.0.1',0),Handler)
        cls.thread=threading.Thread(target=cls.server.serve_forever,daemon=True); cls.thread.start()
    @classmethod
    def tearDownClass(cls): cls.server.shutdown(); cls.server.server_close()
    def provider(self):
        return {'id':'test','baseUrl':f'http://127.0.0.1:{self.server.server_port}/v1','model':'k3','extra':{}}
    def test_models_query_uses_auth_and_deduplicates(self):
        result=discover(self.provider(),'test-only-key')
        self.assertEqual([m['id'] for m in result['models']],['k3','k3-256k'])
        self.assertNotIn('test-only-key',json.dumps(result))
    def test_health_missing_is_not_a_network_test(self):
        with self.assertRaises(ConfigError): health(self.provider(),'test-only-key')
    def test_post_health_substitutes_selected_model(self):
        p=self.provider(); p['extra']['health']={'path':'responses','method':'POST','body':{'model':'$model','input':'ping'}}
        self.assertTrue(health(p,'test-only-key')['ok'])
    def test_redirect_and_cross_origin_are_rejected(self):
        for path in ['redirect','https://other.invalid/health','//other.invalid/health']:
            p=self.provider(); p['extra']['health']={'path':path}
            with self.assertRaises(ConfigError): health(p,'test-only-key')
    def test_error_does_not_echo_response_or_key(self):
        with self.assertRaises(ConfigError) as cm: discover(self.provider(),'invalid-key')
        self.assertNotIn('test-only-key',str(cm.exception)); self.assertIn('401',str(cm.exception))
