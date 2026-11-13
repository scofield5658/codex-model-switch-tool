import {test,expect} from '@playwright/test';

// MCP Apps run inside a sandbox. Native confirm() is unavailable without allow-modals.
async function sandbox(page){
 await page.setContent('<iframe title="Plugin" sandbox="allow-scripts allow-same-origin" src="http://127.0.0.1:43187" style="width:100%;height:850px;border:0"></iframe>');
 const app=page.frameLocator('iframe');
 await expect(app.locator('.provider')).toHaveCount(4);
 return app;
}

test('delete works in sandbox, can cancel and reset, and does not save automatically',async({page})=>{
 let writes=0;
 page.on('request',r=>{if(r.url().endsWith('/api/provider_save'))writes++;});
 const app=await sandbox(page);
 const provider=app.locator('[data-id="kimi-code-plan-cn"]');
 await provider.getByRole('button',{name:'删除',exact:true}).click();
 const dialog=app.getByRole('dialog');
 await expect(dialog).toBeVisible();
 await expect(dialog).toContainText('Kimi Code');
 await dialog.getByRole('button',{name:'取消',exact:true}).click();
 await expect(provider).toBeVisible();
 await provider.getByRole('button',{name:'删除',exact:true}).click();
 await dialog.getByRole('button',{name:'确认删除',exact:true}).click();
 await expect(provider).toHaveCount(0);
 await expect(app.locator('#draft-state')).toContainText('有未保存修改');
 expect(writes).toBe(0);
 await app.getByRole('button',{name:'重置',exact:true}).click();
 await expect(provider).toBeVisible();
});

test('deleting the current default explains how to proceed inside the dialog',async({page})=>{
 const app=await sandbox(page);
 const provider=app.locator('[data-id="kimi-code-plan-cn"]');
 await provider.getByRole('button',{name:'设为默认',exact:true}).click();
 await provider.getByRole('button',{name:'删除',exact:true}).click();
 const dialog=app.getByRole('dialog');
 await expect(dialog).toBeVisible();
 await expect(dialog).toContainText('请先选择其他默认提供商');
 await expect(dialog.getByRole('button',{name:'确认删除',exact:true})).toBeDisabled();
 await expect(provider).toHaveCount(1);
 expect(await app.locator('#draft-state').innerText()).toContain('有未保存修改');
});

test('sandbox deletion persists only after explicit save',async({page})=>{
 const app=await sandbox(page);
 await app.locator('#add').click();
 await app.locator('#new-id').fill('sandbox-delete-demo');
 await app.locator('#new-name').fill('Disposable test provider');
 await app.locator('#confirm-add').click();
 await app.getByLabel('接入地址').fill('https://example.invalid/v1');
 await app.locator('#save').click();
 await expect(app.locator('#messages')).toContainText('已保存');
 await app.locator('#reload').click();
 const provider=app.locator('[data-id="sandbox-delete-demo"]');
 await expect(provider).toBeVisible();
 await provider.getByRole('button',{name:'删除',exact:true}).click();
 await app.getByRole('dialog').getByRole('button',{name:'确认删除',exact:true}).click();
 await expect(provider).toHaveCount(0);
 const saved=page.waitForResponse(r=>r.url().endsWith('/api/provider_save')&&r.status()===200);
 await app.locator('#save').click();
 const result=await (await saved).json();
 expect(result.ok).toBe(true);
 expect(result.data.providers.some(p=>p.id==='sandbox-delete-demo')).toBe(false);
 await app.locator('#reload').click();
 await expect(app.locator('#messages')).toContainText('已重新加载');
 await expect(provider).toHaveCount(0);
});

test('delete dialog keeps shared-reference warning across host language changes and Escape cancels',async({page})=>{
 await page.route('**/api/provider_read',async route=>{
  const response=await route.fetch();const json=await response.json();
  json.data.providers[0].referencedElsewhere=true;
  await route.fulfill({json});
 });
 await page.setViewportSize({width:400,height:900});
 const app=await sandbox(page);
 const provider=app.locator('[data-id="kimi-code-plan-cn"]');
 await provider.getByRole('button',{name:'删除',exact:true}).click();
 const dialog=app.getByRole('dialog');
 await expect(dialog).toContainText('其他配置引用了此提供商');
 for(const [locale,label] of [['en-US','Confirm deletion'],['zh-TW','確認刪除']]){
  await app.locator('#app').evaluate((_,locale)=>window.dispatchEvent(new CustomEvent('fixture:host-context',{detail:{locale}})),locale);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button',{name:label,exact:true})).toBeEnabled();
 }
 const box=await dialog.boundingBox();expect(box.width).toBeLessThanOrEqual(400);
 await page.screenshot({path:'docs/preview-delete-dialog.png'});
 await dialog.press('Escape');
 await expect(dialog).not.toBeVisible();
 await expect(provider).toBeVisible();
});
