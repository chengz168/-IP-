// 使用已选C的原始配音，经现有自动制作入口生成新口型；不重复提交或写活跃数据文件。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('C:/Users/DELL/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core');
const {digest}=require('../integrations/musetalk-local/input.cjs');
const root=path.resolve('evidence/validation/voice-C-character-20261116');
const workspace=path.resolve('evidence/validation/musetalk-integration-20261115/workspace/studio.json');
const read=f=>JSON.parse(fs.readFileSync(f,'utf8')),state=()=>read(workspace),load=n=>read(path.join(root,n));
const write=(n,v)=>fs.writeFileSync(path.join(root,n),JSON.stringify(v,null,2),{flag:'wx'});
async function until(fn,timeout=15000){const start=Date.now();while(Date.now()-start<timeout){const value=await fn();if(value)return value;await new Promise(r=>setTimeout(r,250));}throw Error('观察原任务超时，请查询原凭据，禁止重新提交');}
async function connected(work){const browser=await chromium.connectOverCDP('http://127.0.0.1:9351');try{const page=browser.contexts()[0].pages()[0];page.setDefaultTimeout(15000);return await work(page,(action,payload={})=>page.evaluate(({action,payload})=>window.studio.invoke(action,payload),{action,payload}));}finally{await browser.close();}}
async function shot(page,name){const cdp=await page.context().newCDPSession(page);try{const result=await cdp.send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false});fs.writeFileSync(path.join(root,name),Buffer.from(result.data,'base64'),{flag:'wx'});}finally{await cdp.detach();}}
async function main(){
 fs.mkdirSync(root,{recursive:true});const mode=process.argv[2];
 if(mode==='prepare')return connected(async(page,call)=>{
  assert(!fs.existsSync(path.join(root,'baseline.json')),'已有基线，不重复创建');
  const before=state();assert(!before.runs.some(r=>['running','queued','unknown'].includes(r.status)));assert(!before.workflowJobs.some(j=>['running','queued','stopping'].includes(j.status)));
  const preference=read('evidence/validation/voice-listening-review-20261115/human-preference-C.json'),candidate=read('evidence/validation/voice-match-review-20261115/generated-normal.json');
  assert.equal(preference.preferredCandidate,'C');assert.equal(candidate.run.id,preference.source.runId);assert.equal(candidate.run.status,'succeeded');
  const audio=before.assets.find(a=>a.id===candidate.run.output.id);assert.equal(digest(audio.path),preference.source.originalSha256);assert.equal(digest(candidate.file),digest(audio.path));
  const avatar=before.avatars.find(a=>a.id==='musetalk-night-shape'),shape=before.assets.find(a=>a.id===avatar.assetId);assert(fs.existsSync(shape.path));
  const protectedFiles=read('evidence/validation/voice-design-20261115/prepared.json').protectedFiles;assert(protectedFiles.every(p=>digest(p.file)===p.sha256));
  write('baseline.json',{at:new Date().toISOString(),currentId:before.currentId,drafts:before.drafts,settings:before.settings,voices:before.voices,publishRecords:before.publishRecords,protectedFiles,sourceAudio:audio,sourceAudioSha256:digest(audio.path),shape,shapeSha256:digest(shape.path)});
  let draft=await call('newDraft');write('created.json',{id:draft.id});
  const prior=read('evidence/validation/caption-cover-readability-20261115/generated.json').draft;
  Object.assign(draft,{title:'C音色与示例二人物-真实合成',mode:'auto',step:1,sourceText:candidate.text,rewrite:candidate.text,finalText:candidate.text});
  Object.assign(draft.voice,{profile:candidate.run.parameters.input.profileId,speed:1,emotion:'',strength:.7});
  Object.assign(draft.video,{mode:'single',avatarId:avatar.id,audioId:'',assetId:'',shots:[]});
  Object.assign(draft.edit,{subtitleMode:'template',subtitleTemplate:'simple_blue_white',subtitlesEnabled:true,subtitleMaxChars:6,volume:1,speed:1,cutSilence:false});
  draft.cover=structuredClone(prior.cover);Object.assign(draft.cover,{title:'夜晚散步\n慢慢聊',backgroundId:'',assetId:'',videoId:''});draft.cover.scene.layers[0].text=draft.cover.title;
  Object.assign(draft.publish,{title:'夜晚散步，慢慢聊',description:candidate.text,tags:['夜间散步']});
  draft=await call('saveDraft',draft);draft.voice.audioId=audio.id;draft=await call('saveDraft',draft);
  assert.equal(draft.voice.audioId,audio.id);await page.reload();await page.getByRole('button',{name:'确认使用',exact:true}).waitFor();
  const plan=await call('planWorkflow',{id:draft.id});assert.deepEqual(plan.issues,['请先确认最终文案']);assert.equal(plan.stages.find(s=>s.key==='speech').action,'reuse');assert.equal(plan.stages.find(s=>s.key==='avatar').action,'generate');
  write('prepared.json',{at:new Date().toISOString(),draftId:draft.id,text:candidate.text,sourceSpeechRunId:candidate.run.id,audioId:audio.id,audioSha256:digest(audio.path),shapeId:avatar.id,plan,input:draft});
  await shot(page,'configured.png');console.log(JSON.stringify({draftId:draft.id,audioId:audio.id,plan:plan.stages.map(s=>({key:s.key,action:s.action}))}));
 });
 const prepared=load('prepared.json');
 if(mode==='submit')return connected(async(page,call)=>{
  assert(!fs.existsSync(path.join(root,'submission-intent.json')),'已有提交意图，请查原任务');const before=state();assert.equal(before.currentId,prepared.draftId);assert(!before.workflowJobs.some(j=>j.draftId===prepared.draftId));
  write('submission-intent.json',{at:new Date().toISOString(),draftId:prepared.draftId});await page.getByRole('button',{name:'确认使用',exact:true}).click({noWaitAfter:true});
  const job=await until(()=>state().workflowJobs.find(j=>j.draftId===prepared.draftId));write('submitted.json',{at:new Date().toISOString(),jobId:job.id,actualConfirmationButton:true});console.log(JSON.stringify({jobId:job.id,status:job.status}));
 });
 const data=state(),job=data.workflowJobs.find(j=>j.id===load('submitted.json').jobId);assert(job);
 if(mode==='reload')return connected(async(page,call)=>{
  assert(!fs.existsSync(path.join(root,'reload.json')),'已有刷新凭据');assert(['running','queued'].includes(job.status));
  const run=data.runs.find(r=>r.parameters?.workflowJobId===job.id&&r.type==='avatar');assert(run);const runId=run.id;
  await page.reload();await page.getByLabel('自动流程状态',{exact:true}).waitFor();const after=await call('state');
  assert.equal(after.workflowJobs.filter(j=>j.draftId===prepared.draftId).length,1);assert.equal(after.runs.filter(r=>r.parameters?.workflowJobId===job.id&&r.type==='avatar').length,1);assert(after.runs.some(r=>r.id===runId));
  await shot(page,'running-after-reload.png');write('reload.json',{at:new Date().toISOString(),jobId:job.id,avatarRunId:runId,sameJobAfterReload:true,duplicateJobs:0,duplicateAvatarRuns:0,status:after.workflowJobs.find(j=>j.id===job.id).status});console.log(JSON.stringify({jobId:job.id,runId,sameJobAfterReload:true}));
 });
 if(mode==='status'){
  const run=data.runs.find(r=>r.parameters?.workflowJobId===job.id&&r.status==='running');let livePid=false,workerStatus;
  if(run?.local?.pid){try{process.kill(run.local.pid,0);livePid=true;}catch{}try{workerStatus=read(path.join(run.local.directory,'result.json')).status;}catch{}}
  console.log(JSON.stringify({jobId:job.id,status:job.status,phase:job.phase,error:job.error,stages:job.stages.map(s=>({key:s.key,status:s.status,runId:s.runId})),run:run?{id:run.id,activity:run.activity,local:run.local,livePid,workerStatus}:null}));return;
 }
 assert.equal(job.status,'awaiting_publish',job.error||'原任务未完成');const draft=data.drafts.find(d=>d.id===prepared.draftId);
 if(mode==='collect'){
  const runs=data.runs.filter(r=>r.parameters?.workflowJobId===job.id);assert(!runs.some(r=>r.type==='speech'));assert(runs.every(r=>r.status==='succeeded'));
  const outputs={};for(const [kind,id]of Object.entries({speech:draft.voice.audioId,avatar:draft.video.assetId,render:draft.edit.resultId,cover:draft.cover.assetId})){const asset=data.assets.find(a=>a.id===id);assert(asset);const target=path.join(root,kind+path.extname(asset.path));fs.copyFileSync(asset.path,target,fs.constants.COPYFILE_EXCL);outputs[kind]={...asset,file:target,sha256:digest(target)};}
  assert.equal(outputs.speech.sha256,prepared.audioSha256);assert.equal(outputs.avatar.origin,'local-musetalk');assert.equal(outputs.avatar.lipSync.drivingAudioId,prepared.audioId);
  write('generated.json',{at:new Date().toISOString(),job,draft,runs,outputs,newSpeechGenerated:false,newLipSyncGenerated:true,sourceBodyAndBackgroundReused:true});console.log(JSON.stringify({outputs:Object.fromEntries(Object.entries(outputs).map(([k,v])=>[k,v.file])),captions:draft.edit.captions}));return;
 }
 if(mode==='playback-finish')return connected(async(page,call)=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));await call('selectDraft',{id:draft.id});await page.reload();
  await page.locator('.steps>button').nth(3).click({noWaitAfter:true});const rawVideo=page.getByLabel('视频预览',{exact:true});await rawVideo.waitFor();await rawVideo.evaluate(async node=>{node.currentTime=0;node.muted=false;await node.play();});await page.waitForFunction(()=>document.querySelector('video[aria-label="视频预览"]')?.ended,null,{timeout:30000});
  const rawEnded=await rawVideo.evaluate(node=>({ended:node.ended,duration:node.duration,muted:node.muted,error:node.error?.message||null,source:node.currentSrc}));assert.equal(rawEnded.source,'media://asset/'+draft.video.assetId);assert(!rawEnded.error&&!rawEnded.muted);
  await page.locator('.steps>button').nth(6).click({noWaitAfter:true});const video=page.locator('.publish-columns video');await video.waitFor();
  await video.evaluate(async node=>{node.currentTime=0;node.muted=false;await node.play();});await page.waitForFunction(()=>document.querySelector('.publish-columns video')?.ended,null,{timeout:30000});
  const ended=await video.evaluate(node=>({ended:node.ended,duration:node.duration,muted:node.muted,error:node.error?.message||null,source:node.currentSrc}));assert.equal(ended.source,'media://asset/'+draft.edit.resultId);assert(!ended.error&&!ended.muted);await shot(page,'product-playback.png');
  await page.reload();await page.locator('.publish-columns video').waitFor();const after=state(),baseline=load('baseline.json');assert.equal(after.workflowJobs.filter(j=>j.draftId===draft.id).length,1);
  for(const original of baseline.drafts)assert.deepEqual(after.drafts.find(d=>d.id===original.id),original);for(const key of ['settings','voices','publishRecords'])assert.deepEqual(after[key],baseline[key]);assert(baseline.protectedFiles.every(p=>digest(p.file)===p.sha256));assert.equal(digest(baseline.sourceAudio.path),baseline.sourceAudioSha256);assert.equal(digest(baseline.shape.path),baseline.shapeSha256);
  assert(!after.runs.some(r=>['running','queued','unknown'].includes(r.status)));await call('selectDraft',{id:baseline.currentId});await page.reload();await page.locator('.app main').waitFor();assert.equal(state().currentId,baseline.currentId);
  write('finished.json',{at:new Date().toISOString(),rawEnded,ended,refreshBinding:true,restoredDraftId:baseline.currentId,originalDraftsUnchanged:true,settingsUnchanged:true,voicesUnchanged:true,publishRecordsUnchanged:true,protectedFilesUnchanged:baseline.protectedFiles.length,sourceAudioAndShapeUnchanged:true,duplicateJobs:0,unfinishedRuns:0,pageErrors:errors,humanQualityAccepted:false});console.log(JSON.stringify({rawEnded,ended,restored:baseline.currentId}));return;
 });
 throw Error('未知动作');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
