// 实际推理开始后通过产品停止按钮取消；不把协议夹具当真实模型取消。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('C:/Users/DELL/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core');
const root=path.resolve('evidence/validation/musetalk-multi-20261115'),write=(name,value)=>fs.writeFileSync(path.join(root,name),JSON.stringify(value,null,2),{flag:'wx'});
async function main(){
 assert(!fs.existsSync(path.join(root,'cancel-intent.json')),'已有真实取消意图，不自动重交');
 const browser=await chromium.connectOverCDP('http://127.0.0.1:9351'),page=browser.contexts()[0].pages()[0],errors=[];page.on('pageerror',e=>errors.push(e.message));
 const call=(action,payload={})=>page.evaluate(({action,payload})=>window.studio.invoke(action,payload),{action,payload});
 const poll=async(predicate,timeout)=>{const started=Date.now();while(Date.now()-started<timeout){const value=await predicate();if(value)return value;await new Promise(resolve=>setTimeout(resolve,150));}throw Error('原任务观察超时，按cancel-submitted查原ID，不重新提交');};
 try{
  const state=await call('state');assert(!state.runs.some(r=>['running','queued','unknown'].includes(r.status)));
  const source=state.drafts.find(d=>d.id===state.currentId);assert(source.video.assetId);
  const created=await call('newDraft'),draft={...structuredClone(source),id:created.id,createdAt:created.createdAt,updatedAt:created.updatedAt,title:'多镜头推理停止验证',video:{...source.video,assetId:''},edit:{...source.edit,sourceId:'',resultId:''}};
  await call('saveDraft',draft);await page.reload();await page.locator('.video-config').waitFor();
  write('cancel-intent.json',{at:new Date().toISOString(),draftId:draft.id,returnDraftId:source.id,priorAssetIds:state.assets.map(asset=>asset.id),priorRunIds:state.runs.map(run=>run.id)});
  await page.getByRole('button',{name:'生成视频',exact:true}).click();
  const run=await poll(async()=>{const s=await call('state');return s.runs.find(r=>r.type==='avatar'&&r.draftId===draft.id&&!state.runs.some(prior=>prior.id===r.id));},20000);
  write('cancel-submitted.json',{at:new Date().toISOString(),runId:run.id,draftId:draft.id,actualProductButton:true});console.log(JSON.stringify({runId:run.id,status:run.status}));
  const inference=await poll(async()=>{
   const s=await call('state'),r=s.runs.find(r=>r.id===run.id);assert.equal(r.status,'running',r.error||'任务提前结束，不能冒认推理中取消');if(!r.local?.directory)return false;
   const events=path.join(r.local.directory,'events.jsonl');if(!fs.existsSync(events))return false;
   const lines=fs.readFileSync(events,'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
   if(!lines.some(event=>event.stage==='inference_started'))return false;process.kill(r.local.pid,0);return {run:r,events:lines};
  },180000);
  write('cancel-before-stop.json',{at:new Date().toISOString(),...inference,workerVerifiedLive:true});
  await page.getByRole('button',{name:'停止处理',exact:true}).click();
  const terminal=await poll(async()=>{const s=await call('state'),r=s.runs.find(r=>r.id===run.id);return r.status==='cancelled'?{state:s,run:r}:false;},45000);
  await poll(()=>{try{process.kill(inference.run.local.pid,0);return false;}catch(error){if(error.code==='ESRCH')return true;throw error;}},10000);
  assert(!terminal.run.output);assert.equal(terminal.state.drafts.find(d=>d.id===draft.id).video.assetId,'');assert.deepEqual(terminal.state.assets.map(a=>a.id),state.assets.map(a=>a.id));
  assert(!fs.existsSync(path.join(inference.run.local.root,'sequence','shot-0001','worker')),'取消后不应启动后续镜头');
  const worker=JSON.parse(fs.readFileSync(path.join(inference.run.local.directory,'result.json'),'utf8'));
  await poll(()=>page.getByRole('button',{name:'生成视频',exact:true}).isEnabled(),10000);
  write('cancel-completed.json',{at:new Date().toISOString(),runId:run.id,run:terminal.run,worker,actualProductSubmitAndStop:true,inferenceStarted:true,wrapperProcessExited:true,noAssetAdded:true,noVideoBound:true,noNextShotStarted:true,canGenerateAgain:true,pageErrors:errors});
  await call('selectDraft',{id:source.id});await page.reload();await page.locator('.video-config').waitFor();console.log(JSON.stringify({runId:run.id,status:terminal.run.status,workerStatus:worker.status,noAssetAdded:true,noNextShotStarted:true}));
 }catch(error){write('cancel-error-'+Date.now()+'.json',{at:new Date().toISOString(),error:error.stack,pageErrors:errors});throw error;}
 finally{await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
