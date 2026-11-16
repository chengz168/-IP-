// 经现有剪辑按钮重剪同一真实上游，不重交配音或口型，不覆盖首次失败证据。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('C:/Users/DELL/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core');
const {digest}=require('../integrations/musetalk-local/input.cjs');
const base=path.resolve('evidence/validation/local-full-workflow-20261115'),root=path.join(base,'unity-audio');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8')),write=(name,value)=>fs.writeFileSync(path.join(root,name),JSON.stringify(value,null,2),{flag:'wx'});
async function main(){
 fs.mkdirSync(root,{recursive:true});assert(!fs.existsSync(path.join(root,'generated.json')),'已有重剪结果，不重复收集');
 const collectOnly=process.argv[2]==='collect';assert(collectOnly||!fs.existsSync(path.join(root,'intent.json')),'已有重剪意图，禁止重复点击');
 const previous=read(path.join(base,'generated.json')),browser=await chromium.connectOverCDP('http://127.0.0.1:9351');
 try{
  const page=browser.contexts()[0].pages()[0],call=(action,payload={})=>page.evaluate(({action,payload})=>window.studio.invoke(action,payload),{action,payload});
  const before=await call('state');assert(!before.runs.some(r=>['running','queued','unknown'].includes(r.status)));
  if(!collectOnly){
   await call('selectDraft',{id:previous.draft.id});await page.reload();await page.locator('.steps>button').nth(4).click();
   write('intent.json',{at:new Date().toISOString(),draftId:previous.draft.id,oldRenderId:previous.outputs.render.id,oldRunIds:before.runs.map(r=>r.id),firstMediaInspectionFailed:true});
   await page.getByRole('button',{name:'剪辑视频',exact:true}).click();
  }
  const intent=read(path.join(root,'intent.json'));
  const start=Date.now();let state,run;
  while(Date.now()-start<120000){state=read('evidence/validation/musetalk-integration-20261115/workspace/studio.json');run=state.runs.find(r=>r.type==='render'&&r.draftId===previous.draft.id&&!intent.oldRunIds.includes(r.id));if(run&&!['running','queued'].includes(run.status))break;await new Promise(r=>setTimeout(r,400));}
  assert.equal(run?.status,'succeeded',run?.error||'原重剪任务尚未完成，禁止重交');
  const draft=state.drafts.find(d=>d.id===previous.draft.id);assert.notEqual(draft.edit.resultId,previous.outputs.render.id);
  const render=state.assets.find(a=>a.id===draft.edit.resultId);assert.equal(render.id,run.output.id);
  const file=path.join(root,'render.mp4');fs.copyFileSync(render.path,file,fs.constants.COPYFILE_EXCL);
  const outputs={...previous.outputs,render:{...render,reviewFile:file,sha256:digest(file)}};
  write('generated.json',{...previous,at:new Date().toISOString(),draft,outputs,runs:[...previous.runs,run],audioRepair:{runId:run.id,originalRenderId:previous.outputs.render.id,originalJobId:previous.job.id,upstreamRegenerated:false,actualEditButton:true,firstAttemptFailedMediaCheck:true}});
  console.log(JSON.stringify({runId:run.id,file,upstreamRegenerated:false}));
 }finally{await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
