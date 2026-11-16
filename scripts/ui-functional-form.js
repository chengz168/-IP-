async page => {
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const initial=await page.evaluate(()=>window.studio.invoke('state'));
  await page.getByLabel('字数限制',{exact:true}).selectOption('custom');
  if(await page.getByLabel('自定义字数',{exact:true}).inputValue()!=='500')throw new Error('自定义字数初值不是500');
  await page.getByLabel('自定义字数',{exact:true}).fill('137');
  await page.getByRole('button',{name:'生成文案',exact:true}).click();
  await page.getByRole('status').filter({hasText:'请至少输入产品名称或卖点'}).waitFor();
  const after=await page.evaluate(()=>window.studio.invoke('state'));
  if(initial.runs.length!==after.runs.length)throw new Error('空营销表单产生了模型执行记录');
  const saved=after.drafts.find(d=>d.id===after.currentId);
  if(saved.wordLimit!=='137')throw new Error('自定义字数未保存');
  await page.screenshot({path:'output/playwright/desktop-marketing-validation.png'});
  const report={checkedAt:new Date().toISOString(),runtime:'Electron',draftId:saved.id,customDefault:500,customSaved:saved.wordLimit,emptyMarketingRejectedBeforeRun:true,pageErrors:errors};
  await page.evaluate(report=>window.studio.invoke('importFile',{name:'营销桌面表单验证.json',base64:btoa(unescape(encodeURIComponent(JSON.stringify(report,null,2))))}),report);
  if(errors.length)throw new Error(errors.join('\n'));
  await page.locator('.steps>button').nth(5).click();
  return report;
}
