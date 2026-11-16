async page => {
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.getByLabel('本地上下文长度',{exact:true}).fill('8192');
  await page.getByRole('button',{name:'保存设置',exact:true}).click();
  await page.getByRole('status').filter({hasText:'设置已保存'}).waitFor();
  const configured=await page.evaluate(()=>window.studio.invoke('state'));
  if(String(configured.settings.provider.textContextTokens)!=='8192')throw new Error('本地上下文设置未保存');
  await page.screenshot({path:'output/playwright/desktop-local-context-saved.png'});
  await page.getByRole('button',{name:'菜单',exact:true}).click();
  await page.getByRole('button',{name:'任务中心',exact:true}).click();
  await page.getByRole('row').filter({hasText:'桌面功能验收 · 首帧与营销'}).getByRole('button',{name:'继续创作',exact:true}).click();
  await page.locator('.steps>button').nth(0).click();
  await page.getByRole('button',{name:'营销文案',exact:true}).click();
  await page.getByLabel('产品名称',{exact:true}).fill('');
  await page.getByLabel('产品卖点',{exact:true}).fill('抽屉分层放置文具和小物件；购买前测量桌面空间，不承诺适合所有桌型。');
  await page.getByLabel('自定义字数',{exact:true}).fill('137');
  const started=Date.now();
  await page.getByRole('button',{name:'生成文案',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('.operation-status')&&document.querySelector('textarea[aria-label="营销文案"]')?.value.length>10,{},{timeout:60000});
  const text=await page.getByLabel('营销文案',{exact:true}).inputValue();
  await page.screenshot({path:'output/playwright/desktop-selling-only-generated.png'});
  const state=await page.evaluate(()=>window.studio.invoke('state'));
  const run=state.runs.find(r=>r.type==='marketing'&&r.status==='succeeded'&&r.output?.text===text);
  if(!run||run.snapshot.marketing.name||run.snapshot.wordLimit!=='137')throw new Error('营销真实执行快照不匹配');
  const report={checkedAt:new Date().toISOString(),runtime:'Electron',elapsedMs:Date.now()-started,contextTokens:state.settings.provider.textContextTokens,requestedWords:137,onlySelling:true,text,runId:run.id,pageErrors:errors,scope:'真实桌面配置本地上下文、仅卖点生成；文案仍需事实与质量审查，不保证精确字数或与原厂结果一致'};
  await page.evaluate(report=>window.studio.invoke('importFile',{name:'营销桌面真实生成验证.json',base64:btoa(unescape(encodeURIComponent(JSON.stringify(report,null,2))))}),report);
  if(errors.length)throw new Error(errors.join('\n'));
  return report;
}
