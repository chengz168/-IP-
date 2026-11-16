const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('C:/Users/DELL/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core');
const directory=path.resolve('evidence/validation/musetalk-integration-20261115'),mode=process.argv[2];
const read=name=>JSON.parse(fs.readFileSync(path.join(directory,name),'utf8'));
const write=(name,data)=>fs.writeFileSync(path.join(directory,name),JSON.stringify(data,null,2));
async function main(){
 const browser=await chromium.connectOverCDP('http://127.0.0.1:9351'),page=browser.contexts()[0].pages()[0],errors=[];
 page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(15000);
 const call=(action,payload={})=>page.evaluate(({action,payload})=>window.studio.invoke(action,payload),{action,payload}),prepared=read('prepared.json');
 const current=async()=>{const s=await call('state');return s.drafts.find(d=>d.id===prepared.draftId);};
 const screenshot=name=>page.screenshot({path:path.join(directory,name+'.png')});
 const menu=async label=>{if(!await page.getByRole('navigation',{name:'主菜单',exact:true}).count())await page.locator('.top-menu>button').click();await page.getByRole('navigation',{name:'主菜单',exact:true}).getByRole('button',{name:label,exact:true}).click();};
 const poll=async(predicate,timeout=180000)=>{const started=Date.now();while(Date.now()-started<timeout){if(await predicate())return;await new Promise(r=>setTimeout(r,250));}throw Error('只读等待实际状态超时；请核查原任务，不要重复提交');};
 try{
  if(mode==='inspect'){console.log((await page.locator('body').innerText()).slice(-7000));return;}
  if(mode==='status'){
   const state=await call('state');console.log(JSON.stringify(state.runs.map(r=>({id:r.id,type:r.type,status:r.status,error:r.error,progress:r.progress,activity:r.activity,output:r.output,local:r.local})),null,2));return;
  }
  if(mode==='copy'){
   assert(!fs.existsSync(path.join(directory,'copy-submission.json')),'已有文案提交记录，禁止重复点击');
   assert.equal((await call('state')).runs.length,0);
   await page.getByRole('button',{name:'改写文案',exact:true}).waitFor();
   write('copy-submission.json',{at:new Date().toISOString(),clicked:false});
   await page.getByRole('button',{name:'改写文案',exact:true}).click();write('copy-submission.json',{at:new Date().toISOString(),clicked:true,submittedThroughProductButton:true});await screenshot('copy-running');return;
  }
  if(mode==='speech'){
   assert(!fs.existsSync(path.join(directory,'speech-submission.json')),'已有配音提交记录，禁止重复点击');
   const before=await call('state'),copy=before.runs.find(r=>r.type==='rewrite');assert.equal(copy?.status,'succeeded',copy?.error);assert((await current()).rewrite.trim());
   await page.getByRole('button',{name:'确认使用',exact:true}).click();
   await poll(async()=>{const s=await call('state');return s.drafts.find(d=>d.id===s.currentId).confirmed;});
   await page.locator('.steps button').nth(2).click();await page.locator('.voice-config').waitFor();
   const model=before.settings.provider.model;
   // 本地文案请求已结束后显式释放本批模型缓存，不生成额外文案。
   const unload=await fetch('http://127.0.0.1:11434/api/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model,keep_alive:0})});assert.equal(unload.status,200);
   const queue=await(await fetch('http://127.0.0.1:8188/queue')).json();assert.equal(queue.queue_running.length+queue.queue_pending.length,0);
   const free=await fetch('http://127.0.0.1:8188/free',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({unload_models:true,free_memory:true})});assert.equal(free.status,200);
   write('speech-submission.json',{at:new Date().toISOString(),clicked:false,text:(await current()).finalText,copyRunId:copy.id,ollamaCacheReleased:true,comfyQueueEmpty:true,reference:prepared.reference});
   await page.getByRole('button',{name:'生成声音',exact:true}).click();write('speech-submission.json',{...read('speech-submission.json'),clicked:true,submittedThroughProductButton:true});await screenshot('speech-running');return;
  }
  if(mode==='settings'){
   await menu('设置');await page.getByRole('button',{name:'模型设置',exact:true}).click();
   const select=page.getByRole('combobox',{name:'视频接入方式',exact:true});assert.equal(await select.inputValue(),'musetalk-local');
   assert.equal(await page.getByRole('textbox',{name:'本地口型环境路径',exact:true}).inputValue(),'D:/AI-Runtimes/super-ip/musetalk-1.5');
   assert.equal(await page.getByRole('textbox',{name:'视频生成服务地址',exact:true}).count(),0);
   await page.getByRole('button',{name:'检查本地口型环境',exact:true}).click();
   const dialog=page.getByRole('dialog',{name:'本地口型环境检查通过',exact:true});await dialog.waitFor({timeout:180000});assert((await dialog.innerText()).includes('CUDA：可用'));await screenshot('settings-check-passed');
   await dialog.getByRole('button',{name:'关闭弹窗',exact:true}).click();
   write('settings-check.json',{at:new Date().toISOString(),actualUiCheck:true,passed:true,pageErrors:errors});await menu('新工作流');return;
  }
  if(mode==='video'||mode==='video-retry'){
   const retry=mode==='video-retry',submissionName=retry?'video-retry-1.json':'video-submission.json';
   assert(!fs.existsSync(path.join(directory,submissionName)),'已有本次视频提交记录，禁止重复点击');
   if(retry){
    const prior=(await call('state')).runs.find(r=>r.id==='9bb4d69f-424f-4e67-8b6e-e84c8e5be020');assert.equal(prior?.status,'failed');
    const receipt=JSON.parse(fs.readFileSync(path.join(prior.local.directory,'result.json'),'utf8'));assert.equal(receipt.status,'failed');
    assert(Number.isSafeInteger(prior.local.pid)&&prior.local.pid>0,'缺少原工作器PID凭据');
    assert.throws(()=>process.kill(prior.local.pid,0),{code:'ESRCH'},'原工作器尚未确认退出，禁止重交');
    write('video-first-failure.json',{at:new Date().toISOString(),run:prior,workerReceipt:receipt});
   }
   const state=await call('state'),speech=state.runs.find(r=>r.type==='speech');assert.equal(speech?.status,'succeeded',speech?.error);assert.equal((await current()).voice.audioId,speech.output.id);
   await page.locator('.steps button').nth(3).click();await page.locator('.video-config').waitFor();
   assert(await page.getByRole('button',{name:'多镜头',exact:true}).isDisabled());
   assert((await page.getByRole('combobox',{name:'模型版本',exact:true}).innerText()).includes('MuseTalk 1.5'));
   const audio=page.locator('.audio-source-card audio');await audio.waitFor({state:'attached'});await page.waitForFunction(()=>document.querySelector('.audio-source-card audio')?.readyState>=2);
   assert.equal(state.runs.filter(r=>r.status==='running'||r.status==='queued').length,0);
   write(submissionName,{at:new Date().toISOString(),clicked:false,speechRunId:speech.id,audioId:speech.output.id,newSpeechGenerated:true,submittedThroughProductButton:false,retryOf:retry?'9bb4d69f-424f-4e67-8b6e-e84c8e5be020':null});
   await page.getByRole('button',{name:'生成视频',exact:true}).click();write(submissionName,{...read(submissionName),clicked:true,submittedThroughProductButton:true});await screenshot(retry?'video-retry-running':'video-running');return;
  }
  if(mode==='cancel'){
   const retry=process.argv.includes('--retry-cancel'),submissionName=retry?'cancel-submission-2.json':'cancel-submission.json';
   assert(!fs.existsSync(path.join(directory,submissionName)),'已有实际取消记录，不重复生成');
   if(retry){const prior=(await call('state')).runs.find(r=>r.id==='99c5e543-974e-4d5c-8a82-177a85c9ab47');assert.equal(prior?.status,'cancelled');const receipt=JSON.parse(fs.readFileSync(path.join(prior.local.directory,'result.json'),'utf8'));assert.equal(receipt.status,'cancelled');write('preparation-cancel.json',{at:new Date().toISOString(),run:prior,workerReceipt:receipt,modelInferenceCancellationVerified:false});}
   const original=await current(),s=await call('state'),speech=s.runs.find(r=>r.type==='speech'&&r.status==='succeeded');assert(speech?.output?.id);
   const draft=await call('newDraft');draft.title='本地口型实际取消验收';draft.step=3;draft.video={...draft.video,mode:'single',avatarId:original.video.avatarId,audioId:speech.output.id};await call('saveDraft',draft);await page.reload();await page.locator('.video-config').waitFor();
   write(submissionName,{at:new Date().toISOString(),draftId:draft.id,clicked:false});
   await page.getByRole('button',{name:'生成视频',exact:true}).click();write(submissionName,{...read(submissionName),clicked:true});
   await poll(async()=>{const s=await call('state');const r=s.runs[0];if(r&&r.status!=='running')throw Error(r.error||'生成提前结束');return r?.activity?.completed>=8;});
   const before=await call('state'),run=before.runs[0];await screenshot('before-real-cancel');await page.locator('.operation-status button').click();
   await poll(async()=>{const s=await call('state');return s.runs[0]?.status==='cancelled';},60000);
   const after=await call('state'),cancelled=after.runs[0];assert.equal(cancelled.id,run.id);assert.equal(cancelled.remoteId,'');assert.equal(after.assets.length,before.assets.length);assert.equal(after.drafts.find(d=>d.id===draft.id).video.assetId,'');
   const receipt=JSON.parse(fs.readFileSync(path.join(cancelled.local.directory,'result.json'),'utf8'));assert.equal(receipt.status,'cancelled');assert(receipt.generatedFrames>=8);
   write('cancel-completed.json',{at:new Date().toISOString(),run:cancelled,workerReceipt:receipt,submittedAndCancelledThroughProductButtons:true,noAssetAdded:true,noVideoAttached:true,pageErrors:errors});
   await call('selectDraft',{id:prepared.draftId});await page.reload();console.log(JSON.stringify({runId:run.id,status:'cancelled',generatedFramesBeforeCancel:receipt.generatedFrames,assetAdded:false}));return;
  }
  if(mode==='watch'){
   const started=Date.now();let last='';
   while(Date.now()-started<60*60*1000){
    const state=await call('state'),run=state.runs.find(r=>r.draftId===prepared.draftId&&(!process.argv[3]||r.type===process.argv[3]));
    const status=JSON.stringify({id:run?.id,type:run?.type,status:run?.status,activity:run?.activity,error:run?.error});
    if(status!==last){console.log(status);last=status;}
    if(run&&run.status!=='running'&&run.status!=='queued'){write(run.type+'-completed.json',{at:new Date().toISOString(),run,pageErrors:errors});assert.equal(run.status,'succeeded',run.error);return;}
    await new Promise(r=>setTimeout(r,1500));
   }
   throw Error('只读等待超时；保留原任务，不能重交');
  }
  if(mode==='captions'){
   assert(!fs.existsSync(path.join(directory,'captions-submission.json')),'已有字幕提交记录，禁止重复识别');
   const state=await call('state'),draft=await current(),run=state.runs.find(r=>r.draftId===prepared.draftId&&r.type==='avatar'&&r.status==='succeeded');assert(run?.output?.id);assert.equal(draft.video.assetId,run.output.id);assert.equal(draft.edit.captions.length,0);
   await page.locator('.steps button').nth(4).click();await page.locator('.edit-columns').waitFor();
   await page.locator('.edit-nav-select').filter({has:page.locator('b',{hasText:/^字幕$/})}).click();
   await page.getByRole('group',{name:'字幕模式',exact:true}).getByRole('button',{name:'模板',exact:true}).click();
   const {subtitleTemplates}=await import('../server/subtitle-templates.mjs');const template=subtitleTemplates.find(t=>t.id==='simple_yellow_white');assert(template);
   await page.getByRole('button',{name:template.name,exact:true}).click();
   await poll(async()=>{const d=await current();return d.edit.subtitleMode==='template'&&d.edit.subtitleTemplate===template.id;});
   write('captions-submission.json',{at:new Date().toISOString(),clicked:false,sourceAssetId:run.output.id,templateId:template.id});
   await page.getByRole('button',{name:'生成字幕',exact:true}).click();write('captions-submission.json',{...read('captions-submission.json'),clicked:true,submittedThroughProductButton:true});
   const dialog=page.getByRole('dialog',{name:'编辑字幕',exact:true});await dialog.waitFor({timeout:180000});
   const after=await call('state'),asr=after.runs.find(r=>r.draftId===prepared.draftId&&r.type==='transcribe');assert.equal(asr?.status,'succeeded',asr?.error);assert((await current()).edit.captions.length>0);assert(asr.output.segments.every(row=>row.words?.length>0));
   await screenshot('captions-recognized');await dialog.getByRole('button',{name:'确定',exact:true}).click();await dialog.waitFor({state:'detached'});
   write('captions-completed.json',{at:new Date().toISOString(),run:asr,captions:(await current()).edit.captions,actualWordTimestamps:true,submittedThroughProductButton:true,pageErrors:errors,textQualityAccepted:false});return;
  }
  if(mode==='render'){
   assert(!fs.existsSync(path.join(directory,'render-submission.json')),'已有剪辑提交记录，禁止重复点击');
   const draft=await current();assert(draft.video.assetId&&draft.edit.captions.length>0);assert.equal(draft.edit.resultId,'');
   await page.locator('.steps button').nth(4).click();await page.locator('.edit-columns').waitFor();
   write('render-submission.json',{at:new Date().toISOString(),clicked:false,sourceAssetId:draft.video.assetId,edit:structuredClone(draft.edit)});
   await page.getByRole('button',{name:'剪辑视频',exact:true}).click();write('render-submission.json',{...read('render-submission.json'),clicked:true,submittedThroughProductButton:true});return;
  }
  if(mode==='render-playback'){
   const state=await call('state'),run=state.runs.find(r=>r.draftId===prepared.draftId&&r.type==='render');assert.equal(run?.status,'succeeded',run?.error);assert.equal((await current()).edit.resultId,run.output.id);
   await page.locator('.steps button').nth(4).click();await page.getByRole('button',{name:'成片预览',exact:true}).click();
   const video=page.getByLabel('剪辑成片视频',{exact:true});await video.waitFor();await page.waitForFunction(()=>document.querySelector('video[aria-label="剪辑成片视频"]')?.readyState>=2);
   await video.evaluate(async node=>{node.currentTime=0;node.muted=false;await node.play();});await page.waitForFunction(()=>document.querySelector('video[aria-label="剪辑成片视频"]')?.currentTime>.2);await screenshot('render-playing');
   await page.waitForFunction(()=>document.querySelector('video[aria-label="剪辑成片视频"]')?.ended,null,{timeout:90000});
   const ended=await video.evaluate(node=>({ended:node.ended,muted:node.muted,duration:node.duration,error:node.error?.message||'',totalVideoFrames:node.getVideoPlaybackQuality().totalVideoFrames,droppedVideoFrames:node.getVideoPlaybackQuality().droppedVideoFrames}));assert(ended.ended&&!ended.error&&!ended.muted);
   await page.reload();await page.locator('.edit-columns').waitFor();assert.equal((await current()).edit.resultId,run.output.id);assert.equal((await call('state')).runs.length,state.runs.length);
   write('render-playback.json',{at:new Date().toISOString(),runId:run.id,assetId:run.output.id,fullNativePlaybackToEnded:true,ended,refreshBinding:true,pageErrors:errors,listeningAccepted:false,qualityAccepted:false});return;
  }
  if(mode==='playback'){
   const before=await call('state'),run=before.runs.find(r=>r.type==='avatar'&&r.status==='succeeded'),draft=await current();assert(run?.output?.id);assert.equal(draft.video.assetId,run.output.id);
   await page.locator('.steps button').nth(3).click();
   const video=page.getByLabel('视频预览',{exact:true});await video.waitFor();await page.waitForFunction(()=>document.querySelector('video[aria-label="视频预览"]')?.readyState>=2);
   await video.evaluate(async node=>{node.currentTime=0;node.muted=false;await node.play();});
   await page.waitForFunction(()=>document.querySelector('video[aria-label="视频预览"]')?.currentTime>.2);
   const playing=await video.evaluate(node=>({time:node.currentTime,duration:node.duration,muted:node.muted,error:node.error?.message||''}));assert(!playing.muted&&!playing.error);await screenshot('video-playing');
   await page.waitForFunction(()=>document.querySelector('video[aria-label="视频预览"]')?.ended,null,{timeout:660000});
   const ended=await video.evaluate(node=>({time:node.currentTime,duration:node.duration,ended:node.ended,error:node.error?.message||'',quality:node.getVideoPlaybackQuality().toJSON?.()||{totalVideoFrames:node.getVideoPlaybackQuality().totalVideoFrames,droppedVideoFrames:node.getVideoPlaybackQuality().droppedVideoFrames}}));assert(ended.ended&&!ended.error);
   await page.reload();await page.locator('.video-config').waitFor();assert.equal((await current()).video.assetId,run.output.id);assert.equal((await call('state')).runs.length,before.runs.length);
   await video.evaluate(node=>new Promise((resolve,reject)=>{node.muted=true;node.currentTime=1;const timer=setTimeout(()=>reject(Error('视频帧呈现超时')),5000);node.requestVideoFrameCallback(()=>{clearTimeout(timer);node.pause();node.muted=false;resolve();});node.play().catch(reject);}));await screenshot('video-final');
   write('playback.json',{at:new Date().toISOString(),runId:run.id,assetId:run.output.id,playing,ended,fullNativePlaybackToEnded:true,refreshBinding:true,pageErrors:errors,listeningAccepted:false,qualityAccepted:false});console.log(JSON.stringify({fullNativePlayback:true,duration:ended.duration,refreshBinding:true}));return;
  }
  throw Error('未知验证模式');
 }catch(error){write(mode+'-error-'+Date.now()+'.json',{error:error.stack,pageErrors:errors});await screenshot(mode+'-failure').catch(()=>{});throw error;}
 finally{await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
