const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
const {appearanceOptions,appearanceRuntime,appearanceVideoPlan}=require('./avatar-appearance-config.mjs');
const digest=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const running=new WeakSet();

// 取消后等待本次进程树退出，不能在子进程仍写文件时回收目录。
function runAppearanceProcess(command,args,{signal,onEvent,onStart,timeoutMs=4*60*60*1000}={}){
 signal?.throwIfAborted();
 return new Promise((resolve,reject)=>{
  const child=spawn(command,args,{windowsHide:true,detached:process.platform!=='win32',env:{...process.env,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8',HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1'}});let stdout='',stderr='',line='',failure,termination;
  const stop=()=>{
   if(termination)return termination;
   termination=new Promise(done=>{
    if(process.platform==='win32'&&child.pid){const killer=spawn('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});killer.once('error',()=>{child.kill('SIGKILL');done();});killer.once('close',code=>{if(code&&child.exitCode===null)child.kill('SIGKILL');done();});}
    else{try{process.kill(-child.pid,'SIGKILL');}catch{child.kill('SIGKILL');}done();}
   });return termination;
  };
  const abort=()=>stop(),timer=setTimeout(()=>{failure=Error('人物优化处理超时，本次进程已停止');stop();},timeoutMs);
  signal?.addEventListener('abort',abort,{once:true});
  child.once('spawn',()=>{try{onStart?.(child.pid);if(signal?.aborted)stop();}catch(error){failure=error;stop();}});
  child.stdout.on('data',buffer=>{const chunk=buffer.toString('utf8');stdout+=chunk;if(stdout.length>16*1024*1024){failure=Error('人物优化进程输出超出安全上限');stop();}line+=chunk;for(let end;(end=line.indexOf('\n'))>=0;){const current=line.slice(0,end);line=line.slice(end+1);if(onEvent)try{const event=JSON.parse(current);if(!signal?.aborted)onEvent(event);}catch(error){if(!(error instanceof SyntaxError)){failure=error;stop();}}}});
  child.stderr.on('data',buffer=>{stderr=(stderr+buffer.toString('utf8')).slice(-8000);});
  child.once('error',error=>{failure=Error('人物优化进程启动失败：'+error.message);});
  child.once('close',async code=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);if(termination)await termination;if(signal?.aborted)return reject(Error('人物优化已取消，未保存新形象'));if(failure)return reject(failure);if(code!==0)return reject(Error('人物优化处理失败（退出码'+code+'）：'+stderr.slice(-2500)));resolve(stdout);});
 });
}

async function processAvatarAppearance(store,media,input,ctx={}){
 const options=appearanceOptions(input);if(running.has(store))throw Error('人物优化正在执行，请等待或停止当前处理');running.add(store);
 let directory,asset,poster,avatar,operationError,committed=false;const ownedTargets=[],cleanupWarnings=[];
 const cleanupWarning=(error,target)=>{
  const warning={kind:'avatar-appearance-cleanup-warning-v1',time:new Date().toISOString(),path:target,code:error.code||'',message:error.message};cleanupWarnings.push(warning);
  // 独立追加清理证据，清理失败不能覆盖已保存成功或原始取消/处理错误。
  try{fs.appendFileSync(path.join(store.root,'avatar-appearance-cleanup-warnings.jsonl'),JSON.stringify(warning)+'\n');}catch(logError){console.warn('人物优化清理告警无法写入：'+logError.message,warning);}
 };
 const registerAsset=(file,extra)=>{
  const id=crypto.randomUUID(),ext=path.extname(file).toLowerCase(),target=path.join(store.assetDir,id+ext);
  // 独占预留本次目标后记录所有权；即使复制中途失败，也只清理这一精确路径。
  const descriptor=fs.openSync(target,'wx');ownedTargets.push({id,path:target});fs.closeSync(descriptor);fs.copyFileSync(file,target);
  const value={id,name:path.basename(file),type:ext==='.mp4'?'video':'image',size:fs.statSync(target).size,path:target,category:'全部素材',tags:[],createdAt:new Date().toISOString(),...extra};store.data.assets.push(value);return value;
 };
 try{
  ctx.signal?.throwIfAborted();const original=store.data.avatars.find(item=>item.id===options.avatarId);if(!original)throw Error('原人物形象不存在，请重新选择');
  const originalSnapshot=structuredClone(original),source=structuredClone(store.asset(original.assetId));if(source.type!=='video')throw Error('人物优化需要有效的视频形象素材');
  const sourceSha256=digest(source.path),runtime=appearanceRuntime(store.data.settings.provider,options),modelSha256=runtime.model?digest(runtime.model):'',{ffmpeg,ffprobe}=media.binaries();
  const beautyModelHashes=(runtime.beautyModels||[]).map(file=>({path:file,sha256:digest(file)}));
  let backgroundImage,backgroundEvidence;
  if(options.background==='content-image'){
   const resolved=new(require('./avatar-background.cjs').AvatarBackground)({store,media}).resolve({id:options.id,avatarId:options.avatarId,assetId:options.backgroundAssetId});
   if(options.sourceHash!==resolved.evidence.source.sourceHash)throw Error('文案背景哈希与本次确认文案不匹配');
   backgroundImage={assetId:resolved.asset.id,path:resolved.asset.path,sha256:resolved.sha256};backgroundEvidence=resolved.evidence;
  }else if(options.background==='custom-image'){
   const image=store.asset(options.backgroundAssetId);if(image.type!=='image')throw Error('自选背景必须为实际图片素材');
   backgroundImage={assetId:image.id,path:image.path,sha256:digest(image.path)};backgroundEvidence={kind:'avatar-custom-background-v1'};
  }
  ctx.progress?.(2,'正在检查人物源视频与本机环境');
  const probe=async file=>JSON.parse(await runAppearanceProcess(ffprobe,['-v','error','-count_frames','-show_streams','-show_format','-of','json',file],{signal:ctx.signal}));
  directory=fs.mkdtempSync(path.join(store.outputDir(),'.avatar-appearance-'));
  // 沿用真实口型链路的输入适配，仅在临时目录转正向恒定帧率，不覆盖原件。
  const {prepareVideoSource}=require('../integrations/musetalk-local/production-input.cjs');
  const prepared=await prepareVideoSource({videoPath:source.path,normalizedPath:path.join(directory,'normalized.mp4'),media,signal:ctx.signal,processRunner:runAppearanceProcess});
  const originalInfo=await probe(source.path),plan=appearanceVideoPlan(await probe(prepared.video.path));
  plan.audio=(originalInfo.streams||[]).filter(stream=>stream.codec_type==='audio').map(stream=>({codec:stream.codec_name,duration:Number(stream.duration)||null}));
  const output=path.join(directory,'candidate.mp4'),manifest={kind:'avatar-appearance-input-v1',source:source.path,sourceSha256,preparedSource:prepared.video.path,preparedSha256:prepared.video.sha256,model:runtime.model,modelSha256,output,...options,plan,backgroundImage,beautyRuntime:runtime.beautyPython?{python:runtime.beautyPython,root:runtime.beautyRoot}:undefined,beautyModelHashes};
  const manifestFile=path.join(directory,'input.json');fs.writeFileSync(manifestFile,JSON.stringify(manifest,null,2),{flag:'wx'});
  const worker=path.join(__dirname,'..','integrations','portrait-matting','worker.py').replace('app.asar'+path.sep,'app.asar.unpacked'+path.sep);
  await runAppearanceProcess(runtime.python,['-u',worker,'--input',manifestFile,'--ffmpeg',ffmpeg],{signal:ctx.signal,onStart:pid=>ctx.local?.({kind:'avatar-appearance-v1',pid,directory,startedAt:new Date().toISOString()}),onEvent:event=>{if(event.stage==='processed')ctx.progress?.(Math.min(88,5+83*event.completed/plan.frames),'正在优化人物画面 '+event.completed+' / '+plan.frames);}});
  ctx.signal?.throwIfAborted();const receipt=JSON.parse(fs.readFileSync(path.join(directory,'result.json'),'utf8'));
  if(receipt.kind!=='avatar-appearance-result-v1'||receipt.frames!==plan.frames||receipt.sourceSha256!==sourceSha256||receipt.preparedSha256!==prepared.video.sha256||receipt.outputSha256!==digest(output)||receipt.modelSha256!==modelSha256||receipt.inputSha256!==digest(manifestFile))throw Error('人物优化工作器回执与输入或输出不一致');
  ctx.progress?.(92,'正在核对完整帧数、音轨与解码');const resultPlan=appearanceVideoPlan(await probe(output));
  if(resultPlan.width!==plan.width||resultPlan.height!==plan.height||resultPlan.frames!==plan.frames||Math.abs(resultPlan.fps-plan.fps)>1e-6||Math.abs(resultPlan.duration-plan.duration)>plan.durationTolerance||resultPlan.audio.length!==plan.audio.length||resultPlan.audio.some((audio,index)=>audio.codec!==plan.audio[index].codec||audio.duration&&plan.audio[index].duration&&Math.abs(audio.duration-plan.audio[index].duration)>plan.durationTolerance))throw Error('人物优化输出画幅、帧数、时长或原音轨不匹配');
  await runAppearanceProcess(ffmpeg,['-v','error','-xerror','-i',output,'-f','null','-'],{signal:ctx.signal});
  ctx.signal?.throwIfAborted();const appearance={kind:'avatar-appearance-v1',sourceAvatarId:original.id,sourceAssetId:source.id,sourceSha256,outputSha256:receipt.outputSha256,look:options.look,background:options.background,beautyStrength:options.beautyStrength,backgroundImage,backgroundEvidence,beautyModelHashes,engine:receipt.engine,parameters:receipt.parameters,modelSha256,videoPreparation:prepared.videoPreparation,frames:plan.frames,width:plan.width,height:plan.height,frameRate:plan.frameRate,audioPolicy:'copy-original-streams',fullDecodeVerified:true,qualityAccepted:false};
  const posterFile=path.join(directory,'poster.png');await runAppearanceProcess(ffmpeg,['-v','error','-n','-i',output,'-map','0:v:0','-frames:v','1','-update','1',posterFile],{signal:ctx.signal});
  // 最后一个异步媒体步骤完成后再核对来源，之后同步登记，避免封面生成期间的编辑穿过校验。
  ctx.signal?.throwIfAborted();const current=store.data.avatars.find(item=>item.id===options.avatarId),currentAsset=store.data.assets.find(item=>item.id===source.id);if(!current||JSON.stringify(current)!==JSON.stringify(originalSnapshot)||!currentAsset||currentAsset.path!==source.path||digest(source.path)!==sourceSha256||runtime.model&&digest(runtime.model)!==modelSha256)throw Error('优化期间原形象、源视频或模型变化，新结果未登记');
  if(beautyModelHashes.some(item=>digest(item.path)!==item.sha256))throw Error('优化期间人脸解析模型变化，新结果未登记');
  if(backgroundImage){const currentBackground=store.asset(backgroundImage.assetId);if(currentBackground.path!==backgroundImage.path||digest(currentBackground.path)!==backgroundImage.sha256)throw Error('优化期间背景图片变化，新结果未登记');}
  if(options.background==='content-image')new(require('./avatar-background.cjs').AvatarBackground)({store,media}).resolve({id:options.id,avatarId:options.avatarId,assetId:options.backgroundAssetId});
  asset=registerAsset(output,{origin:'avatar-appearance',name:'人物优化-'+crypto.randomUUID().slice(0,8)+'.mp4',duration:resultPlan.duration,appearance});
  poster=registerAsset(posterFile,{origin:'avatar-appearance-poster'});
  const avatarId=crypto.randomUUID(),appearanceLabel=options.background==='business-studio'?'商务演播室':options.background==='content-image'?'文案场景':options.background==='custom-image'?'自选背景':'自然画面';
  avatar={...originalSnapshot,id:avatarId,name:(original.name||'人物')+'·'+appearanceLabel+'·'+avatarId.slice(0,6),assetId:asset.id,posterId:poster.id,source:'avatar-appearance',createdAt:new Date().toISOString(),appearance};delete avatar.templateId;store.data.avatars.push(avatar);
  ctx.signal?.throwIfAborted();store.save();committed=true;return {avatar,asset};
 }catch(error){
  operationError=error;
  if(avatar)store.data.avatars=store.data.avatars.filter(item=>item.id!==avatar.id);
  const ids=new Set(ownedTargets.map(item=>item.id));store.data.assets=store.data.assets.filter(item=>!ids.has(item.id));
  for(const target of ownedTargets)try{fs.rmSync(target.path,{force:true});}catch(cleanupError){cleanupWarning(cleanupError,target.path);}
  throw error;
 }finally{
  running.delete(store);if(directory)try{fs.rmSync(directory,{recursive:true,force:true});}catch(error){cleanupWarning(error,directory);}
  if(cleanupWarnings.length){
   if(operationError)operationError.cleanupWarnings=cleanupWarnings;
   if(committed&&avatar){avatar.appearance.cleanupWarnings=cleanupWarnings;try{store.save();}catch(error){cleanupWarning(error,store.file);}}
  }
 }
}
module.exports={processAvatarAppearance,runAppearanceProcess};
