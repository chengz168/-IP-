// 同稿、同模型、同种子只改描述；生成与听审分开记录，避免虚报真人感。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('C:/Users/DELL/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core');
const {digest}=require('../integrations/musetalk-local/input.cjs');
const root=path.resolve('evidence/validation/voice-design-20261115/conversation-v2');
const workspace=path.resolve('evidence/validation/musetalk-integration-20261115/workspace');
const parent=path.dirname(root),read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const write=(name,value)=>fs.writeFileSync(path.join(root,name),JSON.stringify(value,null,2),{flag:'wx'});
const snapshot=()=>read(path.join(workspace,'studio.json'));
const active=state=>state.runs.filter(run=>['running','queued','unknown'].includes(run.status));
async function connected(work){
 const browser=await chromium.connectOverCDP('http://127.0.0.1:9351');
 try{const page=browser.contexts()[0].pages()[0];page.setDefaultTimeout(15000);return await work(page,(action,payload={})=>page.evaluate(({action,payload})=>window.studio.invoke(action,payload),{action,payload}));}
 finally{await browser.close();}
}
async function main(){
 const mode=process.argv[2];
 if(mode==='prepare'){
  assert(!fs.existsSync(root),'已有本轮目录，先查询已有记录');
  const state=snapshot();assert.equal(active(state).length,0);
  const baseline=read(path.join(parent,'qwen-chat-generated.json'));
  assert.equal(digest(baseline.file),baseline.sha256);
  const baselineJob=read(path.join(parent,'job-chat.json'));
  const job={...baselineJob,instruct:'成年女性，普通话，中音稍偏低，温暖圆润。像夜晚散步时对身旁的朋友随口说话，轻松、亲近，语流连贯。'};
  const protectedFiles=read(path.join(parent,'prepared.json')).protectedFiles;
  assert(protectedFiles.every(item=>digest(item.file)===item.sha256));
  const clone=read(path.resolve('evidence/validation/voice-match-review-20261115/generated-normal.json'));
  assert.equal(digest(clone.file),clone.sha256);assert.equal(clone.run.parameters.input.text,job.text);
  fs.mkdirSync(root);
  write('plan.json',{at:new Date().toISOString(),draftId:state.currentId,originalDrafts:state.drafts,job,baseline:{runId:baseline.run.id,file:baseline.file,sha256:baseline.sha256,job:baselineJob},
   authorizedClone:{runId:clone.run.id,file:clone.file,sha256:clone.sha256},protectedFiles,
   changed:['instruct'],held:['text','language','seed','max_new_tokens','model','worker'],
   hypothesis:'简短的聊天描述可能减少朗读感，未经听审验证',referenceAudio:null,newModelDownloads:0,naturalnessAccepted:false,characterMatchAccepted:false});
  for(const file of ['task_plan.md','findings.md','progress.md'])fs.appendFileSync(path.resolve(file),'\n## 2026-11-15 真人感短句第二轮\n\n用户再次要求接近真人；上一轮可播放/ASR通过不代表真人感通过。本轮暂停未实现的MuseTalk多镜头调查，优先声音。采用同稿同模型同种子、仅简化描述的一条真实候选，另保留已获授权的IndexTTS原声音色对照。设计见docs/真人感声音短句对照第二轮.md，证据conversation-v2。旧调查中不存在文件名和通配路径只读失败保留，不再猜路径。当前无未结束任务，不新增下载，不改生产默认，自然度继续未验收。\n');
  console.log(JSON.stringify({prepared:true,job,qualityAccepted:false}));return;
 }
 const plan=read(path.join(root,'plan.json'));
 if(mode==='submit')return connected(async(page,call)=>{
  assert(!fs.existsSync(path.join(root,'submission-intent.json')),'已有提交意图，先查原任务，不重复点击');
  const state=await call('state');assert.equal(active(state).length,0);assert.equal(state.currentId,plan.draftId);
  if(!await page.getByRole('dialog',{name:'设计新音色',exact:true}).count()){
   await page.locator('.top-menu>button').click();
   await page.getByRole('navigation',{name:'主菜单',exact:true}).getByRole('button',{name:'声音管理',exact:true}).click();
   await page.getByRole('button',{name:'设计新音色',exact:true}).click();
  }
  await page.locator('#design-voice-description').fill(plan.job.instruct);
  await page.locator('#design-voice-text').fill(plan.job.text);
  await page.locator('#design-voice-name').fill('随口聊天对照');
  write('submission-intent.json',{at:new Date().toISOString(),draftId:plan.draftId,job:plan.job,priorRunIds:state.runs.map(run=>run.id)});
  await page.getByRole('button',{name:'生成试听',exact:true}).click();
  const start=Date.now();let run;
  while(Date.now()-start<20000){const current=await call('state');run=current.runs.find(r=>r.type==='voice-design'&&r.draftId===plan.draftId&&!state.runs.some(prior=>prior.id===r.id));if(run)break;await new Promise(resolve=>setTimeout(resolve,200));}
  assert(run,'未观察到任务，请按提交意图检查状态，禁止重新点击');assert.deepEqual(run.parameters.job,plan.job);
  write('submitted.json',{at:new Date().toISOString(),runId:run.id,draftId:plan.draftId,actualProductButton:true});console.log(JSON.stringify({id:run.id,status:run.status}));
 });
 const submitted=read(path.join(root,'submitted.json')),state=snapshot(),run=state.runs.find(run=>run.id===submitted.runId);assert(run);
 if(mode==='status'){
  let worker;try{worker=read(path.join(run.local.directory,'result.json'));}catch{}
  console.log(JSON.stringify({id:run.id,status:run.status,error:run.error,worker:worker?{status:worker.status,modelLoaded:worker.modelLoaded,inferenceStarted:worker.inferenceStarted,error:worker.error}:null}));return;
 }
 assert.equal(run.status,'succeeded',run.error||'原任务未完成，仅查询，不重交');
 const asset=state.assets.find(asset=>asset.id===run.output.assetId);assert(asset);
 assert.deepEqual(run.parameters.job,plan.job);assert.equal(asset.origin,'qwen-voice-design');
 const receipt=read(asset.voiceDesign.receiptPath);assert.equal(receipt.referenceAudio,null);assert(receipt.newSpeechGenerated);
 assert.equal(digest(asset.path),receipt.outputSha256);
 if(mode==='collect'){
  const file=path.join(root,'随口聊天-本地新生成.wav');fs.copyFileSync(asset.path,file,fs.constants.COPYFILE_EXCL);
  write('generated.json',{at:new Date().toISOString(),runId:run.id,assetId:asset.id,file,sha256:digest(file),duration:asset.duration,job:plan.job,receipt,actualProductButton:true,qualityAccepted:false});
  console.log(JSON.stringify({file,duration:asset.duration,newSpeechGenerated:true}));return;
 }
 if(mode==='inspect'){
  assert(!fs.existsSync(path.join(root,'inspection.json')),'已有检查收据');
  const {Media,runProcess}=require('../server/media.cjs'),{LocalAsr}=require('../server/local-asr.cjs');
  const {normalize,simplified}=require('./verify-indextts-output.cjs');
  const generated=read(path.join(root,'generated.json'));assert.equal(digest(generated.file),generated.sha256);
  const store={data:state,asset:id=>state.assets.find(asset=>asset.id===id)},media=new Media(store),pcm=path.join(root,'native.s16le');
  await runProcess(media.binaries().ffmpeg,['-v','error','-xerror','-i',generated.file,'-f','null','-']);
  await runProcess(media.binaries().ffmpeg,['-v','error','-n','-i',generated.file,'-map','0:a:0','-c:a','pcm_s16le','-f','s16le',pcm]);
  const bytes=fs.readFileSync(pcm);let peak=0,squares=0,fullScalePoints=0;
  for(let i=0;i<bytes.length;i+=2){const n=bytes.readInt16LE(i);peak=Math.max(peak,Math.abs(n));squares+=n*n;if(n===32767||n===-32768)fullScalePoints++;}
  assert.equal(bytes.length/2,receipt.samples);assert(peak>0);assert.equal(fullScalePoints,0);
  const report={at:new Date().toISOString(),runId:run.id,file:generated.file,sha256:generated.sha256,duration:receipt.duration,fullDecodeVerified:true,
   signal:{samples:bytes.length/2,peakNormalized:peak/32768,rmsNormalized:Math.sqrt(squares/(bytes.length/2))/32768,fullScalePoints},naturalnessAccepted:false,characterMatchAccepted:false,qualityAccepted:false};
  try{report.asr=await new LocalAsr(store,media).transcribe(asset.id,{progress:(_value,message)=>console.log(message)});report.recognizedText=simplified(report.asr.text);report.asrTextMatchesInput=normalize(report.recognizedText)===normalize(plan.job.text);}
  catch(error){report.asrError=error.message;report.asrTextMatchesInput=false;}
  write('inspection.json',report);console.log(JSON.stringify({duration:receipt.duration,signal:report.signal,asrTextMatchesInput:report.asrTextMatchesInput,recognizedText:report.recognizedText}));return;
 }
 if(mode==='playback')return connected(async(page,call)=>{
  assert(!fs.existsSync(path.join(root,'playback.json')),'已有播放记录');assert.equal(active(await call('state')).length,0);
  const audio=page.locator('.voice-design-audition audio');await audio.waitFor();
  const src=await audio.getAttribute('src');assert.equal(src,'media://asset/'+asset.id);
  await audio.evaluate(async node=>{node.currentTime=0;node.muted=false;await node.play();});
  const start=Date.now();let ended;
  while(Date.now()-start<45000){ended=await audio.evaluate(node=>({ended:node.ended,duration:node.duration,muted:node.muted,error:node.error?.message||'',src:node.currentSrc}));if(ended.ended||ended.error)break;await new Promise(resolve=>setTimeout(resolve,200));}
  assert(ended.ended&&!ended.muted&&!ended.error);
  write('playback.json',{at:new Date().toISOString(),runId:run.id,ended,actualProductAudio:true,fullPlaybackToEnded:true,humanListeningAccepted:false});
  console.log(JSON.stringify({fullPlaybackToEnded:true,duration:ended.duration,humanListeningAccepted:false}));
 });
 if(mode==='report'){
  const generated=read(path.join(root,'generated.json')),inspection=read(path.join(root,'inspection.json')),playback=read(path.join(root,'playback.json'));
  assert.equal(digest(generated.file),generated.sha256);assert.equal(inspection.sha256,generated.sha256);assert.equal(playback.runId,run.id);
  assert.deepEqual(state.drafts,plan.originalDrafts);assert.equal(state.currentId,plan.draftId);assert.equal(active(state).length,0);
  const protectedFiles=plan.protectedFiles.map(item=>({...item,unchanged:digest(item.file)===item.sha256}));assert(protectedFiles.every(item=>item.unchanged));
  const report={at:new Date().toISOString(),status:inspection.asrTextMatchesInput?'technical-checks-complete-awaiting-human-listening':'text-review-and-human-listening-required',candidate:generated,inspection,playback,baseline:plan.baseline,authorizedClone:plan.authorizedClone,
   protectedFiles,originalDraftsUnchanged:true,unfinishedRuns:0,newModelSubmissions:1,productionCodeChanged:false,productionDefaultsChanged:false,newModelsDownloaded:false,
   humanListeningAccepted:false,naturalnessAccepted:false,characterMatchAccepted:false,qualityAccepted:false,completeReplica:false};
  write('delivery-report.json',report);
  const update='\n## 2026-11-15 真人感第二轮实际结果\n\n同稿同模型同种子、仅简化描述经真实生成试听按钮提交'+run.id+'，新音频'+receipt.duration+'秒。完整解码/满幅0/原生完整播放通过，ASR规范化正文一致='+inspection.asrTextMatchesInput+'。本轮只增加验证脚本与设计，生产代码/默认未改，未下载模型；原全部草稿和6保护文件未变，无未结束任务。报告conversation-v2/delivery-report.json。自然度/人物匹配仍待人工听审；不据数值称其更自然或听不出AI，整体goal active。\n';
  for(const file of ['task_plan.md','findings.md','progress.md'])fs.appendFileSync(path.resolve(file),update);
  console.log(JSON.stringify({file:path.join(root,'delivery-report.json'),duration:receipt.duration,asrTextMatchesInput:inspection.asrTextMatchesInput,protectedFilesUnchanged:protectedFiles.length,qualityAccepted:false}));return;
 }
 throw Error('未知验证动作');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
