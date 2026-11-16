// 在日常持久工作区执行一次真实整链；观察与重启不重新提交模型任务。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('C:/Users/DELL/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core');
const {digest}=require('../integrations/musetalk-local/input.cjs');
const {Media,runProcess}=require('../server/media.cjs');
const root=path.resolve(__dirname,'../evidence/validation/daily-local-workspace-20261116'),workspace=path.resolve(root,'../../../workspaces/local-studio');
const read=name=>JSON.parse(fs.readFileSync(path.join(root,name),'utf8')),state=()=>JSON.parse(fs.readFileSync(path.join(workspace,'studio.json'),'utf8'));
const write=(name,value)=>fs.writeFileSync(path.join(root,name),JSON.stringify(value,null,2),{flag:'wx'}),mode=process.argv[2];
async function until(fn,timeout=15000){const start=Date.now();while(Date.now()-start<timeout){const value=await fn();if(value)return value;await new Promise(resolve=>setTimeout(resolve,200))}throw Error('观察原操作超时，请查已有凭据，不重交')}
async function connected(work){const browser=await chromium.connectOverCDP('http://127.0.0.1:9374');try{const page=browser.contexts()[0].pages()[0];page.setDefaultTimeout(15000);await page.locator('.app main').waitFor();const errors=[];page.on('pageerror',error=>errors.push(error.message));await work(page,(action,payload={})=>page.evaluate(({action,payload})=>window.studio.invoke(action,payload),{action,payload}),errors)}finally{await browser.close().catch(()=>{})}}
function currentJob(){const data=state(),submitted=read(fs.existsSync(path.join(root,'resumed.json'))?'resumed.json':'submitted.json'),job=data.workflowJobs.find(item=>item.id===submitted.jobId);assert(job);return {data,job,draft:data.drafts.find(item=>item.id===job.draftId)}}
async function main(){
 if(mode==='inspect')return connected(async(page,call)=>{const data=await call('state');console.log(JSON.stringify({workspace,voices:data.voices.map(item=>({id:item.id,name:item.name})),avatars:data.avatars.map(item=>({id:item.id,name:item.name})),draftId:data.currentId,buttons:await page.getByRole('button').allTextContents()}))});
 if(mode==='prepare')return connected(async(page,call,errors)=>{
  assert(!fs.existsSync(path.join(root,'configured.json')),'已准备，不新建第二个验收任务');
  const prepared=read('prepared.json'),before=await call('state');assert.equal(before.runs.length,0);assert.equal(before.drafts.length,1);
  const text='晚上出来走一走，刚好路边的灯都亮了。忙了一天，先给自己留几分钟，慢慢走，也慢慢聊。';
  const draft=await call('newDraft');write('created-draft.json',{at:new Date().toISOString(),id:draft.id,starterDraftId:before.currentId});
  Object.assign(draft,{title:'本地链路验收短片',mode:'auto',step:1,sourceText:text,rewrite:text,finalText:'',confirmed:false});
  Object.assign(draft.voice,{profile:prepared.voices[0].id,speed:1,emotion:'',strength:.7,prosodyReferenceId:'',audioId:''});
  Object.assign(draft.video,{mode:'single',avatarId:prepared.setup.avatarId,assetId:'',audioId:'',shots:[]});
  Object.assign(draft.edit,{subtitleMode:'template',subtitleTemplate:'simple_blue_white',subtitleMaxChars:6});
  await call('saveDraft',draft);await page.reload();await page.locator('.steps>button').nth(5).click();
  await page.getByRole('button',{name:'V3-黄字描黑',exact:true}).click();
  await until(()=>state().drafts.find(item=>item.id===draft.id).cover.template==='v3');
  await page.locator('.steps>button').nth(1).click();await page.getByRole('button',{name:'确认使用',exact:true}).waitFor();
  const plan=await call('planWorkflow',{id:draft.id});assert.deepEqual(plan.issues,['请先确认最终文案']);
  await page.screenshot({path:path.join(root,'configured.png')});
  write('configured.json',{at:new Date().toISOString(),draftId:draft.id,text,starterDraftId:before.currentId,plan,pageErrors:errors});assert.equal(errors.length,0);
  console.log(JSON.stringify({draftId:draft.id,plan:plan.stages.map(stage=>({key:stage.key,action:stage.action}))}));
 });
 if(mode==='submit')return connected(async(page,call)=>{
  const input=read('configured.json');assert(!fs.existsSync(path.join(root,'submission-intent.json')),'已有提交意图，只查原任务');assert.equal(state().currentId,input.draftId);
  assert(!(state().workflowJobs||[]).length);write('submission-intent.json',{at:new Date().toISOString(),draftId:input.draftId,actualConfirmationButton:true});
  await page.getByRole('button',{name:'确认使用',exact:true}).click();
  const job=await until(()=>state().workflowJobs?.find(item=>item.draftId===input.draftId));
  write('submitted.json',{at:new Date().toISOString(),jobId:job.id,draftId:input.draftId});
  console.log(JSON.stringify({jobId:job.id,status:job.status}));
 });
 if(mode==='status'){
  const {data,job}=currentJob(),run=data.runs.find(item=>item.parameters?.workflowJobId===job.id&&item.status==='running');let liveWorker=false;
  if(run?.local?.pid)try{process.kill(run.local.pid,0);liveWorker=true}catch{}
  console.log(JSON.stringify({jobId:job.id,status:job.status,phase:job.phase,error:job.error,stages:job.stages.map(stage=>({key:stage.key,status:stage.status,runId:stage.runId,error:stage.error})),run:run?{id:run.id,type:run.type,progress:run.progress,activity:run.activity,local:run.local,liveWorker}:null}));return;
 }
 if(mode==='duplicate-check')return connected(async(page,call)=>{
  const {job}=currentJob(),data=await call('state');assert.equal(data.workflowJobs.filter(item=>item.draftId===job.draftId).length,1);assert.equal(data.drafts.length,2);
  const sessions=await page.context().newCDPSession(page),info=await sessions.send('Browser.getVersion');await sessions.detach();
  const processes=require('node:child_process').execFileSync('powershell.exe',['-NoProfile','-Command',"ConvertTo-Json -Compress -InputObject @(Get-CimInstance Win32_Process -Filter \"Name='electron.exe'\" | Where-Object { $_.CommandLine -like '*local-workspace-entry.cjs*' -and $_.CommandLine -notlike '*--type=*' } | Select-Object ProcessId,CommandLine)"],{windowsHide:true,encoding:'utf8'}).trim();
  const mains=JSON.parse(processes||'[]');assert.equal(mains.length,1);
  write('duplicate-instance.json',{at:new Date().toISOString(),mainProcesses:mains,workflowCountForDraft:1,runIds:data.runs.map(item=>item.id),version:info,workspace});
  console.log(JSON.stringify({singleMainProcess:mains[0].ProcessId,workflowCount:1}));
 });
 if(mode==='repair-fonts')return connected(async(page,call)=>{
  assert(!fs.existsSync(path.join(root,'font-configuration-repair.json')));const {data,job,draft}=currentJob();assert.equal(job.status,'failed');assert.match(job.error,/字体/);
  const original=JSON.parse(fs.readFileSync(path.resolve(root,'../musetalk-integration-20261115/workspace/studio.json'),'utf8')).settings;
  assert(fs.existsSync(original.subtitleFontsDir)&&fs.existsSync(original.subtitlePythonPath));
  const audio=data.assets.find(item=>item.id===draft.voice.audioId),video=data.assets.find(item=>item.id===draft.video.assetId);
  await call('saveSettings',{...data.settings,subtitleFontsDir:original.subtitleFontsDir,subtitlePythonPath:original.subtitlePythonPath});
  const plan=await call('planWorkflow',{id:draft.id});assert.deepEqual(plan.issues,[]);for(const key of ['speech','avatar','transcribe'])assert.equal(plan.stages.find(stage=>stage.key===key).action,'reuse');
  write('font-configuration-repair.json',{at:new Date().toISOString(),failedJob:job,subtitleFontsDir:original.subtitleFontsDir,subtitlePythonPath:original.subtitlePythonPath,sourceSpeech:{id:audio.id,sha256:digest(audio.path)},sourceAvatar:{id:video.id,sha256:digest(video.path)},plan,throughProductSettingsApi:true,existingDataReseeded:false});
  await page.reload();console.log(JSON.stringify({fontConfigurationRepaired:true,reuse:['speech','avatar','transcribe']}));
 });
 if(mode==='resume')return connected(async(page,call)=>{
  assert(!fs.existsSync(path.join(root,'resume-intent.json')),'已有恢复提交意图，只查已有流程');const {job,draft}=currentJob();assert.equal(job.status,'failed');assert(fs.existsSync(path.join(root,'font-configuration-repair.json')));
  write('resume-intent.json',{at:new Date().toISOString(),failedJobId:job.id,draftId:draft.id,newSpeechExpected:false,newAvatarExpected:false});
  await page.getByRole('button',{name:'重新处理',exact:true}).click();
  const resumed=await until(()=>state().workflowJobs.find(item=>item.id!==job.id&&item.draftId===draft.id));
  write('resumed.json',{at:new Date().toISOString(),jobId:resumed.id,previousFailedJobId:job.id,draftId:draft.id,actualRetryButton:true});
  console.log(JSON.stringify({jobId:resumed.id,previousFailedJobId:job.id,status:resumed.status}));
 });
 if(mode==='collect'){
  const {data,job,draft}=currentJob();assert.equal(job.status,'awaiting_publish',job.error||'原任务未结束');
  const runs=data.runs.filter(item=>item.parameters?.workflowJobId===job.id),allRuns=data.runs.filter(item=>item.draftId===draft.id);assert.equal(runs.length,5);assert(runs.every(item=>item.status==='succeeded'));
  assert.equal(allRuns.filter(item=>item.type==='speech').length,1);assert.equal(allRuns.filter(item=>item.type==='avatar').length,1);assert.equal(allRuns.filter(item=>item.type==='transcribe').length,1);
  const outputs={};for(const [kind,id] of Object.entries({speech:draft.voice.audioId,avatar:draft.video.assetId,render:draft.edit.resultId,cover:draft.cover.assetId})){const asset=data.assets.find(item=>item.id===id);assert(asset);assert(asset.path.startsWith(workspace+path.sep));outputs[kind]={...asset,sha256:digest(asset.path)}}
  assert.equal(outputs.speech.origin,'local-indextts');assert.equal(outputs.speech.speech.referenceSha256,read('prepared.json').referenceSha256);assert.equal(outputs.avatar.origin,'local-musetalk');assert.equal(outputs.avatar.lipSync.drivingAudioId,outputs.speech.id);
  const repair=read('font-configuration-repair.json');assert.equal(outputs.speech.id,repair.sourceSpeech.id);assert.equal(outputs.speech.sha256,repair.sourceSpeech.sha256);assert.equal(outputs.avatar.id,repair.sourceAvatar.id);assert.equal(outputs.avatar.sha256,repair.sourceAvatar.sha256);
  write('generated.json',{at:new Date().toISOString(),job,draft,runs,allRuns,outputs,newSpeechGenerated:true,newLipSyncGenerated:true,priorSuccessfulStagesReusedAfterFontRepair:true,bodyAndBackgroundFromReference:true,humanQualityAccepted:false});
  console.log(JSON.stringify({jobId:job.id,outputs:Object.fromEntries(Object.entries(outputs).map(([kind,asset])=>[kind,{id:asset.id,duration:asset.duration,path:asset.path}])),captions:draft.edit.captions,coverTitle:draft.cover.title}));return;
 }
 if(mode==='media'){
  assert(!fs.existsSync(path.join(root,'media-result.json')));const generated=read('generated.json'),data=state(),media=new Media({data,asset:id=>data.assets.find(item=>item.id===id)}),{ffmpeg}=media.binaries();
  const inspected={};
  for(const [kind,asset] of Object.entries(generated.outputs)){const metadata=await media.probe(asset.path);await runProcess(ffmpeg,['-v','error','-xerror','-i',asset.path,'-f','null','-']);inspected[kind]={metadata,sha256:digest(asset.path),fullDecode:true}}
  const time=Math.min(1,generated.outputs.render.duration/2),frame=path.join(root,'actual-render-frame.png');
  await runProcess(ffmpeg,['-v','error','-n','-ss',String(time),'-i',generated.outputs.render.path,'-frames:v','1',frame]);
  write('media-result.json',{at:new Date().toISOString(),inspected,frame,frameTime:time,humanQualityAccepted:false});console.log(JSON.stringify({decoded:Object.keys(inspected),frame}));return;
 }
 if(mode==='playback')return connected(async(page,call,errors)=>{
  assert(!fs.existsSync(path.join(root,'playback.json')));const generated=read('generated.json');
  await call('selectDraft',{id:generated.draft.id});await page.reload();await page.locator('.steps>button').nth(4).click();
  const video=page.getByLabel('剪辑成片视频',{exact:true});await video.waitFor();
  await video.evaluate(async node=>{if(node.readyState===0)await new Promise(resolve=>node.addEventListener('loadedmetadata',resolve,{once:true}));if(node.currentTime!==0)throw Error('播放必须从0开始');node.__times=[];node.__seeks=0;node.addEventListener('timeupdate',()=>node.__times.push(node.currentTime));node.addEventListener('seeking',()=>node.__seeks++);node.muted=false;node.volume=1;await node.play()});
  const observed=await until(()=>video.evaluate(node=>node.ended?{ended:true,duration:node.duration,source:node.currentSrc,muted:node.muted,rate:node.playbackRate,seeks:node.__seeks,times:node.__times,error:node.error?.message||null}:null),30000);
  assert(!observed.error&&!observed.muted);assert.equal(observed.rate,1);assert.equal(observed.source,'media://asset/'+generated.outputs.render.id);assert.equal(observed.seeks,0);assert(observed.times.length>8);
  await page.screenshot({path:path.join(root,'product-playback-ended.png')});const runIds=state().runs.map(item=>item.id);await page.reload();
  await page.waitForFunction(id=>document.querySelector('video[aria-label="剪辑成片视频"]')?.src==='media://asset/'+id,generated.outputs.render.id);assert.deepEqual(state().runs.map(item=>item.id),runIds);
  write('playback.json',{at:new Date().toISOString(),...observed,fullNativeUnmutedPlayback:true,refreshBinding:true,noDuplicateSubmission:true,pageErrors:errors});assert.equal(errors.length,0);console.log(JSON.stringify({playedToEnded:true,duration:observed.duration,refreshBinding:true}));
 });
 if(mode==='restart-check')return connected(async(page,call,errors)=>{
  const generated=read('generated.json'),data=await call('state');assert.equal(data.voices.length,1);assert.equal(data.avatars.length,4);assert.equal(data.drafts.length,2);assert.deepEqual(data.runs.map(item=>item.id),generated.allRuns.map(item=>item.id));assert.equal(data.workflowJobs.length,2);
  const draft=data.drafts.find(item=>item.id===generated.draft.id);assert.equal(draft.edit.resultId,generated.outputs.render.id);
  const sample=data.assets.find(item=>item.id===data.voices[0].sampleId);assert.equal(digest(state().assets.find(item=>item.id===sample.id).path),read('prepared.json').referenceSha256);
  await call('selectDraft',{id:read('configured.json').starterDraftId});await page.reload();await page.locator('.steps>button').first().waitFor();
  await page.screenshot({path:path.join(root,'ready-for-user.png')});
  write('restart-persistence.json',{at:new Date().toISOString(),voices:1,avatars:4,drafts:2,runs:data.runs.length,jobs:2,renderId:draft.edit.resultId,starterSelected:true,allManagedAssetsInsideWorkspace:state().assets.every(asset=>asset.path.startsWith(workspace+path.sep)&&fs.existsSync(asset.path)),pageErrors:errors});assert.equal(errors.length,0);
  console.log(JSON.stringify({persisted:true,voices:1,avatars:4,runs:data.runs.length,starterSelected:true}));
 });
 if(mode==='close')return connected(async(page,call)=>{const data=await call('state');assert(!data.runs.some(item=>['running','queued'].includes(item.status)));await page.evaluate(()=>window.studio.window('close')).catch(error=>{if(!/closed|destroyed/i.test(error.message))throw error});console.log('已请求关闭日常工作区窗口，后续核对PID');});
 throw Error('未知动作：'+mode);
}
main().catch(error=>{fs.appendFileSync(path.join(root,'errors.jsonl'),JSON.stringify({at:new Date().toISOString(),mode,error:error.stack})+'\n');console.error(error);process.exitCode=1});
