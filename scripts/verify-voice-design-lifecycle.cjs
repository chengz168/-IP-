// 在独立验证草稿里检查刷新、真实推理停止和已保存自主候选的换稿链；不认定音质。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('C:/Users/DELL/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core');
const {digest}=require('../integrations/musetalk-local/input.cjs');
const root=path.resolve('evidence/validation/voice-design-20261115/lifecycle');fs.mkdirSync(root,{recursive:true});
const write=(name,value)=>fs.writeFileSync(path.join(root,name),JSON.stringify(value,null,2),{flag:'wx'});
const read=name=>JSON.parse(fs.readFileSync(path.join(root,name),'utf8'));
const parentRead=name=>JSON.parse(fs.readFileSync(path.resolve('evidence/validation/voice-design-20261115',name),'utf8'));
async function main(){
 const mode=process.argv[2],browser=await chromium.connectOverCDP('http://127.0.0.1:9351'),page=browser.contexts()[0].pages()[0],errors=[];
 page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
 const call=(action,payload={})=>page.evaluate(({action,payload})=>window.studio.invoke(action,payload),{action,payload});
 const poll=async(predicate,timeout=120000)=>{const start=Date.now();while(Date.now()-start<timeout){const value=await predicate();if(value)return value;await new Promise(resolve=>setTimeout(resolve,300));}throw Error('观察超时，先检查既有提交记录和原任务，不自动重交');};
 const menu=async name=>{await page.locator('.top-menu>button').click();await page.getByRole('navigation',{name:'主菜单',exact:true}).getByRole('button',{name,exact:true}).click();};
 const open=async()=>{if(!await page.getByRole('dialog',{name:'设计新音色',exact:true}).count()){await menu('声音管理');await page.getByRole('button',{name:'设计新音色',exact:true}).click();}await page.getByRole('dialog',{name:'设计新音色',exact:true}).waitFor();};
 try{
  if(mode==='prepare'){
   assert(!fs.existsSync(path.join(root,'prepared.json')),'已有准备记录');
   const state=await call('state');assert(!state.runs.some(r=>['running','queued','unknown'].includes(r.status)));
   const saved=parentRead('qwen-clear-saved.json'),generated=parentRead('qwen-clear-generated.json');
   const voice=state.voices.find(v=>v.id===saved.resource.id);assert(voice);assert.equal(voice.sampleId,generated.run.output.assetId);assert.equal(voice.provenance.qualityAccepted,false);
   const stored=JSON.parse(fs.readFileSync('evidence/validation/musetalk-integration-20261115/workspace/studio.json','utf8')),asset=stored.assets.find(a=>a.id===voice.sampleId);
   assert.equal(digest(asset.path),generated.sha256);assert.equal(state.settings.provider.ttsProtocol,'indextts-local');
   const receipt={at:new Date().toISOString(),returnDraftId:state.currentId,originalDrafts:state.drafts,voiceId:voice.id,voiceName:voice.name,referenceId:voice.sampleId,referenceSha256:generated.sha256,
    sourceVoiceRunId:generated.run.id,qualityAccepted:false,modelSubmissions:0};write('prepared.json',receipt);console.log(JSON.stringify({prepared:true,voiceName:voice.name}));return;
  }
  const prepared=read('prepared.json');
  if(mode==='cancel'){
   assert(!fs.existsSync(path.join(root,'cancel-intent.json')),'已有取消试验，先查原任务');
   const state=await call('state');assert(!state.runs.some(r=>['running','queued','unknown'].includes(r.status)));
   const modal=page.getByRole('dialog',{name:'设计新音色',exact:true});if(await modal.count())await modal.getByRole('button',{name:'关闭',exact:true}).click();
   const draft=await call('newDraft');draft.title='自主音色刷新停止验证';await call('saveDraft',draft);await page.reload();await page.locator('.app main').waitFor();await open();
   const job={...parentRead('job-chat.json'),text:'今天先到这里，明天再接着聊。我们慢慢走，路上还有很多有意思的小事。'};
   await page.locator('#design-voice-text').fill(job.text);await page.locator('#design-voice-description').fill(job.instruct);
   write('cancel-intent.json',{at:new Date().toISOString(),draftId:draft.id,job,clicked:false});
   await page.getByRole('button',{name:'生成试听',exact:true}).click();
   const run=await poll(async()=>{const s=await call('state');return s.runs.find(r=>r.draftId===draft.id&&r.type==='voice-design');},20000);
   write('cancel-submitted.json',{at:new Date().toISOString(),draftId:draft.id,runId:run.id,submittedThroughProductButton:true});
   await poll(async()=>{const s=await call('state'),current=s.runs.find(r=>r.id===run.id);assert.equal(current.status,'running','试验提前结束，不冒认推理中停止');if(!current.local?.directory)return false;try{const worker=JSON.parse(fs.readFileSync(path.join(current.local.directory,'result.json'),'utf8'));return worker.inferenceStarted===true&&worker.status==='running';}catch{return false;}});
   await page.reload();await page.locator('.app main').waitFor();await open();
   assert.equal(await page.locator('#design-voice-text').inputValue(),job.text);assert.equal(await page.locator('#design-voice-description').inputValue(),job.instruct);
   assert(await page.getByRole('button',{name:'生成试听',exact:true}).isDisabled());
   const before=await call('state'),active=before.runs.find(r=>r.id===run.id);assert.equal(active.status,'running');
   const workerBefore=JSON.parse(fs.readFileSync(path.join(active.local.directory,'result.json'),'utf8'));assert(workerBefore.inferenceStarted);
   write('cancel-before-stop.json',{at:new Date().toISOString(),run:active,worker:workerBefore,refreshRestoredSameRun:true,inputsLocked:true});
   await page.getByRole('button',{name:'停止生成',exact:true}).click();
   const stopped=await poll(async()=>{const s=await call('state'),r=s.runs.find(r=>r.id===run.id);return r.status==='cancelled'?r:false;},30000);
   await poll(()=>{try{process.kill(active.local.pid,0);return false;}catch(e){if(e.code==='ESRCH')return true;throw e;}},15000);
   const after=await call('state');assert.equal(after.assets.length,before.assets.length);assert(!stopped.output);assert(await page.getByRole('button',{name:'生成试听',exact:true}).isEnabled());
   const workerAfter=JSON.parse(fs.readFileSync(path.join(active.local.directory,'result.json'),'utf8'));
   write('cancel-completed.json',{at:new Date().toISOString(),run:stopped,workerBefore,workerAfter,modelInferenceCancellationVerified:true,refreshRestoredSameRun:true,submittedAndStoppedThroughProductButtons:true,
    wrapperProcessExited:true,noAssetAdded:true,noOutputAttached:true,canRetry:true,pageErrors:errors,qualityAccepted:false});
   await page.getByRole('dialog',{name:'设计新音色',exact:true}).getByRole('button',{name:'关闭',exact:true}).click();await call('selectDraft',{id:prepared.returnDraftId});await page.reload();
   console.log(JSON.stringify({runId:run.id,cancelled:true,inferenceStarted:true,refreshRestored:true,noAssetAdded:true,workerFinalStatus:workerAfter.status}));return;
  }
  if(mode==='speech'){
   assert(!fs.existsSync(path.join(root,'speech-intent.json')),'已有换稿试验，先查原任务');
   const state=await call('state');assert(!state.runs.some(r=>['running','queued','unknown'].includes(r.status)));
   const draft=await call('newDraft'),text='你看，前面那家小店还开着。要不要过去坐一会儿？今天的事儿，咱们坐下来慢慢聊。';
   assert.notEqual(text,parentRead('job-clear.json').text);
   Object.assign(draft,{title:'自主候选换稿配音验证',step:2,sourceText:text,rewrite:text,finalText:text,confirmed:true});
   Object.assign(draft.voice,{profile:prepared.voiceId,speed:1,emotion:'',audioId:''});await call('saveDraft',draft);await page.reload();await page.locator('.voice-config').waitFor();
   assert((await page.locator('.voice-config').innerText()).includes(prepared.voiceName));
   write('speech-intent.json',{at:new Date().toISOString(),draftId:draft.id,text,voiceId:prepared.voiceId,referenceSha256:prepared.referenceSha256});
   await page.getByRole('button',{name:'生成声音',exact:true}).click();
   const run=await poll(async()=>{const s=await call('state');return s.runs.find(r=>r.draftId===draft.id&&r.type==='speech');},20000);
   write('speech-submitted.json',{at:new Date().toISOString(),runId:run.id,draftId:draft.id,submittedThroughProductButton:true});
   console.log(JSON.stringify({runId:run.id,status:run.status,draftId:draft.id}));return;
  }
  if(mode==='status'){
   const submission=read('speech-submitted.json'),state=await call('state'),run=state.runs.find(r=>r.id===submission.runId);assert(run);console.log(JSON.stringify({id:run.id,status:run.status,error:run.error}));return;
  }
  if(mode==='watch-speech'){
   const submission=read('speech-submitted.json');let prior='';
   await poll(async()=>{const state=await call('state'),run=state.runs.find(r=>r.id===submission.runId);assert(run);const current=JSON.stringify({id:run.id,status:run.status,error:run.error});if(current!==prior){console.log(current);prior=current;}if(['running','queued'].includes(run.status))return false;assert.equal(run.status,'succeeded',run.error);return run;},600000);return;
  }
  if(mode==='collect-speech'){
   const submission=read('speech-submitted.json'),intent=read('speech-intent.json'),state=await call('state'),run=state.runs.find(r=>r.id===submission.runId);assert.equal(run?.status,'succeeded',run?.error);
   assert.equal(run.output.origin,'local-indextts');assert.equal(run.output.speech.referenceSha256,prepared.referenceSha256);assert.notEqual(run.output.speech.outputSha256,prepared.referenceSha256);
   assert.equal(run.parameters.input.text,intent.text);const file=path.join(root,'Qwen自主候选-IndexTTS换稿.wav');fs.copyFileSync(run.output.path,file,fs.constants.COPYFILE_EXCL);assert.equal(digest(file),run.output.speech.outputSha256);
   write('speech-generated.json',{at:new Date().toISOString(),run,file,sha256:digest(file),text:intent.text,referenceSha256:prepared.referenceSha256,sourceVoiceRunId:prepared.sourceVoiceRunId,newTextDiffersFromReference:true,qualityAccepted:false});return;
  }
  if(mode==='speech-playback'){
   const generated=read('speech-generated.json');assert.equal(digest(generated.file),generated.sha256);
   await page.locator('.voice-config').waitFor();const audio=page.locator('.audio-result audio[controls]');await audio.waitFor();
   await audio.evaluate(async node=>{node.currentTime=0;node.muted=false;await node.play();});
   const ended=await poll(async()=>audio.evaluate(n=>n.ended?{ended:n.ended,duration:n.duration,muted:n.muted,error:n.error?.message||'',source:n.currentSrc}:false),45000);
   assert(!ended.error&&!ended.muted);assert.equal(ended.source,'media://asset/'+generated.run.output.id);
   write('speech-playback-ended.json',{at:new Date().toISOString(),runId:generated.run.id,ended,fullNativePlaybackToEnded:true,pageErrors:errors,qualityAccepted:false});
   await page.reload();await page.locator('.voice-config').waitFor();
   const state=await call('state');assert.equal(state.drafts.find(d=>d.id===generated.run.draftId).voice.audioId,generated.run.output.id);
   await poll(async()=>audio.evaluate((n,id)=>n.readyState>=2&&n.currentSrc==='media://asset/'+id,generated.run.output.id));
   write('speech-refresh.json',{at:new Date().toISOString(),runId:generated.run.id,refreshBinding:true,pageErrors:errors});
   await call('selectDraft',{id:prepared.returnDraftId});await page.reload();await page.locator('.app main').waitFor();return;
  }
  if(mode==='final'){
   const state=await call('state');assert(!state.runs.some(r=>['running','queued','unknown'].includes(r.status)));
   assert.equal(state.currentId,prepared.returnDraftId);for(const draft of prepared.originalDrafts)assert.deepEqual(state.drafts.find(d=>d.id===draft.id),draft);
   const protectedFiles=parentRead('prepared.json').protectedFiles.map(item=>({...item,unchanged:digest(item.file)===item.sha256}));assert(protectedFiles.every(item=>item.unchanged));
   const processes=read('cancel-processes.json');assert.equal(processes.processCount,0);
   const mediaInspection=read('speech-inspection.json');assert(mediaInspection.fullDecodeVerified);assert.equal(mediaInspection.signal.fullScalePoints,0);
   write('delivery-report.json',{at:new Date().toISOString(),status:'technical-chain-complete-text-and-listening-review-required',cancellation:read('cancel-completed.json'),cancelledProcessAudit:processes,speech:read('speech-generated.json'),
    speechPlayback:read('speech-playback-ended.json'),speechRefresh:read('speech-refresh.json'),mediaInspection,textReviewRequired:!mediaInspection.asrTextMatchesInput,
    currentDraftRestored:true,originalDraftsUnchanged:true,protectedFiles,naturalnessAccepted:false,voiceConsistencyAccepted:false,qualityAccepted:false,longVideoGenerated:false,goalStatus:'active'});console.log(JSON.stringify({done:true,qualityAccepted:false}));return;
  }
  throw Error('未知验证步骤');
 }finally{await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
