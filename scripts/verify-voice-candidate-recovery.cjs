// 保留真实成功音频，复现再次取消后旧UI隐藏候选，再验证修正后的真实操作。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('C:/Users/DELL/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core');
const {digest}=require('../integrations/musetalk-local/input.cjs');
const root=path.resolve('evidence/validation/voice-design-20261115/candidate-recovery');fs.mkdirSync(root,{recursive:true});
const write=(name,value)=>fs.writeFileSync(path.join(root,name),JSON.stringify(value,null,2),{flag:'wx'}),read=name=>JSON.parse(fs.readFileSync(path.join(root,name),'utf8'));
async function main(){
 const mode=process.argv[2],browser=await chromium.connectOverCDP('http://127.0.0.1:9351'),page=browser.contexts()[0].pages()[0],errors=[];page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
 const call=(action,payload={})=>page.evaluate(({action,payload})=>window.studio.invoke(action,payload),{action,payload});
 const poll=async(predicate,timeout=120000)=>{const start=Date.now();while(Date.now()-start<timeout){const value=await predicate();if(value)return value;await new Promise(r=>setTimeout(r,250));}throw Error('观察超时，先查询既有任务，不自动重交');};
 const open=async()=>{if(!await page.getByRole('dialog',{name:'设计新音色',exact:true}).count()){await page.locator('.top-menu>button').click();await page.getByRole('navigation',{name:'主菜单',exact:true}).getByRole('button',{name:'声音管理',exact:true}).click();await page.getByRole('button',{name:'设计新音色',exact:true}).click();}await page.getByRole('dialog',{name:'设计新音色',exact:true}).waitFor();};
 try{
  if(mode==='baseline'){
   assert(!fs.existsSync(path.join(root,'baseline-intent.json')),'已有复现任务，不重交');const state=await call('state');assert(!state.runs.some(r=>['running','queued','unknown'].includes(r.status)));
   const prior=state.runs.find(r=>r.type==='voice-design'&&r.draftId===state.currentId);assert.equal(prior?.status,'succeeded');await open();const audio=page.locator('.voice-design-audition audio');await audio.waitFor();
   assert.equal(await audio.getAttribute('src'),'media://asset/'+prior.output.assetId);
   const job={...prior.parameters.job,text:'我们先歇一会儿吧，等会儿再沿着这条路，慢慢走回去。'};
   write('baseline-intent.json',{at:new Date().toISOString(),draftId:state.currentId,originalDrafts:state.drafts,priorRun:prior,job,assetCount:state.assets.length});
   await page.locator('#design-voice-text').fill(job.text);await page.getByRole('button',{name:'生成试听',exact:true}).click();
   const run=await poll(async()=>{const s=await call('state');return s.runs.find(r=>r.type==='voice-design'&&r.draftId===state.currentId&&r.id!==prior.id);},20000);
   write('baseline-submitted.json',{at:new Date().toISOString(),runId:run.id,draftId:state.currentId,submittedThroughProductButton:true});
   await poll(async()=>{const s=await call('state'),r=s.runs.find(r=>r.id===run.id);assert.equal(r.status,'running','推理提前结束，未自动重试');if(!r.local?.directory)return false;try{const worker=JSON.parse(fs.readFileSync(path.join(r.local.directory,'result.json'),'utf8'));return worker.inferenceStarted&&worker.status==='running';}catch{return false;}});
   const before=await call('state'),active=before.runs.find(r=>r.id===run.id);await page.getByRole('button',{name:'停止生成',exact:true}).click();
   const stopped=await poll(async()=>{const s=await call('state'),r=s.runs.find(r=>r.id===run.id);return r.status==='cancelled'?r:false;},30000);
   await poll(()=>{try{process.kill(active.local.pid,0);return false;}catch(e){if(e.code==='ESRCH')return true;throw e;}},15000);
   const after=await call('state');assert.equal(after.assets.length,state.assets.length);const missing=await audio.count()===0;assert(missing,'旧UI未复现，先核对实际版本');
   write('baseline-reproduced.json',{at:new Date().toISOString(),cancelledRun:stopped,priorAssetStillExists:after.assets.some(a=>a.id===prior.output.assetId),priorCandidateHidden:missing,actualInferenceCancellation:true,pageErrors:errors});
   console.log(JSON.stringify({runId:run.id,priorCandidateHidden:true,priorAssetStillExists:true}));return;
  }
  const baseline=read('baseline-intent.json'),prior=baseline.priorRun;
  if(mode==='recovered'){
   assert(!fs.existsSync(path.join(root,'recovered.json')),'已有本次恢复验证');await page.reload();await page.locator('.app main').waitFor();await open();
   assert.equal(await page.locator('#design-voice-text').inputValue(),baseline.job.text);const audio=page.locator('.voice-design-audition audio');await audio.waitFor();assert.equal(await audio.getAttribute('src'),'media://asset/'+prior.output.assetId);
   const save=page.getByRole('button',{name:'保存到声音库',exact:true});assert(await save.isDisabled());assert((await page.locator('.voice-error').innerText()).length>0);
   await page.getByRole('button',{name:'恢复这份试听的输入',exact:true}).click();assert.equal(await page.locator('#design-voice-text').inputValue(),prior.parameters.job.text);assert.equal(await page.locator('#design-voice-description').inputValue(),prior.parameters.job.instruct);assert(await save.isDisabled());
   await audio.evaluate(async n=>{n.currentTime=0;n.muted=false;await n.play();});const ended=await poll(async()=>audio.evaluate(n=>n.ended?{ended:n.ended,duration:n.duration,muted:n.muted,error:n.error?.message||'',source:n.currentSrc}:false),30000);assert(!ended.muted&&!ended.error);assert.equal(ended.source,'media://asset/'+prior.output.assetId);
   assert(await save.isEnabled());await page.getByRole('textbox',{name:'声音名称',exact:true}).fill('恢复试听候选');await save.click();await page.getByRole('dialog',{name:'设计新音色',exact:true}).waitFor({state:'detached'});
   const after=await call('state'),resource=after.voices.find(v=>v.name==='恢复试听候选'&&v.sampleId===prior.output.assetId);assert(resource);assert.equal(resource.provenance.runId,prior.id);assert.equal(resource.provenance.qualityAccepted,false);
   await page.reload();await page.locator('.app main').waitFor();await open();const refreshed=await call('state');assert(refreshed.voices.some(v=>v.id===resource.id));assert(await save.isDisabled());
   assert.equal(await page.locator('#design-voice-text').inputValue(),baseline.job.text);assert.equal(await audio.getAttribute('src'),'media://asset/'+prior.output.assetId);
   for(const draft of baseline.originalDrafts)assert.deepEqual(refreshed.drafts.find(d=>d.id===draft.id),draft);
   write('recovered.json',{at:new Date().toISOString(),priorRunId:prior.id,resource,failedInputPreserved:true,priorAudioPreserved:true,restoredViaButton:true,fullNativePlaybackToEnded:ended,actualSaveButton:true,savedCorrectPriorRun:true,refreshLibraryPreserved:true,refreshRequiresNewAudition:true,originalDraftsUnchanged:true,pageErrors:errors,qualityAccepted:false});console.log(JSON.stringify({recovered:true,voiceId:resource.id,qualityAccepted:false}));return;
  }
  if(mode==='final'){
   const state=await call('state');assert.equal(state.currentId,baseline.draftId);assert(!state.runs.some(r=>['running','queued','unknown'].includes(r.status)));for(const draft of baseline.originalDrafts)assert.deepEqual(state.drafts.find(d=>d.id===draft.id),draft);
   const prepared=JSON.parse(fs.readFileSync('evidence/validation/voice-design-20261115/prepared.json','utf8')),protectedFiles=prepared.protectedFiles.map(i=>({...i,unchanged:digest(i.file)===i.sha256}));assert(protectedFiles.every(i=>i.unchanged));
   write('delivery-report.json',{at:new Date().toISOString(),baseline:read('baseline-reproduced.json'),recovery:read('recovered.json'),invalidation:read('invalidation.json'),protectedFiles,originalDraftsUnchanged:true,
    layout:read('layouts.json'),visualReview:read('visual-review.json'),checks:read('code-validation.json'),qualityAccepted:false,naturalnessAccepted:false,completeReplica:false,goalStatus:'active'});return;
  }
  if(mode==='invalidation'){
   assert(!fs.existsSync(path.join(root,'invalidation.json')),'已有试听失效验证');await open();const audio=page.locator('.voice-design-audition audio'),save=page.getByRole('button',{name:'保存到声音库',exact:true});
   const restore=page.getByRole('button',{name:'恢复这份试听的输入',exact:true});if(await restore.count())await restore.click();
   await audio.evaluate(async n=>{n.currentTime=0;n.muted=false;await n.play();});await poll(async()=>audio.evaluate(n=>n.currentTime>.2&&!n.paused),10000);
   await page.locator('#design-voice-description').fill(prior.parameters.job.instruct+'临时修改');assert(await audio.evaluate(n=>n.paused));assert(await save.isDisabled());
   await restore.click();await audio.evaluate(async n=>{n.currentTime=0;n.muted=false;await n.play();});await poll(async()=>audio.evaluate(n=>n.currentTime>.2&&!n.paused),10000);
   const element=await audio.elementHandle();await page.keyboard.press('Escape');await page.getByRole('dialog',{name:'设计新音色',exact:true}).waitFor({state:'detached'});assert(await element.evaluate(n=>n.paused));await element.dispose();
   await open();assert(await save.isDisabled());assert.equal(await audio.getAttribute('src'),'media://asset/'+prior.output.assetId);
   write('invalidation.json',{at:new Date().toISOString(),inputEditPausesAudio:true,inputEditClearsAudition:true,closePausesAudio:true,reopenRequiresAudition:true,samePriorAudioPreserved:true,pageErrors:errors});
   await page.getByRole('dialog',{name:'设计新音色',exact:true}).getByRole('button',{name:'关闭',exact:true}).click();return;
  }
  throw Error('未知验证动作');
 }finally{await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
