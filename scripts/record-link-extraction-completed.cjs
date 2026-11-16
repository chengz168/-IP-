const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('C:/Users/DELL/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core');
const directory=path.resolve('evidence/validation/local-link-extraction');
(async()=>{
 const browser=await chromium.connectOverCDP('http://127.0.0.1:9346');
 try{
  const page=browser.contexts()[0].pages()[0],state=await page.evaluate(()=>window.studio.invoke('state'));
  const cancelled=state.runs.find(run=>run.id==='2346c196-f358-479d-9764-e9ac776aae4f'),changed=state.runs.find(run=>run.id==='fd62bdef-e0e8-4e57-b26c-efaff146f1ab');
  assert.equal(cancelled.status,'cancelled');assert.equal(cancelled.output,undefined);assert.equal(changed.status,'succeeded');assert.equal(changed.parameters.sourceUrl,'http://127.0.0.1:18196/delayed.wav');
  const text=page.getByRole('textbox',{name:'原文案',exact:true});assert.equal(await text.inputValue(),'识别期间的新手写内容，必须保留。');
  assert.equal(state.drafts.find(draft=>draft.id===state.currentId).sourceText,await text.inputValue());
  assert.equal(state.runs.filter(run=>run.type==='extract').length,5);assert.equal(state.assets.filter(asset=>asset.origin==='local-link-extract').length,4);
  assert.equal(fs.readdirSync(path.join(directory,'workspace/outputs')).filter(name=>name.startsWith('.link-input-')).length,0);
  await page.reload();await text.waitFor();assert.equal(await text.inputValue(),'识别期间的新手写内容，必须保留。');
  const report={at:new Date().toISOString(),recordOnly:true,newSubmissions:0,invalidInputNoRun:true,expectedExtractRunCount:5,cancelledRunId:cancelled.id,cancelledStatus:cancelled.status,lateResultRunId:changed.id,lateResultStatus:changed.status,editedTextPreserved:true,refreshRetainsEditedText:true,downloadAssets:4,tempInputsCleaned:true,priorVerifierTimeout:'任务已完成后等待operation-status消失超过10秒；只读补核，不再次生成',publicPlatformVerified:false};
  fs.writeFileSync(path.join(directory,'faults.json'),JSON.stringify(report,null,2));await page.screenshot({path:path.join(directory,'late-result-preserved.png')});console.log(JSON.stringify(report));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
