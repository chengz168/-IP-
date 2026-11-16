const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('C:/Users/DELL/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core');
const {digest}=require('../integrations/musetalk-local/input.cjs');
const root=path.resolve('evidence/validation/voice-design-20261115'),read=name=>JSON.parse(fs.readFileSync(path.join(root,name),'utf8'));
const write=(name,data)=>fs.writeFileSync(path.join(root,name),JSON.stringify(data,null,2));
async function main(){
 const action=process.argv[2],browser=await chromium.connectOverCDP('http://127.0.0.1:9351'),page=browser.contexts()[0].pages()[0],errors=[];
 page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message));
 const call=(action,payload={})=>page.evaluate(({action,payload})=>window.studio.invoke(action,payload),{action,payload});
 const poll=async(predicate,timeout=600000)=>{const start=Date.now();while(Date.now()-start<timeout){const value=await predicate();if(value)return value;await new Promise(resolve=>setTimeout(resolve,700));}throw Error('等待原声音任务超时，先查询原ID，禁止重交');};
 try{
  if(action==='prepare'){
   assert(!fs.existsSync(path.join(root,'product-candidate.json')),'已有产品候选，保留历史');
   const source=read('h3-autonomous/audition.json');assert.equal(digest(source.file),source.sha256);assert.equal(source.referenceAudio,null);
   const before=await call('state');assert(!before.runs.some(r=>['running','queued','unknown'].includes(r.status)));assert.equal(before.settings.provider.ttsProtocol,'indextts-local');
   const sample=await call('importFile',{name:'自主合成夜聊音色-参考.wav',base64:fs.readFileSync(source.file).toString('base64')});assert.equal(digest(sample.path),source.sha256);
   const voice=await call('saveResource',{type:'voice',item:{name:'自主夜聊女声',sampleId:sample.id,provenance:{kind:'self-designed-h3-voice',promptId:source.source.promptId,sourceSha256:source.source.sha256,referenceSha256:source.sha256,originalHumanVoiceUsed:false,listeningAccepted:false}}});
   const draft=await call('newDraft'),text=read('prepared.json').text;
   Object.assign(draft,{title:'自主夜聊女声-新文案配音对照',step:2,mode:'manual',sourceText:text,rewrite:text,finalText:text,confirmed:true});
   Object.assign(draft.voice,{profile:voice.id,audioId:'',speed:1,emotion:'',strength:.7});await call('saveDraft',draft);
   write('product-candidate.json',{at:new Date().toISOString(),draftId:draft.id,returnDraftId:before.currentId,voiceId:voice.id,sampleId:sample.id,reference:source,text,
    inputPreparedThroughProductApi:true,modelSubmissions:0,originalHumanVoiceUsed:false,qualityAccepted:false});console.log(JSON.stringify({draftId:draft.id,voiceId:voice.id,modelSubmissions:0}));return;
  }
  const candidate=read('product-candidate.json');
  if(action==='generate'){
   assert(!fs.existsSync(path.join(root,'product-submission.json')),'已有提交记录，先查询原任务');
   const before=await call('state');assert(!before.runs.some(r=>['running','queued','unknown'].includes(r.status)));assert(!before.runs.some(r=>r.draftId===candidate.draftId));
   await call('selectDraft',{id:candidate.draftId});await page.reload();await page.locator('.voice-config').waitFor();
   const state=await call('state'),draft=state.drafts.find(d=>d.id===candidate.draftId);assert.equal(draft.finalText,candidate.text);assert.equal(draft.voice.profile,candidate.voiceId);
   assert((await page.locator('.voice-config').innerText()).includes('自主夜聊女声'));
   const submission={at:new Date().toISOString(),draftId:candidate.draftId,clicked:false};write('product-submission.json',submission);
   await page.getByRole('button',{name:'生成声音',exact:true}).click();submission.clicked=true;submission.submittedThroughProductButton=true;write('product-submission.json',submission);
   const run=await poll(async()=>{const state=await call('state');return state.runs.find(r=>r.draftId===candidate.draftId&&r.type==='speech');});submission.runId=run.id;write('product-submission.json',submission);
   const finished=await poll(async()=>{const state=await call('state'),r=state.runs.find(r=>r.id===run.id);return r&&!['running','queued'].includes(r.status)?r:false;});assert.equal(finished.status,'succeeded',finished.error);
   assert.equal(finished.output.speech.referenceSha256,candidate.reference.sha256);assert.notEqual(finished.output.speech.outputSha256,candidate.reference.sha256);
   const file=path.join(root,'自主夜聊女声-新文案-IndexTTS.wav');fs.copyFileSync(finished.output.path,file,fs.constants.COPYFILE_EXCL);assert.equal(digest(file),finished.output.speech.outputSha256);
   write('product-generated.json',{at:new Date().toISOString(),run:finished,file,sha256:digest(file),text:candidate.text,sourcePromptId:candidate.reference.source.promptId,
    referenceAudioWasSelfGenerated:true,originalHumanVoiceUsed:false,submittedThroughProductButton:true,newSpeechGenerated:true,pageErrors:errors,listeningAccepted:false,qualityAccepted:false});
   await page.screenshot({path:path.join(root,'product-generated.png')});console.log(JSON.stringify({runId:run.id,file,duration:finished.output.duration}));return;
  }
  if(action==='video'){
   assert(!fs.existsSync(path.join(root,'video-submission.json')),'已有视频提交记录，沿原任务查询');
   const state=await call('state'),draft=state.drafts.find(d=>d.id===candidate.draftId),speech=read('product-generated.json');
   assert.equal(state.settings.provider.avatarProtocol,'musetalk-local');assert(!state.runs.some(r=>['running','queued','unknown'].includes(r.status)));
   assert.equal(draft.voice.audioId,speech.run.output.id);const avatar=state.avatars.find(a=>a.id==='musetalk-night-shape');assert(avatar);
   // 前端状态隐藏本地绝对路径；用同一隔离工作区的实际文件核验，不绕过产品的路径隐藏约定。
   const stored=JSON.parse(fs.readFileSync('evidence/validation/musetalk-integration-20261115/workspace/studio.json','utf8'));
   const shape=stored.assets.find(a=>a.id===avatar.assetId);assert(shape&&state.assets.some(a=>a.id===shape.id));assert.equal(digest(shape.path),'b1888fe12b0126f6926ce95d0f5c78d13315cce05e82984e0a8a90ba9650358d');
   Object.assign(draft.video,{mode:'single',avatarId:avatar.id,audioId:'',assetId:''});await call('saveDraft',draft);await page.reload();await page.locator('.voice-config').waitFor();
   await page.locator('.steps button').nth(3).click();await page.locator('.video-config').waitFor();
   assert((await page.getByRole('combobox',{name:'模型版本',exact:true}).innerText()).includes('MuseTalk 1.5'));
   const submission={at:new Date().toISOString(),draftId:draft.id,clicked:false,audioId:speech.run.output.id,audioSha256:speech.sha256,sourceShapeSha256:digest(shape.path),
    newSpeechGenerated:true,bodyAndBackgroundReused:true,originalHumanVoiceUsed:false};write('video-submission.json',submission);
   await page.getByRole('button',{name:'生成视频',exact:true}).click();submission.clicked=true;submission.submittedThroughProductButton=true;write('video-submission.json',submission);
   const run=await poll(async()=>{const s=await call('state');return s.runs.find(r=>r.draftId===draft.id&&r.type==='avatar');});submission.runId=run.id;write('video-submission.json',submission);
   console.log(JSON.stringify({runId:run.id,status:run.status,newSpeechGenerated:true,submittedThroughProductButton:true}));return;
  }
  if(action==='video-status'){
   const submission=read('video-submission.json'),state=await call('state'),run=state.runs.find(r=>r.id===submission.runId);assert(run);
   write('video-status.json',{at:new Date().toISOString(),run});console.log(JSON.stringify({id:run.id,status:run.status,progress:run.progress,activity:run.activity,error:run.error,local:run.local,outputId:run.output?.id}));return;
  }
  if(action==='video-playback'){
   const generated=read('video-inspection.json');await call('selectDraft',{id:candidate.draftId});await page.reload();await page.locator('.video-config').waitFor();
   const video=page.locator('.video-result video');await video.waitFor();await page.waitForFunction(()=>{const v=document.querySelector('.video-result video');return v?.readyState>=2&&v.videoWidth===1080;});
   await video.evaluate(async node=>{node.currentTime=0;node.muted=false;await node.play();});await page.waitForFunction(()=>document.querySelector('.video-result video')?.ended,null,{timeout:90000});
   const ended=await video.evaluate(node=>({ended:node.ended,duration:node.duration,error:node.error?.message||'',muted:node.muted}));assert(ended.ended&&!ended.error&&!ended.muted);
   await page.reload();await page.locator('.video-config').waitFor();const state=await call('state');assert.equal(state.drafts.find(d=>d.id===candidate.draftId).video.assetId,generated.assetId);
   await page.waitForFunction(()=>document.querySelector('.video-result video')?.readyState>=2);await page.screenshot({path:path.join(root,'video-product-stable.png')});
   write('video-playback.json',{at:new Date().toISOString(),runId:generated.runId,ended,fullNativePlaybackToEnded:true,refreshBinding:true,pageErrors:errors,listeningAccepted:false,qualityAccepted:false});return;
  }
  assert.equal(action,'playback');const generated=read('product-generated.json');
  await call('selectDraft',{id:candidate.draftId});await page.reload();await page.locator('.voice-config').waitFor();
  const audio=page.locator('.audio-result audio[controls]');await audio.waitFor();await page.waitForFunction(()=>document.querySelector('.audio-result audio[controls]')?.readyState>=2);
  await audio.evaluate(async node=>{node.currentTime=0;node.muted=false;await node.play();});await page.waitForFunction(()=>document.querySelector('.audio-result audio[controls]')?.ended,null,{timeout:90000});
  const ended=await audio.evaluate(node=>({ended:node.ended,duration:node.duration,error:node.error?.message||'',muted:node.muted}));assert(ended.ended&&!ended.error&&!ended.muted);
  await page.reload();await page.locator('.voice-config').waitFor();const refreshed=await call('state');assert.equal(refreshed.drafts.find(d=>d.id===candidate.draftId).voice.audioId,generated.run.output.id);
  write('product-playback.json',{at:new Date().toISOString(),runId:generated.run.id,ended,fullNativePlaybackToEnded:true,refreshBinding:true,pageErrors:errors,listeningAccepted:false,qualityAccepted:false});
 }finally{await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
