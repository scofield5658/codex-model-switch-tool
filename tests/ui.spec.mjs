import { test, expect } from '@playwright/test';
test('side panel uses compact rows and keeps its scroll viewport above the composer',async({page})=>{
 await page.setViewportSize({width:613,height:794});
 await page.goto('http://127.0.0.1:43187');
 await expect(page.locator('.provider')).toHaveCount(4);
 const rows=await page.locator('.provider').evaluateAll(elements=>elements.map(e=>({
  height:e.getBoundingClientRect().height,
  titleSize:parseFloat(getComputedStyle(e.querySelector('h2')).fontSize),
  buttonHeight:e.querySelector('button').getBoundingClientRect().height
 })));
 for(const row of rows){
  expect(row.height).toBeLessThanOrEqual(82);
  expect(row.titleSize).toBeLessThanOrEqual(14);
  expect(row.buttonHeight).toBeLessThanOrEqual(30);
 }
 const viewport=await page.locator('#app').boundingBox();
 expect(viewport.y+viewport.height).toBeLessThanOrEqual(794-102);
 await page.getByRole('button',{name:'编辑',exact:true}).first().click();
 await page.locator('#app').evaluate(e=>e.scrollTop=e.scrollHeight);
 const add=await page.locator('#add').boundingBox();
 expect(add.y+add.height).toBeLessThanOrEqual(viewport.y+viewport.height);
});
test('blank saved key and reset do not change stored credential',async({page})=>{
  await page.goto('http://127.0.0.1:43187');
  await page.getByRole('button',{name:'编辑',exact:true}).first().click();
  await expect(page.getByLabel('API Key')).toHaveValue('');
  await page.getByLabel('API Key').fill('unsaved-key');
  await page.getByRole('button',{name:'重置',exact:true}).click();
  await expect(page.getByLabel('API Key')).toHaveValue('');
  await page.getByLabel('接入地址').fill('https://changed.example/v1');
  await page.getByRole('button',{name:'重置',exact:true}).click();
  await expect(page.getByLabel('接入地址')).toHaveValue('https://api.kimi.com/coding/v1');
  await expect(page.getByRole('button',{name:'测试连接'})).toBeDisabled();
  await page.getByRole('button',{name:'保存',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('已保存');
});
test('raw validation prevents save and restart dialog does not auto-restart',async({page})=>{
  await page.goto('http://127.0.0.1:43187');
  await page.getByRole('button',{name:'编辑',exact:true}).first().click();
  await page.getByText('Raw Data').click();
  await page.getByLabel('高级配置 JSON').fill('{broken');
  await page.getByRole('button',{name:'保存',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('JSON');
  await page.getByRole('button',{name:'重置',exact:true}).click();
  await page.getByRole('button',{name:'保存并重启'}).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('button',{name:'确认保存并重启'})).toBeDisabled();
});
test('responsive layout fits desktop and narrow views',async({page,browser})=>{
 await page.goto('http://127.0.0.1:43187');
 await page.getByRole('button',{name:'编辑',exact:true}).first().click();
 await page.screenshot({path:'docs/preview-desktop.png',fullPage:true});
 const narrow=await browser.newPage({viewport:{width:375,height:812}});
 await narrow.goto('http://127.0.0.1:43187');
 await narrow.getByRole('button',{name:'编辑',exact:true}).first().click();
 await expect(narrow.getByLabel('API Key')).toBeVisible();
 expect(await narrow.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
 await narrow.screenshot({path:'docs/preview-mobile.png'});
 await narrow.close();
});
test('editing invalidates visible health status and pending request freezes input',async({page})=>{
 await page.goto('http://127.0.0.1:43187');
 await page.getByRole('button',{name:'编辑',exact:true}).first().click();
 await page.getByText('Raw Data').click();
 await page.getByRole('button',{name:'填入连接测试示例'}).click();
 await page.route('**/api/provider_health',async route=>{
  await new Promise(r=>setTimeout(r,250));
  await route.fulfill({json:{ok:true,data:{ok:true,elapsedMs:12,message:'检查成功'}}});
 });
 await page.getByRole('button',{name:'测试连接'}).click();
 await expect(page.getByLabel('API Key')).toBeDisabled();
 await expect(page.locator('.dot')).toHaveCount(1);
 await page.getByLabel('API Key').fill('new-draft-key');
 await expect(page.locator('.dot')).toHaveCount(0);
 await expect(page.getByRole('status')).toHaveCount(0);
});

test('configuration name is an inline field with reset and save',async({page})=>{
 await page.goto('http://127.0.0.1:43187');
 await page.getByRole('button',{name:'编辑',exact:true}).first().click();
 const name=page.getByLabel('配置名称',{exact:true});
 await expect(name).toBeVisible();
 const original=await name.inputValue();
 await name.fill('临时名称');
 await expect(page.getByRole('heading',{name:'临时名称',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'重置',exact:true}).click();
 await expect(name).toHaveValue(original);
 await name.fill('保存的名称');
 await page.getByRole('button',{name:'保存',exact:true}).click();
 await expect(page.getByRole('status')).toContainText('已保存');
 await page.reload();
 await page.getByRole('button',{name:'编辑',exact:true}).first().click();
 await expect(name).toHaveValue('保存的名称');
 await expect(page.getByLabel('API Key')).toHaveValue('');
 await expect(page.getByLabel('API Key')).toHaveAttribute('placeholder','留空保留已保存密钥');
 await name.fill(original);
 await page.getByRole('button',{name:'保存',exact:true}).click();
 await expect(page.getByRole('status')).toContainText('已保存');
});

test('save controls stay reachable above a floating host composer while scrolling',async({page})=>{
 for(const width of [1100,613,375]){
  await page.setViewportSize({width,height:794});
  await page.goto('http://127.0.0.1:43187');
  await page.getByRole('button',{name:'编辑',exact:true}).first().click();
  // Reproduce the host overlay from the reported screenshot, without using real settings.
  await page.evaluate(()=>{
   const composer=document.createElement('div');composer.id='fixture-composer';
   composer.style.cssText='position:fixed;bottom:12px;left:8%;width:84%;height:90px;z-index:100;background:#333;border-radius:24px';
   composer.textContent='宿主输入框（测试）';document.body.append(composer);
  });
  for(const scroll of [0,500,10000]){
   await page.locator('#app').evaluate((e,y)=>e.scrollTo(0,y),scroll);
   for(const id of ['reset','save','restart']){
    const position=await page.locator('#'+id).evaluate(button=>{
     const r=button.getBoundingClientRect();
     const top=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
     return {top:r.top,bottom:r.bottom,reachable:button===top||button.contains(top)};
    });
    expect(position.top).toBeGreaterThanOrEqual(0);
    expect(position.bottom).toBeLessThan(220);
    expect(position.reachable).toBe(true);
   }
  }
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
 }
});

test('host typography, theme and safe areas follow later context changes',async({page})=>{
 await page.goto('http://127.0.0.1:43187');
 await page.getByRole('button',{name:'编辑',exact:true}).first().click();
 await page.evaluate(()=>window.dispatchEvent(new CustomEvent('fixture:host-context',{detail:{
  theme:'light',
  styles:{variables:{'--font-text-md-size':'12px','--font-text-sm-size':'11px','--font-heading-xs-size':'17px','--color-background-primary':'rgb(250, 250, 250)','--font-weight-normal':'430'}},
  safeAreaInsets:{top:12,right:16,bottom:180,left:16}
 }})));
 await expect(page.getByLabel('配置名称',{exact:true})).toHaveCSS('font-size','11px');
 await expect(page.getByLabel('配置名称',{exact:true})).toHaveCSS('font-weight','430');
 await expect(page.locator('h1')).toHaveCSS('font-size','17px');
 await expect(page.locator('.toolbar')).toHaveCSS('background-color','rgb(250, 250, 250)');
 await expect(page.locator('body')).toHaveCSS('padding-left','16px');
 await expect(page.locator('#app')).toHaveCSS('height','708px');
 await page.evaluate(()=>window.dispatchEvent(new CustomEvent('fixture:host-context',{detail:{
  safeAreaInsets:{top:24,right:0,bottom:220,left:0}
 }})));
 await expect(page.locator('body')).toHaveCSS('padding-left','0px');
 await expect(page.locator('body')).toHaveCSS('padding-top','24px');
 await expect(page.locator('#app')).toHaveCSS('height','656px');
});
test('model refresh stays in place and custom picker supports keyboard selection',async({page})=>{
 await page.goto('http://127.0.0.1:43187');
 await page.getByRole('button',{name:'编辑',exact:true}).first().click();
 await expect(page.locator('#cancel')).toHaveCount(0);
 await page.route('**/api/provider_models',async route=>{await new Promise(r=>setTimeout(r,300));await route.fulfill({json:{ok:true,data:{models:[{id:'k3'},{id:'k3-pro'}],checkedAt:'now'}}});});
 const button=page.getByRole('button',{name:'刷新模型',exact:true});
 const before=await page.locator('.provider').nth(1).boundingBox();
 await button.click();await expect(button).toHaveAttribute('aria-busy','true');
 await expect(button).not.toHaveAttribute('aria-busy','true');
 expect(await page.locator('.provider').nth(1).boundingBox()).toEqual(before);
 await expect(page.locator('#messages')).toBeEmpty();
 await page.getByRole('button',{name:'展开模型列表'}).click();
 await expect(page.getByRole('option',{name:'k3-pro',exact:true})).toBeVisible();
 await page.getByLabel('默认模型',{exact:true}).press('ArrowDown');
 await page.getByLabel('默认模型',{exact:true}).press('ArrowDown');
 await page.getByLabel('默认模型',{exact:true}).press('Enter');
 await expect(page.getByLabel('默认模型',{exact:true})).toHaveValue('k3-pro');
});

async function hostLocale(page,locale){
 await page.evaluate(locale=>window.dispatchEvent(new CustomEvent('fixture:host-context',{detail:{locale}})),locale);
}
test('initial configuration failure can be retried inside the page without reloading or writing',async({page})=>{
 let reads=0,writes=0;
 await page.route('**/api/provider_save',route=>{writes++;return route.abort();});
 await page.route('**/api/provider_read',route=>{
  reads++;
  return reads===1?route.fulfill({json:{ok:false,errorCode:'pythonSetupFailed'}}):route.continue();
 });
 await page.goto('http://127.0.0.1:43187');
 await expect(page.getByRole('alert')).toBeVisible();
 await page.getByRole('button',{name:'重试',exact:true}).click();
 await expect(page.locator('.providers')).toBeVisible();
 await expect(page.getByRole('alert')).toHaveCount(0);
 expect(reads).toBe(2);expect(writes).toBe(0);
});

test('slow first configuration read stays in loading state until data arrives',async({page})=>{
 let release;
 const waiting=new Promise(resolve=>{release=resolve;});
 await page.route('**/api/provider_read',async route=>{await waiting;await route.continue();});
 await page.goto('http://127.0.0.1:43187');
 await expect(page.locator('.loading')).toBeVisible();
 await expect(page.getByRole('alert')).toHaveCount(0);
 release();
 await expect(page.locator('.providers')).toBeVisible();
});
test('host locale initializes all three languages and uses deterministic fallbacks',async({page})=>{
 for(const [locale,title,lang] of [['en-US','Custom Model Settings','en'],['zh-CN','自定义模型配置','zh-Hans'],['zh-TW','自訂模型設定','zh-Hant'],['zh-HK','自訂模型設定','zh-Hant'],['zh-Hans-TW','自定义模型配置','zh-Hans'],['fr-FR','Custom Model Settings','en']]){
  await page.addInitScript(locale=>window.__fixtureLocale=locale,locale);
  await page.goto('http://127.0.0.1:43187');
  await expect(page.locator('h1')).toHaveText(title);
  await expect(page.locator('html')).toHaveAttribute('lang',lang);
  await expect(page).toHaveTitle(title);
  await expect(page.locator('#draft-state')).toBeEmpty();
 }
});
test('changing host language preserves drafts, raw JSON, focus, caret, dialog and checkbox state',async({page})=>{
 await page.goto('http://127.0.0.1:43187');
 await page.locator('[data-action=edit]').first().click();
 await page.locator('[data-field=name]').fill('保存'); // A user name that matches a translated UI label must stay intact.
 await page.locator('[data-field=key]').fill('fixture-unsaved-key');
 await page.getByText('Raw Data').click();
 const raw=page.locator('[data-field=raw]');await raw.fill('{unfinished');await raw.press('ArrowLeft');
 const caret=await raw.evaluate(e=>e.selectionStart);
 await hostLocale(page,'en-US');
 await expect(raw).toBeFocused();expect(await raw.evaluate(e=>e.selectionStart)).toBe(caret);
 await expect(raw).toHaveValue('{unfinished');await expect(page.locator('details')).toHaveAttribute('open','');
 await expect(page.locator('[data-field=key]')).toHaveValue('fixture-unsaved-key');
 await expect(page.locator('[data-field=name]')).toHaveValue('保存');
 await expect(page.locator('#draft-state')).toHaveText('Unsaved changes');
 await page.locator('#add').click();await page.locator('#new-name').fill('My draft');
 await hostLocale(page,'zh-TW');
 await expect(page.locator('#add-dialog')).toBeVisible();await expect(page.locator('#new-name')).toHaveValue('My draft');
 await expect(page.locator('#new-name')).toBeFocused();await page.locator('#dismiss-add').click();
 await page.locator('#restart').click();await page.locator('#idle').check();
 await hostLocale(page,'en');await expect(page.locator('#idle')).toBeChecked();await expect(page.locator('#confirm-restart')).toBeEnabled();
 await page.locator('#dismiss-restart').click();await page.locator('#save').click();
 await expect(page.getByRole('alert')).toContainText('Invalid Raw Data JSON');
 await hostLocale(page,'zh-TW');await expect(page.getByRole('alert')).toContainText('格式錯誤');
});
test('backend validation codes translate and refresh remains stable during a locale change',async({page})=>{
 await page.goto('http://127.0.0.1:43187');await hostLocale(page,'en');
 await page.locator('[data-action=edit]').first().click();await page.locator('[data-field=name]').fill('');
 await page.locator('#save').click();await expect(page.getByRole('alert')).toContainText('Name is required.');
 await hostLocale(page,'zh-TW');await expect(page.getByRole('alert')).toContainText('名稱不能為空');
 await page.locator('#reset').click();
 await page.route('**/api/provider_models',async route=>{await new Promise(r=>setTimeout(r,500));await route.fulfill({json:{ok:false,errorCode:'httpError',errorParams:{status:401},error:'服務錯誤'}});});
 const button=page.locator('[data-action=models]');await button.click();await hostLocale(page,'en');
 await expect(button).toHaveAttribute('aria-busy','true');await expect(button).toHaveText('Refresh models');
 await expect(button).not.toHaveAttribute('aria-busy','true');await expect(button).toHaveAttribute('title',/HTTP 401/);
 await hostLocale(page,'zh-TW');await expect(button).toHaveAttribute('title',/服務回傳 HTTP 401/);
 await expect(page.locator('#messages')).toBeEmpty();
 await page.unroute('**/api/provider_models');
 await page.route('**/api/provider_models',route=>route.fulfill({json:{ok:false,error:'服务返回 HTTP 403；请检查地址、凭证及模型权限。'}}));
 await button.click();await expect(button).toHaveAttribute('title',/服務回傳 HTTP 403/);
});
test('translated layouts fit narrow screens and screenshots show all three languages',async({page})=>{
 await page.goto('http://127.0.0.1:43187');
 await expect(page.locator('.provider')).toHaveCount(4);
 for(const locale of ['en','zh-CN','zh-TW']){
  await hostLocale(page,locale);
  await page.setViewportSize({width:613,height:794});
  await page.screenshot({path:`docs/i18n-${locale}.png`});
  await page.locator('[data-action=edit]').first().click();
  await page.setViewportSize({width:375,height:812});
  expect(await page.evaluate(()=>document.querySelector('#app').scrollWidth)).toBeLessThanOrEqual(375);
  await page.locator('#add').click();
  expect((await page.locator('#add-dialog').boundingBox()).width).toBeLessThanOrEqual(375);
  await page.locator('#dismiss-add').click();
  await page.locator('[data-action=edit]').first().click();
 }
});
