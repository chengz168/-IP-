const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {setTimeout:sleep}=require('node:timers/promises');
const {runProcess}=require('./media.cjs');
const {h3Prompt}=require('./h3-plan.cjs');
const {observeComfy}=require('./comfy-progress.cjs');
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const node=(class_type,inputs)=>({class_type,inputs});
const graphSignature=graph=>crypto.createHash('sha256').update(JSON.stringify(graph,(_,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,value[key]])):value)).digest('hex');

function localBase(value){const url=new URL(value);if(url.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw Error('本地 H3 接入需填写本机 ComfyUI 的 HTTP 地址');return url.toString().replace(/\/$/,'');}
function buildGraph({image,audio,duration,portrait,seed,prefix}){
 const frames=Math.ceil((Math.ceil(duration*24)-5)/17)*17+5;
 return {
  '1':node('UNETLoader',{unet_name:'minimax_h3_fl2va_pruned_int8_convrot.safetensors',weight_dtype:'default'}),
  '2':node('CLIPLoader',{clip_name:'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors',type:'minimax',device:'default'}),
  '3':node('VAELoader',{vae_name:'minimax_h3_video_vae_int8_convrot.safetensors'}),
  '4':node('VAELoader',{vae_name:'minimax_h3_audio_vae_fp32.safetensors'}),
  '5':node('LoraLoaderModelOnly',{model:['1',0],lora_name:'minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors',strength_model:1}),
  '6':node('MiniMaxH3ImageToVideo',{clip:['2',0],vae:['3',0],first_frame:['17',0],
   prompt:h3Prompt(duration),
   width:portrait?608:1056,height:portrait?1056:608,length:frames}),
  '7':node('MiniMaxH3SigmaShift',{model:['5',0],shift_video:12,shift_audio:3}),
  '8':node('RandomNoise',{noise_seed:seed}),'9':node('KSamplerSelect',{sampler_name:'res_multistep'}),
  '10':node('BasicScheduler',{model:['7',0],scheduler:'simple',steps:8,denoise:1}),
  '11':node('BasicGuider',{model:['7',0],conditioning:['19',0]}),
  '12':node('SamplerCustomAdvanced',{noise:['8',0],guider:['11',0],sampler:['9',0],sigmas:['10',0],latent_image:['6',1]}),
  '13':node('VAEDecode',{samples:['12',0],vae:['3',0]}),'14':node('VAEDecodeAudio',{samples:['12',0],vae:['4',0]}),
  '15':node('CreateVideo',{images:['13',0],audio:['14',0],fps:24,bit_depth:8}),
  '16':node('SaveVideo',{video:['15',0],filename_prefix:prefix,format:'auto','format.codec':'auto'}),
  '17':node('LoadImage',{image}),'18':node('LoadAudio',{audio}),
  '19':node('MiniMaxH3AddGuide',{positive:['6',0],latent:['6',1],frame_idx:0,audio_vae:['4',0],audio:['18',0]}),
 };
}

class ComfyH3{
 constructor(store,media){this.store=store;this.media=media;}
 observe(remote,ctx={},details={}){return observeComfy({baseUrl:localBase(remote.baseUrl),clientId:remote.clientId,graph:remote.graph,signal:ctx.signal,onActivity:ctx.activity,...details});}
 sequence(){if(!this.sequenceRunner){const {H3Sequence}=require('./h3-sequence.cjs');this.sequenceRunner=new H3Sequence(this.store,this.media,this);}return this.sequenceRunner;}
 async request(base,route,options={},ctx={}){
   await this.store.localEnvironment?.ensureComfy(base,ctx);
  const address=localBase(base),deadline=AbortSignal.timeout(20000),signal=ctx.signal?AbortSignal.any([ctx.signal,deadline]):deadline;
  try{return await fetch(address+route,{...options,signal});}
  catch(cause){
   // 这里只说明连接阶段；提交是否可能生效仍由submit及原任务凭据判断。
   const message=ctx.signal?.aborted?'ComfyUI 请求已停止：'+address:deadline.aborted||cause.name==='TimeoutError'?'ComfyUI 请求超时：'+address+'，请检查服务状态后重试原查询':'无法连接 ComfyUI 本地服务：'+address+'，请先启动该服务并核对模型设置中的地址';
     throw Object.assign(new Error(message,{cause}),{stopBatch:true,environmentFailure:true});
  }
 }
 async json(base,route,options={},ctx={}){
  const response=await this.request(base,route,options,ctx);let result,parseError;
  try{result=await response.json();}catch(error){
   if(ctx.signal?.aborted)throw new Error('ComfyUI 请求已停止：'+localBase(base),{cause:error});
   if(error.name==='TimeoutError'||error.name==='AbortError')throw new Error('ComfyUI 响应读取超时：'+localBase(base)+'，请检查服务状态后重试原查询',{cause:error});
   parseError=error;
  }
  // HTTP拒绝即使返回非JSON也保留状态，避免把明确拒绝误判为提交结果未知。
  if(!response.ok){const error=new Error('ComfyUI 返回HTTP '+response.status+'：'+localBase(base)+(parseError?'，服务未返回有效JSON':'：'+JSON.stringify(result).slice(0,1000)),parseError?{cause:parseError}:undefined);error.httpStatus=response.status;throw error;}
  if(parseError)throw new Error('ComfyUI 响应不是有效JSON：'+localBase(base),{cause:parseError});return result;
 }
 async upload(base,file,subfolder,ctx){const form=new FormData();form.set('image',new Blob([fs.readFileSync(file)]),path.basename(file));form.set('type','input');form.set('subfolder',subfolder);const result=await this.json(base,'/upload/image',{method:'POST',body:form},ctx);if(typeof result.name!=='string'||typeof result.subfolder!=='string'||result.type!=='input')throw Error('ComfyUI 没有返回有效输入文件');return {...result,sha256:sha(file)};}
 async submit(base,graph,tag,ctx){
  try{
   const result=await this.json(base,'/prompt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:graph,client_id:tag})},ctx);
   if(typeof result.prompt_id!=='string'||!result.prompt_id.trim())throw Error('ComfyUI 未返回本次任务 ID，提交结果仍待确认');
   return result.prompt_id;
  }catch(error){
   if(error.httpStatus>=400&&error.httpStatus<500){error.remoteConfirmed=true;throw error;}
   error.unknown=true;error.evidence={clientId:tag,baseUrl:base,graphSha256:graphSignature(graph)};throw error;
  }
 }
 async discover(remote,ctx={}){
  if(!remote.clientId||!remote.graph)throw Error('此记录缺少完整提交凭据，无法安全查找本地任务');
  const expected=graphSignature(remote.graph);
  if(remote.graphSha256&&remote.graphSha256!==expected)throw Error('保存的生成图与提交指纹不一致，未查回任务');
  const base=localBase(remote.baseUrl),matches=new Map();
  const inspect=row=>{
   if(!Array.isArray(row)||row[3]?.client_id!==remote.clientId||typeof row[1]!=='string'||!row[1].trim())return;
   // 队列和历史可能同时返回同一ID；逐条校验，不能让后来的正确图覆盖冲突证据。
   if(!row[2]||graphSignature(row[2])!==expected)throw Error('本地任务的生成图与原始提交不一致，未接收该任务');
   matches.set(row[1],row[2]);
  };
  const queue=await this.json(base,'/queue',{},ctx);
  for(const row of [...(queue.queue_running||[]),...(queue.queue_pending||[])])inspect(row);
  const history=await this.json(base,'/history?max_items=1000',{},ctx);
  for(const item of Object.values(history))inspect(item?.prompt);
  if(matches.size===0)throw Error('本机队列与最近1000条历史中未找到本次提交；结果仍待确认，不能直接重交');
  if(matches.size!==1)throw Error('同一提交标识匹配多个本地任务，结果仍待确认，未选择或重交任何任务');
  const [[id,graph]]=matches;
  if(graphSignature(graph)!==expected)throw Error('本地任务的生成图与原始提交不一致，未接收该任务');
  return id;
 }
 async query(remoteId,remote,ctx={}){
  const base=localBase(remote.baseUrl),history=await this.json(base,'/history/'+encodeURIComponent(remoteId),{},ctx),item=history[remoteId];
  if(item?.status?.status_str==='success'){
   const video=item.outputs?.['16']?.images?.find(row=>row.type==='output'&&/\.mp4$/i.test(row.filename));
   if(!video)throw Error('H3 任务完成但未返回视频，保留待确认状态');
   return {jobId:remoteId,status:'succeeded',video};
  }
  if(item?.status?.status_str==='error'){
   const interrupted=item.status.messages?.some(row=>row[0]==='execution_interrupted');
   return {jobId:remoteId,status:interrupted?'cancelled':'failed',error:JSON.stringify(item.status.messages).slice(-2000)};
  }
  const queue=await this.json(base,'/queue',{},ctx);
  if(queue.queue_running?.some(row=>row[1]===remoteId))return {jobId:remoteId,status:'running'};
  if(queue.queue_pending?.some(row=>row[1]===remoteId))return {jobId:remoteId,status:'queued'};
  throw Error('ComfyUI 暂未返回该任务的最终状态，请查询原任务，不能重新提交代替查询');
 }
 async collect(result,remote,input,ctx={},options={}){
  const directory=fs.mkdtempSync(path.join(this.store.outputDir(),'.h3-result-'));let created;
  try{
   const get=async(item,target)=>{const query=new URLSearchParams({filename:item.filename||item.name,subfolder:item.subfolder||'',type:item.type});const response=await this.request(remote.baseUrl,'/view?'+query,{},ctx);if(!response.ok)throw Error('H3 产物读取失败：HTTP '+response.status);fs.writeFileSync(target,Buffer.from(await response.arrayBuffer()));};
   const video=path.join(directory,'generated.mp4'),audio=path.join(directory,'driver.wav'),output=path.join(directory,'final.mp4');
   await get(result.video,video);await get(remote.audio,audio);
   if(sha(audio)!==remote.audio.sha256)throw Error('H3 上传的原驱动音频已变化，未封装结果');
   // H3固定24fps，按驱动时长向上取完整帧；shortest在AAC封装时会提前丢掉尾帧。
   const frameCount=Math.ceil(remote.duration*24);
   await runProcess(this.media.binaries().ffmpeg,['-v','error','-y','-i',video,'-i',audio,'-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac','-frames:v',String(frameCount),'-movflags','+faststart',output],{signal:ctx.signal});
   const info=await this.media.probe(output),duration=Number(info.format.duration);
   if(!info.streams.some(s=>s.codec_type==='video')||!info.streams.some(s=>s.codec_type==='audio')||!Number.isFinite(duration)||Math.abs(duration-remote.duration)>.15)throw Error('H3 输出的音视频流或时长不符合驱动输入');
   const picture=info.streams.find(stream=>stream.codec_type==='video'),sound=info.streams.find(stream=>stream.codec_type==='audio');
   if(picture.avg_frame_rate!=='24/1'||Number(picture.nb_frames)!==frameCount||Number(picture.duration)+.001<Number(sound.duration))throw Error('H3封装未保留覆盖完整驱动音轨的计划帧，原生成结果仍可沿任务ID查询');
   ctx.signal?.throwIfAborted();
   created=this.store.addAsset(output,{origin:'comfy-h3',duration,avatarRequest:input,h3:{promptId:result.jobId,model:'MiniMax H3',seed:remote.seed,
    sourceImageSha256:remote.image.sha256,driverSha256:remote.audio.sha256,generatedVideoSha256:sha(video),outputSha256:sha(output),audioOrigin:'uploaded-driver-remuxed',frameCount,muxPolicy:'ceil-driver-24fps-without-shortest-v1',qualityAccepted:false}},{persist:false});
   if(options.persist!==false)this.store.save();return created;
  }catch(error){if(created){this.store.data.assets=this.store.data.assets.filter(a=>a.id!==created.id);fs.rmSync(created.path,{force:true});}throw error;}
  finally{fs.rmSync(directory,{recursive:true,force:true});}
 }
 async generate(draft,ctx,context){
  const base=localBase(context.avatarUrl);
  if(!['single','multi'].includes(draft.video.mode))throw Error('本地 H3 视频模式无效');
  const info=await this.media.probe(context.audio.path),duration=Number(info.format.duration);
  if(!info.streams.some(s=>s.codec_type==='audio')||!Number.isFinite(duration)||duration<1)throw Error('本地 H3 需要至少1秒的有效驱动音频');
  if(duration>15||draft.video.mode==='multi')return this.sequence().generate(draft,ctx,context);
  const videoInfo=await this.media.probe(context.video.path),source=videoInfo.streams.find(s=>s.codec_type==='video');if(!source)throw Error('形象素材没有视频流');
  const directory=fs.mkdtempSync(path.join(this.store.outputDir(),'.h3-input-')),tag=crypto.randomUUID();let remoteId,remote,observer;
  try{
   const image=path.join(directory,'reference.png'),audio=path.join(directory,'driver.wav');
   await runProcess(this.media.binaries().ffmpeg,['-v','error','-y','-i',context.video.path,'-frames:v','1','-update','1',image],{signal:ctx.signal});
   await runProcess(this.media.binaries().ffmpeg,['-v','error','-y','-i',context.audio.path,'-map','0:a:0','-vn','-ac','1','-ar','32000','-c:a','pcm_s16le',audio],{signal:ctx.signal});
   if(!require('./avatar-request.cjs').avatarFilesCurrent(context))throw Error('形象或驱动音频已变化，本次未提交');
   const uploadedImage=await this.upload(base,image,'superip/'+tag,ctx),uploadedAudio=await this.upload(base,audio,'superip/'+tag,ctx);
   const graph=buildGraph({image:uploadedImage.subfolder+'/'+uploadedImage.name,audio:uploadedAudio.subfolder+'/'+uploadedAudio.name,duration,portrait:source.height>=source.width,seed:42,prefix:'superip/'+tag});
   ctx.signal?.throwIfAborted();
   // 提交仅执行一次；回包丢失时保留不确定状态，不通过重交来猜测成功。
   remote={kind:'comfy-h3-v1',baseUrl:base,statusUrl:base+'/history',image:uploadedImage,audio:uploadedAudio,duration,seed:42,graph,graphSha256:graphSignature(graph),clientId:tag,submissionState:'submitting'};
   // 在发送前持久保存凭据；进程退出或回包丢失时可查找原任务，不重新提交。
   ctx.remote('',remote);
   observer=await this.observe(remote,ctx);
   ctx.signal?.throwIfAborted();
   remoteId=await this.submit(base,graph,tag,ctx);
   remote={...remote,statusUrl:base+'/history/'+remoteId,submissionState:'accepted'};ctx.remote(remoteId,remote);
   observer.bind(remoteId);
   ctx.progress?.(12,'已提交本地 H3，等待新视频生成');
   const deadline=Date.now()+30*60*1000;
   while(Date.now()<deadline){
    ctx.signal?.throwIfAborted();observer.check();const state=await this.query(remoteId,remote,ctx);
    if(state.status==='succeeded'){observer.collecting();return await this.collect(state,remote,context.input,ctx);}
    if(['failed','cancelled'].includes(state.status)){const error=Error('本地 H3 已确认'+(state.status==='failed'?'生成失败':'取消')+'：'+state.error);error.remoteConfirmed=true;throw error;}
    await sleep(2000,undefined,{signal:ctx.signal});
   }
   const error=Error('本地 H3 查询超过30分钟，保留任务ID供后续查询');error.unknown=true;throw error;
  }catch(error){
   if(ctx.signal?.aborted&&remoteId){
    try{await this.json(base,'/queue',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({delete:[remoteId]})});await this.json(base,'/interrupt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt_id:remoteId})});}catch{}
   }
   throw error;
  }finally{observer?.close();fs.rmSync(directory,{recursive:true,force:true});}
 }
}
module.exports={ComfyH3,buildGraph,localBase,graphSignature};
