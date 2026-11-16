const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {setTimeout:sleep}=require('node:timers/promises');
const {runProcess}=require('./media.cjs');
const {segmentPlan,multiShotPlan,digest,h3Prompt}=require('./h3-plan.cjs');
const {buildGraph,graphSignature,localBase}=require('./comfy-h3.cjs');
const hash=file=>digest(fs.readFileSync(file));
const previousReference=(plan,index)=>index>0&&(plan.referencePolicy==='previous-planned-last-frame-v1'||plan.referencePolicy==='shot-first-frame-with-continuations-v1'&&plan.segments[index].shotIndex===plan.segments[index-1].shotIndex);

class H3Sequence{
 constructor(store,media,h3){this.store=store;this.media=media;this.h3=h3;}
 async prepare(draft,ctx,context){
  const id=crypto.randomUUID(),directory=path.join(this.store.outputDir(),'.h3-sequence-'+id);fs.mkdirSync(directory);
  const fullAudio=path.join(directory,'driver.s16le'),image=path.join(directory,'reference.png');let saved=false;
  try{
   const sourceAudioSha256=hash(context.audio.path),sourceVideoSha256=hash(context.video.path),sourceAudio=path.join(directory,'original-driver'+path.extname(context.audio.path));
   fs.copyFileSync(context.audio.path,sourceAudio);
   if(hash(sourceAudio)!==sourceAudioSha256)throw Error('保存原驱动音频副本时文件已变化');
   await runProcess(this.media.binaries().ffmpeg,['-v','error','-y','-i',context.audio.path,'-map','0:a:0','-vn','-ac','1','-ar','32000','-c:a','pcm_s16le','-f','s16le',fullAudio],{signal:ctx.signal});
   await runProcess(this.media.binaries().ffmpeg,['-v','error','-y','-i',context.video.path,'-frames:v','1','-update','1',image],{signal:ctx.signal});
   const multi=draft.video.mode==='multi',timeline=multi?multiShotPlan(fs.readFileSync(fullAudio),context.input.shots):segmentPlan(fs.readFileSync(fullAudio)),videoInfo=await this.media.probe(context.video.path),video=videoInfo.streams.find(stream=>stream.codec_type==='video');
   if(!video)throw Error('形象素材没有视频流');
   if(multi){
    for(const shot of timeline.shots){
     const source=context.input.shotAvatars[shot.index];
     if(!source||source.avatarId!==shot.avatarId)throw Error('多镜头形象与输入快照不一致');
     shot.sourceVideo=source.source.path;shot.sourceVideoSha256=hash(shot.sourceVideo);
     shot.image=shot.index===0?image:path.join(directory,'reference-shot-'+shot.index+'.png');
     if(shot.index>0)await runProcess(this.media.binaries().ffmpeg,['-v','error','-y','-i',shot.sourceVideo,'-frames:v','1','-update','1',shot.image],{signal:ctx.signal});
     shot.imageSha256=hash(shot.image);
    }
   }
   for(const segment of timeline.segments){
    segment.audio=path.join(directory,'driver-'+segment.index+'.wav');
    await runProcess(this.media.binaries().ffmpeg,['-v','error','-y','-f','s16le','-ar','32000','-ac','1','-i',fullAudio,'-af',`atrim=start_sample=${segment.startSample}:end_sample=${segment.endSample},asetpts=PTS-STARTPTS`,'-c:a','pcm_s16le',segment.audio],{signal:ctx.signal});
    segment.audioSha256=hash(segment.audio);
   }
   if(!require('./avatar-request.cjs').avatarFilesCurrent(context)||hash(context.audio.path)!==sourceAudioSha256||hash(context.video.path)!==sourceVideoSha256||timeline.shots?.some(shot=>hash(shot.sourceVideo)!==shot.sourceVideoSha256))throw Error('生成分段计划期间输入已变化，未提交');
   const plan={...timeline,id,directory,baseUrl:localBase(context.avatarUrl),image,imageSha256:hash(image),fullAudio,fullAudioSha256:hash(fullAudio),
    sourceAudio,sourceAudioSha256,inputAudio:context.audio.path,sourceVideo:context.video.path,sourceVideoSha256,portrait:video.height>=video.width,promptVersion:'official-structure-audio-guide-v1',referencePolicy:multi?'shot-first-frame-with-continuations-v1':'previous-planned-last-frame-v1',...(multi?{mode:'multi'}:{})};
   const remote={kind:'comfy-h3-sequence-v1',baseUrl:plan.baseUrl,statusUrl:plan.baseUrl+'/history',plan,planSha256:digest(plan),segments:plan.segments.map(segment=>({index:segment.index,status:'planned',attempts:[]}))};
   // 一旦交给运行时保存，就保留计划文件；保存报错时也不能删除已有恢复凭据的输入。
   ctx.signal?.throwIfAborted();saved=true;ctx.remote(id,remote);return remote;
  }finally{if(!saved)fs.rmSync(directory,{recursive:true,force:true});}
 }
 validate(remote,{source=false}={}){
  if(remote.kind!=='comfy-h3-sequence-v1'||digest(remote.plan)!==remote.planSha256)throw Error('长片分段计划指纹不一致，已停止');
  const {plan}=remote;
  if(plan.referencePolicy!==undefined&&!['previous-planned-last-frame-v1','shot-first-frame-with-continuations-v1'].includes(plan.referencePolicy))throw Error('不支持此长片参考帧策略，未修改原计划');
  const multi=plan.referencePolicy==='shot-first-frame-with-continuations-v1';
  if(multi){
   if(plan.mode!=='multi'||!Array.isArray(plan.shots)||!plan.shots.length||!Array.isArray(plan.segments)||!plan.segments.length)throw Error('多镜头计划缺少形象或片段记录');
   let frame=0,sample=0;
   for(const [i,shot]of plan.shots.entries()){
    if(shot.index!==i||shot.startFrame!==frame||shot.startSample!==sample||!Number.isInteger(shot.endFrame)||shot.endFrame<=frame||shot.frameCount!==shot.endFrame-frame||shot.endSample!==Math.min(plan.totalSamples,Math.round(shot.endFrame*32000/24)))throw Error('多镜头计划的镜头时间轴不连续');
    frame=shot.endFrame;sample=shot.endSample;
   }
   if(frame!==plan.totalFrames||sample!==plan.totalSamples)throw Error('多镜头没有完整覆盖驱动音轨');
   frame=0;sample=0;
   for(const part of plan.segments){
    const shot=plan.shots[part.shotIndex];
    if(!shot||part.startFrame!==frame||part.startSample!==sample||part.startFrame<shot.startFrame||part.endFrame>shot.endFrame||part.frameCount!==part.endFrame-part.startFrame||part.endFrame<=part.startFrame||part.endSample!==Math.min(plan.totalSamples,Math.round(part.endFrame*32000/24)))throw Error('多镜头分段时间轴或形象引用无效');
    frame=part.endFrame;sample=part.endSample;
   }
   if(frame!==plan.totalFrames||sample!==plan.totalSamples)throw Error('多镜头分段未完整覆盖时间轴');
  }else if(plan.mode==='multi')throw Error('多镜头缺少明确的镜头首帧策略');
  if(localBase(remote.baseUrl)!==plan.baseUrl||!Array.isArray(remote.segments)||remote.segments.length!==plan.segments.length)throw Error('长片分段记录不完整');
  for(const [file,expected] of [[plan.image,plan.imageSha256],[plan.fullAudio,plan.fullAudioSha256],[plan.sourceAudio,plan.sourceAudioSha256],...plan.segments.map(segment=>[segment.audio,segment.audioSha256])])if(!fs.existsSync(file)||hash(file)!==expected)throw Error('长片计划的本地驱动或首帧已变化，未继续生成');
  if(source&&(!fs.existsSync(plan.inputAudio)||!fs.existsSync(plan.sourceVideo)||hash(plan.inputAudio)!==plan.sourceAudioSha256||hash(plan.sourceVideo)!==plan.sourceVideoSha256))throw Error('原驱动或形象文件已变化，未继续生成');
  if(multi)for(const shot of plan.shots){
   if(!fs.existsSync(shot.image)||hash(shot.image)!==shot.imageSha256)throw Error('多镜头首帧缺失或已变化，未继续生成');
   if(source&&(!fs.existsSync(shot.sourceVideo)||hash(shot.sourceVideo)!==shot.sourceVideoSha256))throw Error('多镜头原形象文件已变化，未继续生成');
  }
  for(let i=0;i<remote.segments.length;i++){
   const segment=remote.segments[i];if(segment.index!==i)throw Error('长片分段顺序不一致');
   if(segment.status==='succeeded'&&(!segment.output||!fs.existsSync(segment.output.path)||hash(segment.output.path)!==segment.output.sha256))throw Error('已完成片段文件缺失或已变化，未重交该片段');
   if(previousReference(plan,i)){
    const reference=segment.reference,previous=remote.segments[i-1];
    if(reference&&(previous.status!=='succeeded'||reference.sourceSegment!==i-1||reference.frame!==plan.segments[i-1].frameCount-1||reference.sourceSha256!==previous.output.sha256||!fs.existsSync(reference.path)||hash(reference.path)!==reference.sha256))throw Error('后续段的衔接首帧或上游依据已变化，未继续生成');
    if(segment.status!=='planned'&&!reference)throw Error('后续段缺少已经保存的衔接首帧，未改用原始首帧');
   }
   if(multi&&!previousReference(plan,i)&&segment.reference)throw Error('镜头切换不能继承上一镜头的衔接首帧');
  }
 }
 save(remote,index,patch,ctx){
  const next=structuredClone(remote);Object.assign(next.segments[index],patch);ctx.signal?.throwIfAborted();ctx.remote(next.plan.id,next);return next;
 }
 async extractReference(remote,index,ctx){
  const previous=remote.segments[index-1],frame=remote.plan.segments[index-1].frameCount-1;
  if(previous?.status!=='succeeded')throw Error('上一段尚未完成，不能生成后续衔接首帧');
  const file=path.join(remote.plan.directory,'reference-'+index+'-'+crypto.randomUUID()+'.png');
  try{
   // 取最终拼接实际保留的末帧，不能取H3为对齐长度额外生成的尾帧。
   await runProcess(this.media.binaries().ffmpeg,['-v','error','-y','-i',previous.output.path,'-vf',`select='eq(n,${frame})'`,'-frames:v','1','-fps_mode','passthrough','-update','1',file],{signal:ctx.signal});
   if(!fs.existsSync(file)||!fs.statSync(file).size)throw Error('未能从上一段提取实际拼接末帧');
   ctx.signal?.throwIfAborted();return {path:file,sha256:hash(file),sourceSegment:index-1,sourceSha256:previous.output.sha256,frame};
  }catch(error){fs.rmSync(file,{force:true});throw error;}
 }
 async download(result,remote,index,ctx){
  const segment=remote.plan.segments[index],file=path.join(remote.plan.directory,'generated-'+index+'.mp4'),temp=file+'.'+crypto.randomUUID()+'.tmp';
  try{
   const params=new URLSearchParams({filename:result.video.filename,subfolder:result.video.subfolder||'',type:'output'});
   const response=await this.h3.request(remote.baseUrl,'/view?'+params,{},ctx);if(!response.ok)throw Error('H3片段下载失败：HTTP '+response.status);
   fs.writeFileSync(temp,Buffer.from(await response.arrayBuffer()));
   const probe=await this.media.probe(temp),video=probe.streams.find(stream=>stream.codec_type==='video');
   if(!video||Number(probe.format.duration)+.001<segment.frameCount/24||Number(video.width)!==(remote.plan.portrait?608:1056)||Number(video.height)!==(remote.plan.portrait?1056:608))throw Error('H3片段尺寸或时长不满足计划，未拼接');
   await runProcess(this.media.binaries().ffmpeg,['-v','error','-i',temp,'-map','0:v:0','-f','null','-'],{signal:ctx.signal});
   ctx.signal?.throwIfAborted();fs.renameSync(temp,file);return {path:file,sha256:hash(file),promptId:result.jobId,qualityAccepted:false};
  }finally{fs.rmSync(temp,{force:true});}
 }
 async step(remote,ctx,{submit=false,retry=false}={}){
  this.validate(remote,{source:submit});
  const index=remote.segments.findIndex(segment=>segment.status!=='succeeded');
  if(index<0)return {remote,status:'succeeded'};
  let segment=remote.segments[index];
  if(segment.status==='failed'){
   if(!retry)return {remote,status:'awaiting_continue',error:segment.error};
   remote=this.save(remote,index,{status:'planned',remoteId:'',remote:undefined,error:'',attempts:[...segment.attempts,{remoteId:segment.remoteId,remote:segment.remote,error:segment.error,endedAt:segment.endedAt}]},ctx);segment=remote.segments[index];
  }
  if(segment.status==='planned'){
   if(!submit)return {remote,status:'awaiting_continue'};
   ctx.beforeSubmit?.();
   if(previousReference(remote.plan,index)&&!segment.reference){
    const reference=await this.extractReference(remote,index,ctx);this.validate(remote,{source:true});ctx.beforeSubmit?.();
    remote=this.save(remote,index,{reference},ctx);segment=remote.segments[index];
   }
   const tag=crypto.randomUUID(),part=remote.plan.segments[index];
   const imageFile=previousReference(remote.plan,index)?segment.reference.path:remote.plan.mode==='multi'?remote.plan.shots[part.shotIndex].image:remote.plan.image;
   const image=await this.h3.upload(remote.baseUrl,imageFile,'superip/'+tag,ctx),audio=await this.h3.upload(remote.baseUrl,part.audio,'superip/'+tag,ctx);
   const graph=buildGraph({image:image.subfolder+'/'+image.name,audio:audio.subfolder+'/'+audio.name,duration:part.duration,portrait:remote.plan.portrait,seed:42+index,prefix:'superip/'+tag});
   graph['6'].inputs.prompt=h3Prompt(part.duration);
   const submitted={kind:'comfy-h3-v1',baseUrl:remote.baseUrl,statusUrl:remote.baseUrl+'/history',clientId:tag,graph,graphSha256:graphSignature(graph),image,audio,duration:part.duration,seed:42+index,submissionState:'submitting'};
   this.validate(remote,{source:true});ctx.beforeSubmit?.();
   remote=this.save(remote,index,{status:'submitting',remoteId:'',remote:submitted},ctx);
   await ctx.observeSegment?.(submitted,'',index,remote.segments.length);
   ctx.signal?.throwIfAborted();
   try{
    const id=await this.h3.submit(remote.baseUrl,graph,tag,ctx);
    remote=this.save(remote,index,{status:'accepted',remoteId:id,remote:{...submitted,submissionState:'accepted',statusUrl:remote.baseUrl+'/history/'+encodeURIComponent(id)}},ctx);
   }catch(error){
    if(error.remoteConfirmed&&!ctx.signal?.aborted)remote=this.save(remote,index,{status:'failed',error:error.message,endedAt:new Date().toISOString()},ctx);
    error.unknown=true;throw error;
   }
  }
  segment=remote.segments[index];
  if(!segment.remoteId){
   const id=await this.h3.discover(segment.remote,ctx);
   remote=this.save(remote,index,{status:'accepted',remoteId:id,remote:{...segment.remote,submissionState:'accepted',statusUrl:remote.baseUrl+'/history/'+encodeURIComponent(id)}},ctx);segment=remote.segments[index];
  }
  await ctx.observeSegment?.(segment.remote,segment.remoteId,index,remote.segments.length);
  const result=await this.h3.query(segment.remoteId,segment.remote,ctx);
  if(result.jobId!==segment.remoteId)throw Error('H3片段查询返回了不同任务ID');
  if(['failed','cancelled'].includes(result.status)){
   remote=this.save(remote,index,{status:'failed',error:result.error||'片段生成已确认失败',endedAt:new Date().toISOString()},ctx);
   return {remote,status:'awaiting_continue',error:remote.segments[index].error};
  }
  if(result.status==='succeeded'){
   ctx.collectingSegment?.();
   const output=await this.download(result,remote,index,ctx);remote=this.save(remote,index,{status:'succeeded',output,endedAt:new Date().toISOString()},ctx);
   ctx.progress?.(Math.min(95,Math.round(remote.segments.filter(segment=>segment.status==='succeeded').length/remote.segments.length*95)),'已取回第'+(index+1)+'/'+remote.segments.length+'段新画面，质量待检查');
   return {remote,status:remote.segments.every(segment=>segment.status==='succeeded')?'succeeded':'awaiting_continue'};
  }
  if(!['queued','running'].includes(result.status))throw Error('H3片段状态无法确认');
  return {remote,status:'pending'};
 }
 async execute(remote,ctx,{submit=false,retry=false}={}){
  const deadline=Date.now()+Math.max(30,remote.segments.length*20)*60*1000;let outcome,observer,clientId;
  const observing={...ctx,observeSegment:async(part,id,index,count)=>{
   if(typeof this.h3.observe!=='function')return;
   if(clientId!==part.clientId){observer?.close();clientId=part.clientId;observer=await this.h3.observe(part,ctx,{segmentIndex:index,segmentCount:count});}
   if(id)observer.bind(id);observer.check();
  },collectingSegment:()=>observer?.collecting()};
  try{
  do{
   ctx.signal?.throwIfAborted();observer?.check();outcome=await this.step(remote,observing,{submit,retry});remote=outcome.remote;retry=false;
   if(outcome.status==='succeeded'||!submit||outcome.error)return {...outcome,jobId:remote.plan.id,progress:Math.round(remote.segments.filter(segment=>segment.status==='succeeded').length/remote.segments.length*95)};
   if(outcome.status==='pending')await sleep(2000,undefined,{signal:ctx.signal});
  }while(Date.now()<deadline);
  throw Object.assign(Error('长片等待超过允许时限，保留各段原任务，稍后查询或继续'),{unknown:true});
  }finally{observer?.close();}
 }
 async collect(remote,input,ctx={},options={}){
  this.validate(remote);if(!remote.segments.every(segment=>segment.status==='succeeded'))throw Error('分段尚未全部完成，不能标记长片成功');
  const directory=fs.mkdtempSync(path.join(remote.plan.directory,'.assemble-'));let created;
  try{
   const list=[];
   for(const part of remote.plan.segments){
    const name='part-'+part.index+'.mp4',file=path.join(directory,name);
    // 各段只保留计划覆盖的新画面帧；不补帧、不循环、不拼接片段音轨。
    await runProcess(this.media.binaries().ffmpeg,['-v','error','-y','-i',remote.segments[part.index].output.path,'-map','0:v:0','-an','-vf',`fps=24,trim=end_frame=${part.frameCount},setpts=PTS-STARTPTS`,'-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p',file],{signal:ctx.signal});
    const probe=await this.media.probe(file),video=probe.streams.find(stream=>stream.codec_type==='video');
    if(Number(video?.nb_frames)!==part.frameCount)throw Error('裁切片段的实际帧数与计划不一致');
    list.push("file '"+name+"'");
   }
   const manifest=path.join(directory,'parts.txt'),output=path.join(directory,'final.mp4');fs.writeFileSync(manifest,list.join('\n'));
   // 音轨可能在最后一帧内部结束，不能用shortest丢弃已覆盖计划的尾帧。
   await runProcess(this.media.binaries().ffmpeg,['-v','error','-y','-f','concat','-safe','1','-i',manifest,'-i',remote.plan.sourceAudio,'-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac','-movflags','+faststart',output],{signal:ctx.signal});
   const info=await this.media.probe(output),duration=Number(info.format.duration),video=info.streams.find(stream=>stream.codec_type==='video');
   if(!info.streams.some(stream=>stream.codec_type==='audio')||!video||Number(video.nb_frames)!==remote.plan.totalFrames||Math.abs(duration-remote.plan.duration)>.12)throw Error('长片实际音视频流、帧数或总时长不满足计划');
   await runProcess(this.media.binaries().ffmpeg,['-v','error','-i',output,'-f','null','-'],{signal:ctx.signal});this.validate(remote);ctx.signal?.throwIfAborted();
   created=this.store.addAsset(output,{origin:'comfy-h3-sequence',duration,avatarRequest:input,h3:{model:'MiniMax H3',planId:remote.plan.id,planSha256:remote.planSha256,segments:remote.segments.map(segment=>({index:segment.index,promptId:segment.remoteId,sha256:segment.output.sha256,...(remote.plan.mode==='multi'?{shotIndex:remote.plan.segments[segment.index].shotIndex,avatarId:remote.plan.shots[remote.plan.segments[segment.index].shotIndex].avatarId}:{})})),sourceImageSha256:remote.plan.imageSha256,driverSha256:remote.plan.sourceAudioSha256,outputSha256:hash(output),audioOrigin:'original-full-driver-remuxed',qualityAccepted:false}},{persist:false});
   if(options.persist!==false)this.store.save();return created;
  }catch(error){if(created){this.store.data.assets=this.store.data.assets.filter(asset=>asset.id!==created.id);fs.rmSync(created.path,{force:true});}throw error;}
  finally{fs.rmSync(directory,{recursive:true,force:true});}
 }
 async generate(draft,ctx,context){
  ctx.beforeSubmit=()=>{if(!require('./avatar-request.cjs').avatarCurrent(context.input,this.store,this.store.draft(draft.id)))throw Error('分段生成的输入或配置已变化，未提交下一段');};
  const remote=await this.prepare(draft,ctx,context),result=await this.execute(remote,ctx,{submit:true});
  if(result.status!=='succeeded')throw Object.assign(Error('分段生成已暂停，成功片段已保留，请在执行详情查询或继续。'+(result.error||'')),{unknown:true});
  return this.collect(result.remote,context.input,ctx);
 }
}
module.exports={H3Sequence};
