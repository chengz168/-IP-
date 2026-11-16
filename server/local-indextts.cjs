const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawn}=require('node:child_process');

const upstreamCommit='d9e41aac89fd00b3d71497fddb287b7f24613712';
const hashFile=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const unpack=file=>file.replace('app.asar'+path.sep,'app.asar.unpacked'+path.sep);
const modelManifest=require('../integrations/indextts-local/model-manifest.json');
const nonemptyFile=file=>{try{const stat=fs.statSync(file);return stat.isFile()&&stat.size>0;}catch{return false;}};

// 文件预检不启动解释器，不把文件齐备当成模型可推理。
function inspectEnvironment(config){
 const home=String(config.indexttsHome||'').trim();
 if(!home||!path.isAbsolute(home))throw Error('请在模型设置中填写本地 IndexTTS 环境的完整路径');
 const python=path.join(home,'upstream','.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
 const pythonPresent=nonemptyFile(python),setupFile=path.join(home,'setup.json'),setupPresent=nonemptyFile(setupFile);
 let setup,setupError='';
 if(setupPresent)try{setup=JSON.parse(fs.readFileSync(setupFile,'utf8').replace(/^\uFEFF/,''));}catch{setupError='安装完成记录无法读取，请检查原安装日志';}
 const versionMatched=setup?.upstream_revision===upstreamCommit,issues=[];
 if(!pythonPresent)issues.push('缺少独立 Python 解释器');
 if(!setupPresent)issues.push('依赖安装尚未完成：缺少 setup.json');
 else if(setupError)issues.push(setupError);
 else if(!versionMatched)issues.push('环境版本与已验证的接入版本不一致');
 const root=path.join(home,'upstream','checkpoints'),missingModels=modelManifest.required.filter(name=>!nonemptyFile(path.join(root,name)));
 for(const alternative of modelManifest.alternatives)if(!alternative.files.some(name=>nonemptyFile(path.join(root,name))))missingModels.push(alternative.label);
 if(!nonemptyFile(path.join(home,modelManifest.receipt)))missingModels.push(modelManifest.receipt+' (download completion record)');
 const dependenciesInstalled=pythonPresent&&setupPresent&&!setupError&&versionMatched;
 return {kind:'environment-check',home,python,pythonPresent,setupPresent,versionMatched,dependenciesInstalled,missingModels,issues,
  readyForProbe:dependenciesInstalled&&!missingModels.length,ready:false,cuda:null,torch:null,inferenceVerified:false,upstreamCommit};
}

function runtimeOptions(config){
 const home=String(config.indexttsHome||'').trim();
 if(!home||!path.isAbsolute(home))throw Error('请在模型设置中填写本地 IndexTTS 环境的完整路径');
 const python=path.join(home,'upstream','.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
 if(!fs.existsSync(python)||!fs.existsSync(path.join(home,'setup.json')))throw Error('本地 IndexTTS 依赖尚未安装完成');
 const setup=JSON.parse(fs.readFileSync(path.join(home,'setup.json'),'utf8'));
 if(setup.upstream_revision!==upstreamCommit)throw Error('本地 IndexTTS 环境版本与已验证的接入版本不一致');
 return {home,python};
}

// 每次生成由独立进程负责，取消后等待该进程退出，避免后台继续推理并写入迟到产物。
function runInference(python,args,ctx={},options={}){
 ctx.signal?.throwIfAborted();
 const commandArgs=options.commandArgs||['-u',unpack(path.join(__dirname,'local-indextts.py')),...args];
 return new Promise((resolve,reject)=>{
  const child=spawn(python,commandArgs,{windowsHide:true,cwd:options.cwd,env:{...process.env,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8',HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1'}});
  child.once('spawn',()=>{try{options.onStart?.(child.pid);}catch(cause){error=cause;terminate();}});
  let error,stderr='',stdout='',stopped=false,termination;
  // Windows虚拟环境解释器会派生实际Python进程，取消时停止整个所属进程树。
  const terminate=()=>{
   if(termination)return;
   if(process.platform==='win32'&&child.pid){
    termination=new Promise(resolve=>{
     const killer=spawn('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
     killer.on('error',()=>{child.kill();resolve();});
     killer.on('close',code=>{if(code!==0)child.kill();resolve();});
    });
   }else{child.kill();termination=Promise.resolve();}
  };
  const stop=()=>{stopped=true;terminate();};
  const timer=setTimeout(()=>{error=Error('本地声音生成超过允许时限，已停止');terminate();},options.timeout||30*60*1000);
  ctx.signal?.addEventListener('abort',stop,{once:true});if(ctx.signal?.aborted)stop();
  child.stdout.on('data',chunk=>{stdout=(stdout+chunk).slice(-4000);});
  child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-6000);});
  child.on('error',cause=>{error=Error(cause.code==='ENOENT'?'未找到本地 IndexTTS 的 Python 解释器':'本地声音进程启动失败：'+cause.message);});
  child.on('close',async code=>{
   if(termination)await termination;
   clearTimeout(timer);ctx.signal?.removeEventListener('abort',stop);
   if(stopped||ctx.signal?.aborted)return reject(Error('本地声音生成已取消'));
   if(error)return reject(error);
   if(code!==0)return reject(Error('本地声音生成失败（退出码'+code+'）：'+stderr.slice(-2000)));
   resolve({code,stdout,stderr});
  });
 });
}

function validateMastering(mastering,policy){
 if(mastering?.policy!==policy||!Array.isArray(mastering.stages)||!mastering.stages.length||mastering.stages.some(stage=>!stage||stage.location!=='bigvgan.conv_post-before-clamp'||!Number.isFinite(stage.sourcePeak)||stage.sourcePeak<0||!Number.isFinite(stage.gain)||stage.gain<=0||stage.gain>1||stage.targetPeak!==.95||stage.sourcePeak*stage.gain>.95001))throw Error('本地声音没有返回有效的量化前峰值处理记录');
}

class LocalIndexTTS{
 constructor(store,media){this.store=store;this.media=media;this.running=false;}
 async exclusive(work){if(this.running)throw Error('本地声音模型正在使用，请等待或停止当前生成');this.running=true;try{return await work();}finally{this.running=false;}}
 async check(config=this.store.data.settings.provider,ctx={}){
  return this.exclusive(async()=>{
   const inspection=inspectEnvironment(config);
   if(!inspection.readyForProbe)return inspection;
   const {home,python}=runtimeOptions(config),directory=fs.mkdtempSync(path.join(this.store.outputDir(),'.indextts-check-'));
   try{
    const result=path.join(directory,'result.json');
    await runInference(python,['--home',home,'--result',result,'--check'],ctx,{cwd:path.join(home,'upstream'),timeout:120000});
    const data=JSON.parse(fs.readFileSync(result,'utf8'));
    if(data.kind!=='environment-check'||typeof data.cuda!=='boolean'||!Array.isArray(data.missingModels)||data.upstreamCommit!==upstreamCommit)throw Error('本地声音环境未返回有效检查结果');
    return {...inspection,...data,ready:data.cuda&&!data.missingModels.length,inferenceVerified:false,
     issues:data.cuda?[]:['Torch 未检测到可用 CUDA，当前声音接入需要 CUDA 环境']};
   }catch(error){
    if(ctx.signal?.aborted)throw error;
    return {...inspection,issues:[error.message],ready:false};
   }finally{fs.rmSync(directory,{recursive:true,force:true});}
  });
 }
 async synthesize(draft,ctx={},context){
  return this.exclusive(async()=>{
   const {speechInput,speechDuration}=await import('./speech-config.mjs');
   const {speechRequest,speechEvidence}=require('./speech-request.cjs');
   const input=speechInput(draft,context.provider),request=speechRequest(draft,context);
   const {home,python}=runtimeOptions(context.provider);
   const sample=context.assets?.find(asset=>asset.id===request.referenceId);
   if(!sample||sample.type!=='audio'||!fs.existsSync(sample.path))throw Error('请选择已保存的本地音频样本');
   const referenceHash=hashFile(sample.path);
   if(referenceHash!==request.referenceSha256)throw Error('声音样本文件已经变化，请重新生成');
   const prosodySample=request.prosodyReferenceId?context.assets?.find(asset=>asset.id===request.prosodyReferenceId):null;
   if(request.prosodyReferenceId&&(!prosodySample||prosodySample.type!=='audio'||!fs.existsSync(prosodySample.path)))throw Error('参考韵律音频不存在，请重新选择');
   const prosodyHash=prosodySample?hashFile(prosodySample.path):'';
   if(prosodySample&&prosodyHash!==request.prosodyReferenceSha256)throw Error('参考韵律音频已经变化，请重新选择');
   const info=await this.media.probe(sample.path),referenceDuration=speechDuration(info);
   if(referenceDuration<1||referenceDuration>60)throw Error('本地声音参考样本需为1至60秒，请先裁剪');
   const directory=fs.mkdtempSync(path.join(this.store.outputDir(),'.indextts-run-'));
   let asset;
   try{
    const output=path.join(directory,'speech.wav'),job=path.join(directory,'job.json'),result=path.join(directory,'result.json');
    fs.writeFileSync(job,JSON.stringify({text:input.text,reference:sample.path,output,language:request.language,
     speed:input.speed,emotion:prosodySample?null:(request.emotion==='depressed'?'melancholic':request.emotion||null),
     emotion_reference:prosodySample?.path||null,
     emotion_strength:request.strength,seed:42,overwrite:false}));
    ctx.progress?.(8,'正在加载本地声音模型并生成新配音');
    await runInference(python,['--home',home,'--job',job,'--result',result],ctx,{cwd:path.join(home,'upstream')});
    ctx.signal?.throwIfAborted();
    const receipt=JSON.parse(fs.readFileSync(result,'utf8'));
    if(receipt.kind!=='inference'||path.resolve(receipt.output)!==path.resolve(output)||receipt.model!=='IndexTTS-2.5'||receipt.upstreamCommit!==upstreamCommit)throw Error('本地声音进程未返回有效的推理收据');
    validateMastering(receipt.audio_mastering,request.audioPolicy);
    const probe=await this.media.probe(output),duration=speechDuration(probe);
    if(hashFile(sample.path)!==referenceHash)throw Error('参考样本在生成期间变化，未保存本次结果');
    if(prosodySample&&hashFile(prosodySample.path)!==prosodyHash)throw Error('参考韵律音频在生成期间变化，未保存本次结果');
    ctx.signal?.throwIfAborted();
    asset=this.store.addAsset(output,{origin:'local-indextts',name:'本地声音-'+crypto.randomUUID().slice(0,8)+'.wav',duration,
     speech:{engine:'indextts-local',model:receipt.model,upstreamCommit,seed:42,speed:input.speed,emotion:request.emotion,strength:request.strength,
     referenceId:sample.id,referenceSha256:referenceHash,prosodyReferenceId:prosodySample?.id||'',prosodyReferenceSha256:prosodyHash,outputSha256:hashFile(output),elapsedSeconds:receipt.elapsed_seconds,audioMastering:receipt.audio_mastering,request:speechEvidence(request)}},{persist:false});
    try{this.store.save();}catch(error){this.store.data.assets=this.store.data.assets.filter(item=>item.id!==asset.id);fs.rmSync(asset.path,{force:true});throw error;}
    return asset;
   }finally{fs.rmSync(directory,{recursive:true,force:true});}
  });
 }
}
module.exports={LocalIndexTTS,runtimeOptions,runInference,hashFile,upstreamCommit,inspectEnvironment,validateMastering};
