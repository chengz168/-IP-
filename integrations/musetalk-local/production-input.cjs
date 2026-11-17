const fs=require('node:fs'),path=require('node:path');
const {runProcess}=require('../../server/media.cjs');
const {digest}=require('./input.cjs');

function sourceIndex(index,count){const phase=index%(count*2);return phase<count?phase:count*2-1-phase;}
function videoPlan(info){
 const video=info.streams?.filter(stream=>stream.codec_type==='video');
 if(video?.length!==1)throw Error('本地口型需要包含唯一视频流的形象');
 const picture=video[0],rate=value=>{const [a,b]=String(value).split('/').map(Number);return a/b;};
 const fps=rate(picture.avg_frame_rate),nominal=rate(picture.r_frame_rate);
 const sourceFrameCount=Number(picture.nb_frames),width=Number(picture.width),height=Number(picture.height);
 if(!Number.isInteger(fps)||fps<1||fps>60||nominal!==fps)throw Error('本地口型当前需要1至60的整数恒定帧率形象，请明确转换后再导入');
 if(!Number.isSafeInteger(sourceFrameCount)||sourceFrameCount<1||![width,height].every(value=>Number.isSafeInteger(value)&&value>0&&value%2===0))throw Error('形象的帧数或偶数画面尺寸无效');
 if(width*height>3840*2160)throw Error('本地口型当前最高支持3840×2160像素数的形象');
 const rotation=Number(picture.side_data_list?.find(item=>item.rotation!==undefined)?.rotation||picture.tags?.rotate||0);
 if(!Number.isFinite(rotation)||rotation%360!==0)throw Error('本地口型不隐式旋转，请先准备方向正确的形象');
 return {width,height,fps,frameRate:picture.avg_frame_rate,sourceFrameCount,sourceFramePolicy:'forward-reverse-repeat-endpoints-v1'};
}
async function probeVideo(media,file,signal,processRunner=runProcess){
 signal?.throwIfAborted();
 return JSON.parse(await processRunner(media.binaries().ffprobe,['-v','error','-show_format','-show_streams','-of','json',file],{signal}));
}
async function constantTimeline(media,file,plan,signal,processRunner=runProcess){
 const text=await processRunner(media.binaries().ffprobe,['-v','error','-select_streams','v:0','-show_entries','frame=best_effort_timestamp_time','-of','csv=p=0',file],{signal});
 const times=text.split(/\r?\n/).map(line=>line.trim().split(',')[0]).filter(Boolean).map(Number);
 return times.length===plan.sourceFrameCount&&times.every((value,index)=>Number.isFinite(value)&&(!index||Math.abs(value-times[index-1]-1/plan.fps)<=1e-5));
}
async function prepareVideoSource({videoPath,normalizedPath,media,signal,processRunner=runProcess}){
 signal?.throwIfAborted();
 const originalVideo={path:videoPath,sha256:digest(videoPath)},info=await probeVideo(media,videoPath,signal,processRunner),pictures=info.streams?.filter(stream=>stream.codec_type==='video');
 if(pictures?.length!==1)throw Error('本地口型需要包含唯一视频流的形象');
 const picture=pictures[0];
 if(![picture.width,picture.height].every(value=>Number.isSafeInteger(Number(value))&&Number(value)>0))throw Error('形象视频的画面尺寸无效');
 const reasons=[];let plan;
 try{plan=videoPlan(info);}catch(error){reasons.push(error.message);}
 if(plan&&!await constantTimeline(media,videoPath,plan,signal,processRunner))reasons.push('原始帧时间戳不是完整恒定帧率');
 let file=videoPath;
 if(reasons.length){
  const rate=value=>{const [a,b]=String(value).split('/').map(Number);return a/b;};
  const average=rate(picture.avg_frame_rate),nominal=rate(picture.r_frame_rate),fps=Math.max(1,Math.min(60,Math.round(Number.isFinite(average)&&average>0?average:Number.isFinite(nominal)&&nominal>0?nominal:30)));
  // 自动旋转后再按实际画幅缩放；仅建立中间副本，不修改用户原视频。
  const dimension=axis=>`max(2,trunc(${axis}*min(1,sqrt(8294400/(iw*ih)))/2)*2)`;
  const filter=`setpts=PTS-STARTPTS,fps=${fps},scale=w='${dimension('iw')}':h='${dimension('ih')}',setsar=1`;
  await processRunner(media.binaries().ffmpeg,['-v','error','-n','-i',videoPath,'-map','0:v:0','-an','-sn','-dn','-vf',filter,'-c:v','libx264','-preset','fast','-crf','16','-pix_fmt','yuv420p','-fps_mode','cfr','-video_track_timescale',String(fps*1000),'-metadata:s:v:0','rotate=0','-movflags','+faststart',normalizedPath],{signal});
  signal?.throwIfAborted();file=normalizedPath;plan=videoPlan(await probeVideo(media,file,signal,processRunner));
  if(!await constantTimeline(media,file,plan,signal,processRunner))throw Error('自动适配后的形象视频时间轴验证失败');
 }
 signal?.throwIfAborted();
 if(digest(videoPath)!==originalVideo.sha256)throw Error('自动适配过程中原形象视频已变化');
 const video={path:file,sha256:digest(file)};
 return {plan,video,originalVideo,videoPreparation:{conversion:reasons.length?'integer-cfr-autorotate-even-size-v1':'none',reasons,originalSha256:originalVideo.sha256,normalizedSha256:video.sha256}};
}
function readPcm(file){
 const bytes=fs.readFileSync(file);let offset=12,samples,format;
 if(bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WAVE')throw Error('规范化驱动不是有效WAV');
 while(offset+8<=bytes.length){const size=bytes.readUInt32LE(offset+4),name=bytes.toString('ascii',offset,offset+4);if(offset+8+size>bytes.length)throw Error('驱动WAV已截断');
  if(name==='fmt '){if(size<16)throw Error('驱动格式块不完整');format={encoding:bytes.readUInt16LE(offset+8),channels:bytes.readUInt16LE(offset+10),rate:bytes.readUInt32LE(offset+12),bits:bytes.readUInt16LE(offset+22)};}
  if(name==='data'){if(samples!==undefined||size%2)throw Error('驱动采样块无效');samples=size/2;}offset+=8+size+(size%2);
 }
 if(samples===undefined||format?.encoding!==1||format.channels!==1||format.rate!==16000||format.bits!==16)throw Error('驱动必须为完整16kHz单声道16位PCM');
 return {samples};
}
function audioPlan(samples,fps){
 const audioDuration=samples/16000;
 if(!Number.isSafeInteger(samples)||audioDuration<1||audioDuration>600)throw Error('本地口型支持1至600秒的驱动音频');
 const frameCount=Math.ceil(samples*fps/16000),duration=frameCount/fps;
 // 特征尾部加一个采样，避免浮点floor在整帧边界少一帧；不改最终驱动音轨。
 const targetSamples=Math.ceil(frameCount*16000/fps)+1;
 return {audioSamples:samples,audioDuration,frameCount,duration,targetSamples,featurePaddingSamples:targetSamples-samples};
}
async function prepareProductionInput({videoPath,audioPath,directory,media,signal}){
 for(const file of [videoPath,audioPath])if(!path.isAbsolute(file)||!fs.statSync(file).isFile()||!fs.statSync(file).size)throw Error('形象和音轨必须是有效的绝对文件路径');
 if(!path.isAbsolute(directory))throw Error('本地口型输入目录必须是绝对路径');
 signal?.throwIfAborted();
 const videoHash=digest(videoPath),audioHash=digest(audioPath);
 fs.mkdirSync(directory);
 try{
  const prepared=await prepareVideoSource({videoPath,normalizedPath:path.join(directory,'video-normalized.mp4'),media,signal}),plan=prepared.plan;
  const normalized=path.join(directory,'audio-16k.wav');
  await runProcess(media.binaries().ffmpeg,['-v','error','-n','-i',audioPath,'-map','0:a:0','-vn','-ac','1','-ar','16000','-c:a','pcm_s16le',normalized],{signal});
  signal?.throwIfAborted();
  const pcm=readPcm(normalized),timing=audioPlan(pcm.samples,plan.fps),driverPath=path.join(directory,'driver-16k.wav');
  await runProcess(media.binaries().ffmpeg,['-v','error','-n','-i',normalized,'-af',`apad=whole_len=${timing.targetSamples}`,'-c:a','pcm_s16le',driverPath],{signal});
  if(readPcm(driverPath).samples!==timing.targetSamples)throw Error('特征驱动尾部静音采样数不符');
  signal?.throwIfAborted();
  if(digest(videoPath)!==videoHash||digest(audioPath)!==audioHash)throw Error('准备过程中形象或驱动已变化');
  const manifest={kind:'musetalk-production-input',version:2,at:new Date().toISOString(),...plan,...timing,
   extractedSourceFrames:Math.min(timing.frameCount,plan.sourceFrameCount),sampleRate:16000,channels:1,
   video:prepared.video,originalVideo:prepared.originalVideo,videoPreparation:prepared.videoPreparation,audio:{path:audioPath,sha256:audioHash},
   driver:{path:driverPath,sha256:digest(driverPath),samples:timing.targetSamples,sampleRate:16000,channels:1},
   modelExecuted:false,newVideoGenerated:false,qualityAccepted:false};
  fs.writeFileSync(path.join(directory,'input.json'),JSON.stringify(manifest,null,2),{flag:'wx'});return manifest;
 }catch(error){fs.writeFileSync(path.join(directory,'preparation-failed.json'),JSON.stringify({error:error.message,modelExecuted:false,newVideoGenerated:false},null,2));throw error;}
}
module.exports={prepareProductionInput,prepareVideoSource,probeVideo,videoPlan,audioPlan,sourceIndex,readPcm};
