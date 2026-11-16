const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {runProcess}=require('./media.cjs');
const {digest}=require('../integrations/musetalk-local/input.cjs');
const {prepareVideoSource,probeVideo,videoPlan,audioPlan,readPcm,prepareProductionInput}=require('../integrations/musetalk-local/production-input.cjs');

function sequencePlan(samples,fps,shots){
 if(!Number.isInteger(fps)||fps<10||fps>60)throw Error('多镜头输出帧率必须是10至60的整数');
 const timing=audioPlan(samples,fps);
 if(!Array.isArray(shots)||!shots.length)throw Error('请至少保留一个镜头');
 let requested=0;
 for(const shot of shots){if(!shot||typeof shot.avatarId!=='string'||!shot.avatarId||!Number.isFinite(shot.duration)||shot.duration<=0)throw Error('镜头形象或时长无效');requested+=shot.duration;}
 if(Math.abs(requested-timing.audioDuration)>.051)throw Error('多镜头总时长需与驱动音频一致，请在编辑镜头中均分音频或调整时长');
 let cumulative=0,startFrame=0;
 const timeline=shots.map((shot,index)=>{
  cumulative+=shot.duration;
  const endFrame=index===shots.length-1?timing.frameCount:Math.round(cumulative*fps),frameCount=endFrame-startFrame;
  if(frameCount<1||endFrame>timing.frameCount)throw Error('镜头'+(index+1)+'在当前帧率下不足一帧或超出音轨，请调整时长');
  const startSample=Math.min(samples,Math.round(startFrame*16000/fps)),endSample=Math.min(samples,Math.round(endFrame*16000/fps));
  // 每段只修正模型驱动；最终音轨完整保留，不把舍入误差累积到音轨上。
  const driverSamples=Math.max(16000,Math.ceil(frameCount*16000/fps)),copiedSamples=Math.min(endSample-startSample,driverSamples);
  const result={index,avatarId:shot.avatarId,requestedDuration:shot.duration,startFrame,endFrame,frameCount,startSample,endSample,
   driverSamples,copiedSamples,trimmedDriverSamples:endSample-startSample-copiedSamples,paddedDriverSamples:driverSamples-copiedSamples};
  startFrame=endFrame;return result;
 });
 return {sampleRate:16000,fps,frameCount:timing.frameCount,duration:timing.duration,audioSamples:samples,audioDuration:timing.audioDuration,
  requestedDuration:requested,shots:timeline,framePolicy:'cumulative-round-final-ceil-v1',audioPolicy:'complete-original-track-v1'};
}

async function inspectVideo(media,file,{fps,width,height,frames},signal,{audioDuration}={}){
 const {ffmpeg,ffprobe}=media.binaries();
 const probe=JSON.parse(await runProcess(ffprobe,['-v','error','-count_frames','-show_streams','-show_format','-of','json',file],{signal}));
 const pictures=probe.streams.filter(stream=>stream.codec_type==='video'),picture=pictures[0];
 if(pictures.length!==1||picture.width!==width||picture.height!==height||Number(picture.nb_read_frames)!==frames||picture.avg_frame_rate!==fps+'/1'||picture.r_frame_rate!==fps+'/1')throw Error('多镜头输出的画幅、帧率或实际帧数不符');
 const timeline=JSON.parse(await runProcess(ffprobe,['-v','error','-select_streams','v:0','-show_entries','frame=best_effort_timestamp_time','-of','json',file],{signal})).frames;
 if(timeline.length!==frames||timeline.some((frame,index)=>!Number.isFinite(Number(frame.best_effort_timestamp_time))||Math.abs(Number(frame.best_effort_timestamp_time)-index/fps)>1e-5))throw Error('多镜头输出时间轴不连续');
 if(audioDuration!==undefined){const sounds=probe.streams.filter(stream=>stream.codec_type==='audio');if(sounds.length!==1||!Number.isFinite(Number(sounds[0].duration))||Math.abs(Number(sounds[0].duration)-audioDuration)>.05)throw Error('多镜头未完整覆盖原驱动音轨');}
 await runProcess(ffmpeg,['-v','error','-xerror','-i',file,'-f','null','-'],{signal});
 return probe;
}

async function prepareSequence({context,directory,media,signal}){
 signal?.throwIfAborted();
 if(!path.isAbsolute(directory))throw Error('多镜头工作目录必须是绝对路径');
 const shots=context.input.shots,sources=context.input.shotAvatars;
 if(!Array.isArray(shots)||!shots.length||sources.length!==shots.length)throw Error('多镜头形象快照不完整');
 const originalAudio={path:context.audio.path,sha256:digest(context.audio.path)};
 const distinct=new Map();
 for(const [index,shot]of shots.entries()){
  const source=sources[index];if(source.avatarId!==shot.avatarId||source.source.type!=='video')throw Error('镜头形象与快照不一致或不是视频');
  const file=source.source.path;
  if(!distinct.has(file))distinct.set(file,{path:file,sha256:digest(file)});
 }
 fs.mkdirSync(directory);
 let preparedIndex=0;
 for(const source of distinct.values()){
  const prepared=await prepareVideoSource({videoPath:source.path,normalizedPath:path.join(directory,'prepared-source-'+preparedIndex+'.mp4'),media,signal});
  Object.assign(source,prepared.plan,{preparedPath:prepared.video.path,preparedSha256:prepared.video.sha256,videoPreparation:prepared.videoPreparation});preparedIndex++;
 }
 const first=distinct.get(sources[0].source.path),fps=Math.max(10,first.fps),width=first.width,height=first.height;
 const normalizedAudio=path.join(directory,'original-16k.wav');
 await runProcess(media.binaries().ffmpeg,['-v','error','-n','-i',originalAudio.path,'-map','0:a:0','-vn','-ac','1','-ar','16000','-c:a','pcm_s16le',normalizedAudio],{signal});
 const timeline=sequencePlan(readPcm(normalizedAudio).samples,fps,shots);
 let sourceIndex=0;
 for(const source of distinct.values()){
  const count=Math.max(...timeline.shots.filter(shot=>sources[shot.index].source.path===source.path).map(shot=>shot.frameCount));
  if(source.fps===fps&&source.width===width&&source.height===height){source.normalizedPath=source.preparedPath;source.conversion=source.videoPreparation.conversion;}
  else{
   source.normalizedPath=path.join(directory,'source-'+sourceIndex+'.mp4');source.conversion='fps-and-aspect-fit-black-pad-v1';
   const limit=Math.max(1/fps,Math.min(source.sourceFrameCount/source.fps,Math.max(1,count/fps)));
   await runProcess(media.binaries().ffmpeg,['-v','error','-n','-i',source.preparedPath,'-map','0:v:0','-an','-t',String(limit),'-vf',`tpad=stop_mode=clone:stop_duration=${1/fps},fps=${fps},scale=${width}:${height}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1`,
    '-c:v','libx264','-preset','fast','-crf','16','-pix_fmt','yuv420p','-video_track_timescale',String(fps*1000),source.normalizedPath],{signal});
  }
  source.normalizedSha256=digest(source.normalizedPath);videoPlan(await probeVideo(media,source.normalizedPath,signal));sourceIndex++;
 }
 for(const shot of timeline.shots){
  const source=distinct.get(sources[shot.index].source.path),shotRoot=path.join(directory,'shot-'+String(shot.index).padStart(4,'0'));
  fs.mkdirSync(shotRoot);shot.directory=shotRoot;shot.source=source;
  shot.audio=path.join(shotRoot,'segment.wav');
  await runProcess(media.binaries().ffmpeg,['-v','error','-n','-i',normalizedAudio,'-af',`atrim=start_sample=${shot.startSample}:end_sample=${shot.startSample+shot.copiedSamples},asetpts=PTS-STARTPTS,apad=whole_len=${shot.driverSamples},atrim=end_sample=${shot.driverSamples}`,'-c:a','pcm_s16le',shot.audio],{signal});
  if(readPcm(shot.audio).samples!==shot.driverSamples)throw Error('镜头模型驱动采样数不符');
  shot.audioSha256=digest(shot.audio);
 }
 if(digest(originalAudio.path)!==originalAudio.sha256||[...distinct.values()].some(source=>digest(source.path)!==source.sha256))throw Error('准备多镜头期间源文件已变化');
 const plan={kind:'musetalk-sequence-input',version:1,at:new Date().toISOString(),...timeline,width,height,originalAudio,normalizedAudio,normalizedAudioSha256:digest(normalizedAudio),sources:[...distinct.values()],
  modelExecuted:false,newVideoGenerated:false,qualityAccepted:false};
 fs.writeFileSync(path.join(directory,'plan.json'),JSON.stringify(plan,null,2),{flag:'wx'});return plan;
}

async function assembleSequence({plan,parts,directory,media,signal}){
 if(parts.length!==plan.shots.length)throw Error('多镜头真实生成片段不完整');
 const names=[];
 for(const [index,part]of parts.entries()){
  const shot=plan.shots[index];if(part.index!==index||part.sha256!==digest(part.path))throw Error('镜头生成片段已变化或顺序不符');
  const name='render-'+String(index).padStart(4,'0')+'.mp4',file=path.join(directory,name);
  await runProcess(media.binaries().ffmpeg,['-v','error','-n','-i',part.path,'-map','0:v:0','-an','-vf',`trim=end_frame=${shot.frameCount},setpts=N/(${plan.fps}*TB)`,'-frames:v',String(shot.frameCount),'-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p','-video_track_timescale',String(plan.fps*1000),file],{signal});
  await inspectVideo(media,file,{fps:plan.fps,width:plan.width,height:plan.height,frames:shot.frameCount},signal);names.push(name);
 }
 const list=path.join(directory,'concat.txt');fs.writeFileSync(list,names.map(name=>"file '"+name+"'").join('\n'),{flag:'wx'});
 const file=path.join(directory,'candidate.mp4');
 await runProcess(media.binaries().ffmpeg,['-v','error','-n','-f','concat','-safe','1','-i',list,'-i',plan.originalAudio.path,'-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac','-b:a','192k','-movflags','+faststart',file],{signal});
 const probe=await inspectVideo(media,file,{fps:plan.fps,width:plan.width,height:plan.height,frames:plan.frameCount},signal,{audioDuration:plan.audioDuration});
 return {path:file,sha256:digest(file),frames:plan.frameCount,width:plan.width,height:plan.height,fps:plan.fps,duration:plan.duration,probe};
}

async function generateSequence({store,media,context,ctx,home,python,integration,runWorker,verifyReceipt}){
 const root=fs.mkdtempSync(path.join(store.outputDir(),'.musetalk-multi-'));let asset,currentDirectory=root;
 try{
  ctx.progress?.(2,'正在准备多镜头时间轴与形象');
  const plan=await prepareSequence({context,directory:path.join(root,'sequence'),media,signal:ctx.signal}),directory=path.join(root,'sequence');
  const planFile=path.join(directory,'plan.json'),planSha256=digest(planFile),parts=[];
  const {ffmpeg,ffprobe}=media.binaries();let completed=0;
  const estimated=plan.shots.reduce((sum,shot)=>sum+Math.ceil(shot.driverSamples*plan.fps/16000),0);
  for(const shot of plan.shots){
   ctx.signal?.throwIfAborted();if(digest(planFile)!==planSha256||digest(shot.source.normalizedPath)!==shot.source.normalizedSha256||digest(shot.audio)!==shot.audioSha256)throw Error('多镜头计划或驱动文件已变化');
   const inputDirectory=path.join(shot.directory,'input'),worker=path.join(shot.directory,'worker');currentDirectory=worker;
   const input=await prepareProductionInput({videoPath:shot.source.normalizedPath,audioPath:shot.audio,directory:inputDirectory,media,signal:ctx.signal});
   if(input.frameCount<shot.frameCount||input.fps!==plan.fps||input.width!==plan.width||input.height!==plan.height)throw Error('镜头工作器输入与时间轴不符');
   ctx.progress?.(5+85*completed/estimated,'正在生成镜头 '+(shot.index+1)+' / '+plan.shots.length);
   await runWorker({python,args:['-u',integration('worker.py'),'--home',home,'--input',path.join(inputDirectory,'input.json'),'--output',worker,'--ffmpeg',ffmpeg,'--ffprobe',ffprobe],directory:shot.directory,signal:ctx.signal,
    onStart:pid=>ctx.local?.({kind:'musetalk-local-v1',mode:'multi',root,directory:worker,shotIndex:shot.index,shotCount:plan.shots.length,pid,startedAt:new Date().toISOString()}),
    onEvent:event=>{const n=event.stage==='inferred'?event.completed:undefined;ctx.activity?.({kind:'musetalk-local-v1',mode:'multi',stage:event.stage,shotIndex:shot.index,shotCount:plan.shots.length,completed:n===undefined?completed:completed+n,total:estimated,observedAt:event.at});if(n!==undefined)ctx.progress?.(Math.min(90,5+85*(completed+n)/estimated));}});
   ctx.signal?.throwIfAborted();const receipt=verifyReceipt(worker,input,path.join(inputDirectory,'input.json'));
   parts.push({index:shot.index,path:receipt.output.path,sha256:receipt.output.sha256,generatedFrames:receipt.generatedFrames,retainedFrames:shot.frameCount,inferenceCalls:receipt.inferenceCalls,inputManifest:path.join(inputDirectory,'input.json'),receiptPath:path.join(worker,'result.json')});
   completed+=receipt.generatedFrames;
   fs.writeFileSync(path.join(directory,'part-'+shot.index+'.json'),JSON.stringify(parts.at(-1),null,2),{flag:'wx'});
  }
  ctx.progress?.(92,'正在拼接镜头并核对完整音轨');
  const output=await assembleSequence({plan,parts,directory,media,signal:ctx.signal});
  ctx.signal?.throwIfAborted();
  if(digest(planFile)!==planSha256||!require('./avatar-request.cjs').avatarFilesCurrent(context)||digest(plan.originalAudio.path)!==plan.originalAudio.sha256||plan.sources.some(source=>digest(source.path)!==source.sha256))throw Error('多镜头生成期间原形象、驱动或计划已变化，结果未登记');
  const receipt={kind:'musetalk-sequence-result',version:1,status:'technical-complete',at:new Date().toISOString(),inputManifestSha256:planSha256,newVideoGenerated:true,inferenceVerified:true,
   fullDecodeVerified:true,timelineVerified:true,generatedFrames:parts.reduce((sum,part)=>sum+part.generatedFrames,0),retainedFrames:plan.frameCount,inferenceCalls:parts.reduce((sum,part)=>sum+part.inferenceCalls,0),parts,output,qualityAccepted:false,referenceParityAccepted:false};
  const receiptPath=path.join(directory,'result.json');fs.writeFileSync(receiptPath,JSON.stringify(receipt,null,2),{flag:'wx'});
  asset=store.addAsset(output.path,{origin:'local-musetalk',name:'本地多镜头-'+crypto.randomUUID().slice(0,8)+'.mp4',duration:plan.duration,avatarRequest:context.input,
   lipSync:{engine:'musetalk-local',model:'MuseTalk 1.5',mode:'multi',sourceFramePolicy:'per-shot-forward-reverse-repeat-endpoints-v1',sourceVideoReusedOutsideFace:true,drivingAudioId:context.audio.id,newSpeechGeneratedHere:false,
    frames:plan.frameCount,inferredFrames:receipt.generatedFrames,inferenceCalls:receipt.inferenceCalls,shotCount:parts.length,outputSha256:output.sha256,receiptPath,qualityAccepted:false,referenceParityAccepted:false}},{persist:false});
  ctx.signal?.throwIfAborted();store.save();return asset;
 }catch(error){
  if(asset){store.data.assets=store.data.assets.filter(item=>item.id!==asset.id);fs.rmSync(asset.path,{force:true});}
  const failure={kind:'musetalk-local-v1',mode:'multi',root,directory:currentDirectory,error:error.message,registered:false,at:new Date().toISOString()};
  try{fs.writeFileSync(path.join(root,'failed.json'),JSON.stringify(failure,null,2),{flag:'wx'});}catch{}
  error.evidence=failure;throw error;
 }
}
module.exports={sequencePlan,prepareSequence,assembleSequence,inspectVideo,generateSequence};
