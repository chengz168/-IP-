const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {runInference,hashFile}=require('./local-indextts.cjs');
const manifest=require('../integrations/qwen-voice-design/manifest.json');
const integration=name=>path.join(__dirname,'..','integrations','qwen-voice-design',name).replace('app.asar'+path.sep,'app.asar.unpacked'+path.sep);

function validateJob(value){
 if(!value||Object.keys(value).sort().join(',')!=='instruct,language,max_new_tokens,seed,text')throw Error('音色设计输入字段不完整');
 for(const [name,limit] of [['text',200],['instruct',1000]])if(typeof value[name]!=='string'||!value[name].trim()||value[name].length>limit||value[name].includes('\0'))throw Error(name==='text'?'请填写200字以内的试听正文':'请填写1000字以内的音色描述');
 if(value.language!=='Chinese'||!Number.isSafeInteger(value.seed)||value.seed<0||value.seed>4294967295||!Number.isSafeInteger(value.max_new_tokens)||value.max_new_tokens<128||value.max_new_tokens>2048)throw Error('音色设计语言或采样参数无效');
 return structuredClone(value);
}
function runtimeOptions(config){
 const home=String(config.voiceDesignHome||'').trim();
 if(!home||!path.isAbsolute(home))throw Error('请在模型设置中填写自主音色环境的完整路径');
 const python=path.join(home,'.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
 if(!fs.existsSync(python))throw Error('自主音色独立Python环境尚未安装完成');
 return {home,python};
}
function verifyReceipt(directory,job){
 const receipt=JSON.parse(fs.readFileSync(path.join(directory,'result.json'),'utf8')),output=path.join(directory,'voice-design.wav');
 if(receipt.status!=='technical-complete'||receipt.newSpeechGenerated!==true||receipt.inferenceStarted!==true||receipt.modelLoaded!==true||receipt.model!==manifest.repo||receipt.modelRevision!==manifest.revision||receipt.packageVersion!==manifest.package.version||receipt.referenceAudio!==null||JSON.stringify(receipt.job)!==JSON.stringify(job)||path.resolve(receipt.output||'')!==output||!fs.existsSync(output)||hashFile(output)!==receipt.outputSha256)throw Error('自主音色没有返回与当前输入一致的有效生成回执');
 if(!Number.isSafeInteger(receipt.samples)||!Number.isSafeInteger(receipt.sampleRate)||receipt.samples<=0||receipt.sampleRate<8000||receipt.sampleRate>96000||!Number.isFinite(receipt.duration)||Math.abs(receipt.duration-receipt.samples/receipt.sampleRate)>1e-6)throw Error('自主音色回执采样信息无效');
 return receipt;
}

class VoiceDesign{
 constructor(service){this.service=service;this.running=false;}
 async exclusive(work){if(this.running)throw Error('自主音色模型正在使用，请等待或停止当前任务');this.running=true;try{return await work();}finally{this.running=false;}}
 async check(){return this.exclusive(async()=>{
  const {store}=this.service,{home,python}=runtimeOptions(store.data.settings.provider),root=fs.mkdtempSync(path.join(store.outputDir(),'.voice-design-check-')),directory=path.join(root,'worker');
  await runInference(python,[],{},{commandArgs:['-u',integration('worker.py'),'--home',home,'--directory',directory,'--check'],timeout:180000});
  const receipt=JSON.parse(fs.readFileSync(path.join(directory,'result.json'),'utf8'));
  if(receipt.status!=='environment-ready'||receipt.environment?.ready!==true)throw Error('自主音色环境尚未就绪，请查看检查收据');
  return {ready:true,...receipt.environment,home,inferenceVerified:false};
 });}
 async generate({id,job}){
  const input=validateJob(job),{store,runtime,media}=this.service;store.draft(id);
  if(store.data.runs.some(run=>['running','queued','unknown'].includes(run.status)&&['voice-design','speech','speech-test','avatar'].includes(run.type)))throw Error('已有声音或视频任务正在处理，请等待或停止后再设计音色');
  const {home,python}=runtimeOptions(store.data.settings.provider);
  return this.exclusive(()=>runtime.run('voice-design',id,{job:input,home},async ctx=>{
   const root=fs.mkdtempSync(path.join(store.outputDir(),'.voice-design-run-')),directory=path.join(root,'worker'),jobFile=path.join(root,'job.json');let asset;
   fs.writeFileSync(jobFile,JSON.stringify(input));
   ctx.progress(1,'正在核对自主音色模型并生成真实试听音频');
   try{
    await runInference(python,[],ctx,{commandArgs:['-u',integration('worker.py'),'--home',home,'--directory',directory,'--job',jobFile],timeout:15*60*1000,onStart:pid=>ctx.local({kind:'qwen-voice-design',pid,root,directory,startedAt:new Date().toISOString()})});
    ctx.signal.throwIfAborted();const receipt=verifyReceipt(directory,input),probe=await media.probe(receipt.output),duration=Number(probe.format.duration),audio=probe.streams.find(stream=>stream.codec_type==='audio');
    if(!audio||Number(audio.sample_rate)!==receipt.sampleRate||!Number.isFinite(duration)||Math.abs(duration-receipt.duration)>.02)throw Error('自主音色实际媒体与生成收据不一致');
    const {runProcess}=require('./media.cjs');await runProcess(media.binaries().ffmpeg,['-v','error','-xerror','-i',receipt.output,'-f','null','-'],{signal:ctx.signal});
    ctx.signal.throwIfAborted();
    asset=store.addAsset(receipt.output,{origin:'qwen-voice-design',name:'自主音色-'+crypto.randomUUID().slice(0,8)+'.wav',duration,
     voiceDesign:{model:receipt.model,revision:receipt.modelRevision,packageVersion:receipt.packageVersion,job:input,referenceAudio:null,outputSha256:receipt.outputSha256,receiptPath:path.join(directory,'result.json'),qualityAccepted:false}},{persist:false});
    store.save();return {assetId:asset.id,duration,voiceDesign:asset.voiceDesign};
   }catch(error){if(asset){store.data.assets=store.data.assets.filter(item=>item.id!==asset.id);fs.rmSync(asset.path,{force:true});}let detail;try{detail=JSON.parse(fs.readFileSync(path.join(directory,'result.json'),'utf8'));}catch{}error.evidence={kind:'qwen-voice-design',root,directory};if(detail?.error)error.message='自主音色生成失败：'+detail.error;throw error;}
  }));
 }
 async save({id,assetId,name}){
  const {store}=this.service;store.draft(id);
  if(typeof name!=='string'||!name.trim()||name.trim().length>10)throw Error('请填写10字以内的声音名称');
  if(store.data.runs.some(run=>run.type==='voice-design'&&run.status==='running'))throw Error('音色尚在生成，请等待完成后试听保存');
  const asset=store.asset(assetId),record=store.data.runs.find(run=>run.type==='voice-design'&&run.draftId===id&&run.status==='succeeded'&&run.output?.assetId===assetId);
  if(!record||asset.origin!=='qwen-voice-design'||hashFile(asset.path)!==asset.voiceDesign?.outputSha256)throw Error('自主音色候选缺失、已变化或不属于当前任务，请重新生成');
  const prior=store.data.voices.find(voice=>voice.sampleId===assetId&&voice.provenance?.kind==='qwen-voice-design');if(prior)return prior;
  const resource={id:crypto.randomUUID(),name:name.trim(),sampleId:assetId,status:'sample-only',createdAt:new Date().toISOString(),
   provenance:{kind:'qwen-voice-design',runId:record.id,...structuredClone(asset.voiceDesign),savedByUser:true,qualityAccepted:false}};
  store.data.voices.push(resource);try{store.save();}catch(error){store.data.voices=store.data.voices.filter(item=>item.id!==resource.id);throw error;}return resource;
 }
}
module.exports={VoiceDesign,validateJob,runtimeOptions,verifyReceipt};
