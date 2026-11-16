// 通过真实产品按钮识别和剪辑，所有提交有独立记录，观察超时不重交。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('C:/Users/DELL/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core');
const root=path.resolve(__dirname,'../evidence/validation/caption-phrases-C-20261116');
const read=name=>JSON.parse(fs.readFileSync(path.join(root,name),'utf8'));
const write=(name,value)=>fs.writeFileSync(path.join(root,name),JSON.stringify(value,null,2),{flag:'wx'});
const mode=process.argv[2];
async function main(){
 const browser=await chromium.connectOverCDP('http://127.0.0.1:9372');
 try{
  const page=browser.contexts()[0].pages()[0],prepared=read('prepared.json');
  await page.waitForFunction(()=>window.studio&&document.querySelector('.steps'));
  const call=(action,payload={})=>page.evaluate(({action,payload})=>window.studio.invoke(action,payload),{action,payload});
  const state=await call('state'),draft=state.drafts.find(d=>d.id===prepared.draftId);
  assert.equal(state.currentId,prepared.draftId);
  if(mode==='inspect'){
   console.log(JSON.stringify({body:(await page.locator('body').innerText()).slice(-4200),buttons:await page.getByRole('button').allTextContents(),videos:await page.locator('video').evaluateAll(nodes=>nodes.map(n=>({label:n.getAttribute('aria-label'),source:n.currentSrc})))}));return;
  }
  if(mode==='status'){
   console.log(JSON.stringify({runs:state.runs.map(r=>({id:r.id,type:r.type,status:r.status,error:r.error,progress:r.progress})),captions:draft.edit.captions,resultId:draft.edit.resultId}));return;
  }
  if(mode==='asr'){
   assert.equal(state.runs.length,0,'已有任务时不重交识别');
   write('transcribe-submission.json',{at:new Date().toISOString(),draftId:draft.id,sourceId:draft.edit.sourceId,beforeRunIds:state.runs.map(r=>r.id),throughProductButton:true});
   await page.getByRole('button',{name:'生成字幕',exact:true}).click();
   fs.appendFileSync(path.join(root,'submission-events.jsonl'),JSON.stringify({at:new Date().toISOString(),type:'transcribe',clicked:true})+'\n');
   console.log(JSON.stringify({submitted:true,type:'transcribe'}));return;
  }
  if(mode==='asr-result'){
   const run=state.runs.find(r=>r.type==='transcribe');assert(run,'没有已提交的识别任务');
   assert.equal(run.status,'succeeded',run.error||'原识别任务尚未成功，继续查询原任务');
   assert(draft.edit.captions.some(row=>row.text==='走一走，'));
   assert(draft.edit.captions.some(row=>row.text==='几分钟，'));
   const {recognitionRows,recognitionOptions}=await import('../server/caption-recognition.mjs'),{alignRowsToReference}=await import('../src/caption-script.mjs');
   const expected=alignRowsToReference(recognitionRows(run.output,prepared.source.duration,recognitionOptions(draft.edit)),prepared.text);
   assert.deepEqual(draft.edit.captions,expected);
   const words=run.output.segments.flatMap(row=>row.words),starts=new Set(words.map(w=>w.start)),ends=new Set(words.map(w=>w.end));
   assert(expected.every(row=>starts.has(row.start)&&ends.has(row.end)),'字幕时间必须来自实际识别词边界');
   write('recognition-result.json',{at:new Date().toISOString(),runId:run.id,rawRecognition:run.output,captions:expected,wordBoundariesPreserved:true,manualAndSharedAlgorithmMatch:true,newSpeechGenerated:false,newLipSyncGenerated:false});
   await page.screenshot({path:path.join(root,'recognized.png')});
   console.log(JSON.stringify({runId:run.id,captions:expected}));return;
  }
  if(mode==='render'){
   assert.equal(state.runs.filter(run=>run.type==='render').length,0,'已有剪辑任务时不重交');
   assert(fs.existsSync(path.join(root,'recognition-result.json')));
   const dialog=page.getByRole('dialog',{name:'编辑字幕',exact:true});
   if(await dialog.count()){await dialog.getByRole('button',{name:'确定',exact:true}).click();await dialog.waitFor({state:'hidden'});}
   await page.evaluate(()=>{if(!window.__phrasePageErrors){window.__phrasePageErrors=[];window.addEventListener('error',event=>window.__phrasePageErrors.push(event.message));window.addEventListener('unhandledrejection',event=>window.__phrasePageErrors.push(String(event.reason)));}});
   write('render-submission.json',{at:new Date().toISOString(),draftId:draft.id,captions:draft.edit.captions,throughProductButton:true});
   await page.getByRole('button',{name:'剪辑视频',exact:true}).click();
   fs.appendFileSync(path.join(root,'submission-events.jsonl'),JSON.stringify({at:new Date().toISOString(),type:'render',clicked:true})+'\n');
   console.log(JSON.stringify({submitted:true,type:'render'}));return;
  }
  throw Error('未知模式');
 }finally{await browser.close()}
}
main().catch(error=>{fs.appendFileSync(path.join(root,'desktop-errors.jsonl'),JSON.stringify({at:new Date().toISOString(),mode,error:error.stack})+'\n');console.error(error);process.exitCode=1});
