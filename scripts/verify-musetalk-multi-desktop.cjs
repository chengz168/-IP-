// 使用既有配音片段，通过真实编辑器和生成按钮核对多镜头；不认定音质或口型质量通过。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('C:/Users/DELL/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core');
const {Media,runProcess}=require('../server/media.cjs'),{digest}=require('../integrations/musetalk-local/input.cjs');
const root=path.resolve('evidence/validation/musetalk-multi-20261115'),workspace=path.resolve('evidence/validation/musetalk-integration-20261115/workspace');
const read=name=>JSON.parse(fs.readFileSync(path.join(root,name),'utf8')),write=(name,value)=>fs.writeFileSync(path.join(root,name),JSON.stringify(value,null,2),{flag:'wx'});
const stored=()=>JSON.parse(fs.readFileSync(path.join(workspace,'studio.json'),'utf8'));
async function main(){
 const mode=process.argv[2];
 if(mode==='status'){
  const submission=read('submitted.json'),run=stored().runs.find(run=>run.id===submission.runId);assert(run);
  let worker,alive=false;try{worker=JSON.parse(fs.readFileSync(path.join(run.local.directory,'result.json'),'utf8'));}catch{}
  try{process.kill(run.local.pid,0);alive=true;}catch{}
  console.log(JSON.stringify({id:run.id,status:run.status,progress:run.progress,error:run.error,local:run.local,workerPidLive:alive,worker:worker?{status:worker.status,generatedFrames:worker.generatedFrames,inferenceCalls:worker.inferenceCalls}:null,activity:run.activity}));return;
 }
 const browser=await chromium.connectOverCDP('http://127.0.0.1:9351'),page=browser.contexts()[0].pages()[0],errors=[];
 page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));
 const call=(action,payload={})=>page.evaluate(({action,payload})=>window.studio.invoke(action,payload),{action,payload});
 try{
  if(mode==='prepare'){
   assert(!fs.existsSync(path.join(root,'prepared.json')),'已有准备记录');
   const state=stored();assert(!state.runs.some(run=>['running','queued','unknown'].includes(run.status)));
   const source=JSON.parse(fs.readFileSync('evidence/validation/voice-design-20261115/qwen-chat-generated.json','utf8'));assert.equal(digest(source.file),source.sha256);
   const protectedFiles=JSON.parse(fs.readFileSync('evidence/validation/voice-design-20261115/prepared.json','utf8')).protectedFiles;assert(protectedFiles.every(item=>digest(item.file)===item.sha256));
   write('intent.json',{at:new Date().toISOString(),returnDraftId:state.currentId,originalDrafts:state.drafts,protectedFiles,sourceAudio:{file:source.file,sha256:source.sha256,runId:source.run.id},clipSeconds:4.013});
   const media=new Media({data:state}),clip=path.join(root,'既有配音-前4.013秒.wav');
   await runProcess(media.binaries().ffmpeg,['-v','error','-n','-i',source.file,'-map','0:a:0','-t','4.013','-c:a','pcm_s16le',clip]);
   const audio=await call('importFile',{name:path.basename(clip),base64:fs.readFileSync(clip).toString('base64')});
   const first=state.avatars.find(a=>a.id==='musetalk-night-shape'),second=state.avatars.find(a=>a.name==='示例4-白天');assert(first&&second);
   const draft=await call('newDraft');Object.assign(draft,{title:'本地多镜头真实生成验证',step:3,sourceText:source.run.parameters.job.text,finalText:source.run.parameters.job.text,confirmed:true});
   Object.assign(draft.video,{mode:'single',avatarId:first.id,audioId:audio.id,assetId:'',shots:[]});await call('saveDraft',draft);await page.reload();await page.locator('.video-config').waitFor();
   write('prepared.json',{at:new Date().toISOString(),draftId:draft.id,firstAvatarId:first.id,secondAvatarId:second.id,audioId:audio.id,clip,clipSha256:digest(clip),actualNewSpeechGenerated:false,qualityAccepted:false});
   console.log(JSON.stringify({draftId:draft.id,clipSeconds:audio.duration,first:first.name,second:second.name}));return;
  }
  const prepared=read('prepared.json'),intent=read('intent.json'),current=async()=>{const state=await call('state');return state.drafts.find(d=>d.id===prepared.draftId);};
  if(mode==='configure'){
   assert(!fs.existsSync(path.join(root,'configured.json')),'已有配置结果');
   assert(await page.getByRole('button',{name:'多镜头',exact:true}).isEnabled());await page.getByRole('button',{name:'多镜头',exact:true}).click();
   await page.getByRole('button',{name:'编辑镜头',exact:true}).click();const dialog=page.getByRole('dialog',{name:'配置多镜头',exact:true});await dialog.waitFor();
   await dialog.getByRole('spinbutton',{name:'镜头1时长',exact:true}).fill('0.2');await dialog.getByRole('button',{name:'添加镜头',exact:true}).click();await dialog.getByRole('button',{name:'取消',exact:true}).click();
   assert.equal((await current()).video.shots.length,1);assert.equal((await current()).video.shots[0].duration,10);
   await page.getByRole('button',{name:'编辑镜头',exact:true}).click();await dialog.getByRole('button',{name:'添加镜头',exact:true}).click();
   await dialog.getByRole('combobox',{name:'镜头2形象',exact:true}).click();await page.getByRole('option',{name:'示例4-白天',exact:true}).click();
   await dialog.getByRole('spinbutton',{name:'镜头1时长',exact:true}).fill('0.1');await dialog.getByRole('spinbutton',{name:'镜头2时长',exact:true}).fill('3.9');
   const geometry=await dialog.evaluate(node=>{const b=node.getBoundingClientRect(),rows=[...node.querySelectorAll('.shot-row')].map(row=>row.getBoundingClientRect().toJSON());return {box:b.toJSON(),rows,horizontalOverflow:node.scrollWidth>node.clientWidth+2};});assert(!geometry.horizontalOverflow);
   const cdp=await page.context().newCDPSession(page);const image=await cdp.send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false});fs.writeFileSync(path.join(root,'configured-editor.png'),Buffer.from(image.data,'base64'),{flag:'wx'});await cdp.detach();
   await dialog.getByRole('button',{name:'确定',exact:true}).click();await dialog.waitFor({state:'detached'});
   const draft=await current();assert.deepEqual(draft.video.shots,[{avatarId:prepared.firstAvatarId,duration:.1},{avatarId:prepared.secondAvatarId,duration:3.9}]);
   // 多镜头不应依赖隐藏的单形象字段；此字段只在隔离草稿中清空。
   draft.video.avatarId='';await call('saveDraft',draft);await page.reload();await page.locator('.video-shot-summary').waitFor();
   assert(await page.getByRole('button',{name:'生成视频',exact:true}).isEnabled());
   write('configured.json',{at:new Date().toISOString(),shots:draft.video.shots,singleAvatarId:draft.video.avatarId,actualEditorButtons:true,cancelRollback:true,geometry,pageErrors:errors});console.log(JSON.stringify({configured:true,cancelRollback:true,shots:draft.video.shots}));return;
  }
  if(mode==='submit'){
   assert(!fs.existsSync(path.join(root,'submit-intent.json')),'已有提交意图，先查原任务');
   const state=await call('state');assert.equal(state.currentId,prepared.draftId);assert(!state.runs.some(run=>['running','queued','unknown'].includes(run.status)));
   write('submit-intent.json',{at:new Date().toISOString(),draft:await current(),priorRunIds:state.runs.map(run=>run.id)});
   await page.getByRole('button',{name:'生成视频',exact:true}).click();const start=Date.now();let run;
   while(Date.now()-start<20000){run=(await call('state')).runs.find(run=>run.draftId===prepared.draftId&&run.type==='avatar'&&!state.runs.some(prior=>prior.id===run.id));if(run)break;await new Promise(resolve=>setTimeout(resolve,200));}
   assert(run,'未观察到提交，查原任务，禁止重复点击');write('submitted.json',{at:new Date().toISOString(),runId:run.id,actualProductButton:true});console.log(JSON.stringify({id:run.id,status:run.status}));return;
  }
  const submitted=read('submitted.json'),data=stored(),run=data.runs.find(run=>run.id===submitted.runId);assert.equal(run?.status,'succeeded',run?.error||'原任务尚未完成');
  const asset=data.assets.find(asset=>asset.id===run.output.id);assert(asset);assert.equal(asset.lipSync.mode,'multi');assert.equal((await current()).video.assetId,asset.id);
  if(mode==='media'){
   const result=JSON.parse(fs.readFileSync(asset.lipSync.receiptPath,'utf8')),directory=path.dirname(asset.lipSync.receiptPath),plan=JSON.parse(fs.readFileSync(path.join(directory,'plan.json'),'utf8'));
   assert.equal(digest(asset.path),asset.lipSync.outputSha256);assert.equal(result.inputManifestSha256,digest(path.join(directory,'plan.json')));assert.equal(plan.shots[0].frameCount,3);assert.equal(plan.shots[1].frameCount,118);assert.equal(result.retainedFrames,121);
   for(const part of result.parts){const receipt=JSON.parse(fs.readFileSync(part.receiptPath,'utf8')),input=JSON.parse(fs.readFileSync(part.inputManifest,'utf8'));assert(receipt.inferenceVerified&&receipt.newVideoGenerated);assert.equal(receipt.inputManifestSha256,digest(part.inputManifest));assert.equal(digest(part.path),part.sha256);
    const measurements=fs.readFileSync(path.join(path.dirname(part.receiptPath),'face-measurements.jsonl'),'utf8').trim().split(/\r?\n/).map(JSON.parse);assert.equal(measurements.length,receipt.generatedFrames);assert(measurements.every(row=>row.changedPixelsInsideFaceBox>0&&row.outsideFaceBoxIdenticalBeforeEncoding));
    assert.equal(input.audio.sha256,digest(plan.shots[part.index].audio));
   }
   const media=new Media({data}),{ffmpeg}=media.binaries(),output=path.join(root,'本地多镜头-夜间切白天.mp4');fs.copyFileSync(asset.path,output,fs.constants.COPYFILE_EXCL);
   const originalPcm=path.join(root,'original-audio.pcm'),outputPcm=path.join(root,'output-audio.pcm');
   for(const [file,pcm]of [[prepared.clip,originalPcm],[output,outputPcm]])await runProcess(ffmpeg,['-v','error','-n','-i',file,'-map','0:a:0','-ac','1','-ar','16000','-c:a','pcm_s16le','-f','s16le',pcm]);
   const original=fs.readFileSync(originalPcm),actual=fs.readFileSync(outputPcm);let aa=0,bb=0,ab=0;const count=Math.min(original.length,actual.length)/2;
   for(let i=0;i<count;i++){const a=original.readInt16LE(i*2),b=actual.readInt16LE(i*2);aa+=a*a;bb+=b*b;ab+=a*b;}const correlation=ab/Math.sqrt(aa*bb);assert(correlation>.95);
   for(const [index,time]of [0,.1,1,3.8].entries())await runProcess(ffmpeg,['-v','error','-n','-ss',String(time),'-i',output,'-frames:v','1','-vf','scale=324:576:flags=lanczos',path.join(root,'frame-'+index+'.png')]);
   const montage=path.join(root,'generated-grid.jpg');await runProcess(ffmpeg,['-v','error','-n','-framerate','1','-i',path.join(root,'frame-%d.png'),'-vf','tile=2x2','-frames:v','1','-q:v','2',montage]);
   write('media.json',{at:new Date().toISOString(),runId:run.id,output,sha256:digest(output),plan,receipt:result,correlation,originalSamples:original.length/2,fullDecodeVerified:result.fullDecodeVerified,everyFrameFaceModified:true,allOutsideFaceBoxesIdenticalBeforeEncoding:true,montage,qualityAccepted:false});console.log(JSON.stringify({output,frames:result.retainedFrames,inferredFrames:result.generatedFrames,inferenceCalls:result.inferenceCalls,correlation}));return;
  }
  if(mode==='playback'){
   const video=page.getByLabel('视频预览',{exact:true});await video.waitFor();await video.evaluate(async node=>{node.currentTime=0;node.muted=false;await node.play();});
   const start=Date.now();let ended;while(Date.now()-start<30000){ended=await video.evaluate(node=>({ended:node.ended,duration:node.duration,muted:node.muted,error:node.error?.message||'',source:node.currentSrc}));if(ended.ended||ended.error)break;await new Promise(resolve=>setTimeout(resolve,200));}
   assert(ended.ended&&!ended.muted&&!ended.error);assert.equal(ended.source,'media://asset/'+asset.id);
   const before=(await call('state')).runs.length;await page.reload();await page.locator('.video-config').waitFor();assert.equal((await current()).video.assetId,asset.id);assert.equal((await call('state')).runs.length,before);
   write('playback.json',{at:new Date().toISOString(),runId:run.id,ended,actualProductVideo:true,fullPlaybackToEnded:true,refreshBinding:true,pageErrors:errors,qualityAccepted:false});console.log(JSON.stringify({playback:true,refreshBinding:true,duration:ended.duration}));return;
  }
  if(mode==='finish'){
   await call('selectDraft',{id:intent.returnDraftId});await page.reload();await page.locator('.app main').waitFor();
   const state=stored();for(const draft of intent.originalDrafts)assert.deepEqual(state.drafts.find(d=>d.id===draft.id),draft);assert(!state.runs.some(r=>['running','queued','unknown'].includes(r.status)));
   const protectedFiles=intent.protectedFiles.map(item=>({...item,unchanged:digest(item.file)===item.sha256}));assert(protectedFiles.every(item=>item.unchanged));
   write('integrity.json',{at:new Date().toISOString(),returnedToOriginalDraft:true,originalDraftsUnchanged:true,protectedFiles,unfinishedRuns:0});console.log(JSON.stringify({originalDraftsUnchanged:true,protectedFiles:protectedFiles.length,unfinishedRuns:0}));return;
  }
  throw Error('未知验证动作');
 }catch(error){write(mode+'-error-'+Date.now()+'.json',{at:new Date().toISOString(),error:error.stack,pageErrors:errors});throw error;}
 finally{await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
