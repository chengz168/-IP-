const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const {prepareProductionInput}=require('../integrations/musetalk-local/production-input.cjs');
const {digest}=require('../integrations/musetalk-local/input.cjs');
const unpack=file=>file.replace('app.asar'+path.sep,'app.asar.unpacked'+path.sep);
const integration=name=>unpack(path.join(__dirname,'..','integrations','musetalk-local',name));

function runtimeOptions(config){
 const home=String(config.musetalkHome||'').trim();
 if(!home||!path.isAbsolute(home))throw Error('请在模型设置中填写本地 MuseTalk 环境的完整路径');
 const python=path.join(home,'.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
 if(!fs.existsSync(python))throw Error('本地 MuseTalk 独立Python环境缺失，请先检查模型环境');
 return {home,python};
}

function runWorker({python,args,directory,signal,onEvent,onStart,timeout=4*60*60*1000,cancelGrace=20000}){
 signal?.throwIfAborted();
 return new Promise((resolve,reject)=>{
  const child=spawn(python,args,{windowsHide:true,env:{...process.env,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8',HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1'}});
  let tail='',line='',failure,abortTimer,termination,settled=false;
  const stopTree=()=>{
   if(termination)return termination;
   termination=new Promise(done=>{
    if(process.platform==='win32'&&child.pid){const killer=spawn('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});killer.on('error',()=>{child.kill();done();});killer.on('close',code=>{if(code)child.kill();done();});}
    else{child.kill();done();}
   });return termination;
  };
  const stop=()=>{
   try{fs.writeFileSync(path.join(directory,'cancel.request'),'cancelled');}catch(error){if(error.code!=='ENOENT')failure??=error;}
   abortTimer??=setTimeout(stopTree,cancelGrace);
  };
  const timer=setTimeout(()=>{failure=Error('本地口型运行超时，已停止本次进程');stopTree();},timeout);
  signal?.addEventListener('abort',stop,{once:true});
  child.once('spawn',()=>{try{onStart?.(child.pid);if(signal?.aborted)stop();}catch(error){failure=error;stopTree();}});
  child.stdout.on('data',chunk=>{
   line+=chunk.toString('utf8');
   if(line.length>65536){line=line.slice(-65536);}
   let end;
   while((end=line.indexOf('\n'))!==-1){const current=line.slice(0,end);line=line.slice(end+1);try{const event=JSON.parse(current);if(event.stage&&!signal?.aborted)onEvent?.(event);}catch(error){if(error instanceof SyntaxError)continue;failure=error;stopTree();}}
  });
  child.stderr.on('data',chunk=>{tail=(tail+chunk).slice(-6000);});
  child.on('error',error=>{failure=Error('本地口型进程启动失败：'+error.message);});
  child.once('close',async code=>{
   if(settled)return;settled=true;
   clearTimeout(timer);clearTimeout(abortTimer);signal?.removeEventListener('abort',stop);
   if(termination)await termination;
   if(signal?.aborted)return reject(Error('本地口型生成已取消，未绑定视频'));
   if(failure)return reject(failure);
   if(code!==0)return reject(Error('本地口型生成失败（退出码'+code+'）：'+tail.slice(-1800)));
   resolve({code});
  });
 });
}

function verifyReceipt(directory,plan,inputFile=path.join(directory,'..','input','input.json')){
 const receipt=JSON.parse(fs.readFileSync(path.join(directory,'result.json'),'utf8')),expected=path.join(directory,'candidate.mp4');
 if(receipt.status!=='technical-complete'||receipt.inferenceVerified!==true||receipt.newVideoGenerated!==true||receipt.fullDecodeVerified!==true||receipt.generatedFrames!==plan.frameCount||!Number.isSafeInteger(receipt.inferenceCalls)||receipt.inferenceCalls<1||path.resolve(receipt.output?.path||'')!==expected||receipt.output.frames!==plan.frameCount||receipt.output.width!==plan.width||receipt.output.height!==plan.height||receipt.output.fps!==plan.fps||digest(expected)!==receipt.output.sha256)throw Error('本地口型未返回完整有效的真实推理回执');
 if(receipt.inputManifestSha256!==digest(inputFile))throw Error('本地口型回执的输入清单不匹配');
 const snapshot=JSON.parse(fs.readFileSync(path.join(directory,'input-snapshot.json'),'utf8'));
 if(JSON.stringify(snapshot)!==JSON.stringify(plan))throw Error('本地口型工作器使用了不同输入');
 return receipt;
}

class LocalMuseTalk{
 constructor(store,media){this.store=store;this.media=media;this.running=false;}
 async exclusive(work){if(this.running)throw Error('本地口型模型正在使用，请等待或停止当前生成');this.running=true;try{return await work();}finally{this.running=false;}}
 async check(ctx={}){return this.exclusive(async()=>{
  const {home,python}=runtimeOptions(this.store.data.settings.provider),directory=fs.mkdtempSync(path.join(this.store.outputDir(),'.musetalk-check-')),file=path.join(directory,'check.json');
  await runWorker({python,args:['-u',integration('check.py'),'--home',home,'--full-hash','--device','--result',file],directory,signal:ctx.signal,timeout:180000});
  const result=JSON.parse(fs.readFileSync(file,'utf8'));
  if(result.kind!=='musetalk-readiness')throw Error('本地口型检查未返回有效结果');
  return result;
 });}
 async generate(draft,ctx={},context){return this.exclusive(async()=>{
  if(context.input.mode==='multi'){
   const {home,python}=runtimeOptions({musetalkHome:context.input.musetalkHome});
   return require('./musetalk-sequence.cjs').generateSequence({store:this.store,media:this.media,context,ctx,home,python,integration,runWorker,verifyReceipt});
  }
  if(context.input.mode!=='single')throw Error('不支持的视频形象模式');
  const {home,python}=runtimeOptions({musetalkHome:context.input.musetalkHome}),root=fs.mkdtempSync(path.join(this.store.outputDir(),'.musetalk-run-'));
  const inputDirectory=path.join(root,'input'),directory=path.join(root,'worker');let asset;
  const input=await prepareProductionInput({videoPath:context.video.path,audioPath:context.audio.path,directory:inputDirectory,media:this.media,signal:ctx.signal});
  ctx.signal?.throwIfAborted();
  const {ffmpeg,ffprobe}=this.media.binaries();
  const activity=event=>{
   const completed=event.stage==='inferred'?event.completed:undefined;
   ctx.activity?.({kind:'musetalk-local-v1',stage:event.stage,completed,total:input.frameCount,observedAt:event.at});
   if(completed!==undefined)ctx.progress?.(Math.min(95,10+85*completed/input.frameCount));
  };
  ctx.progress?.(3,'正在核对本地口型模型与输入');
  try{
   await runWorker({python,args:['-u',integration('worker.py'),'--home',home,'--input',path.join(inputDirectory,'input.json'),'--output',directory,'--ffmpeg',ffmpeg,'--ffprobe',ffprobe],directory:root,signal:ctx.signal,onEvent:activity,
    onStart:pid=>ctx.local?.({kind:'musetalk-local-v1',directory,root,pid,startedAt:new Date().toISOString()})});
   ctx.signal?.throwIfAborted();
   const receipt=verifyReceipt(directory,input);
   const {avatarFilesCurrent}=require('./avatar-request.cjs');
   // 路径内容变化直接失败；任务配置变化由现有avatarCurrent保护迟到绑定。
   if(!avatarFilesCurrent(context)||digest(context.video.path)!==input.video.sha256||digest(context.audio.path)!==input.audio.sha256)throw Error('本地口型生成期间源文件变化，结果未登记');
   asset=this.store.addAsset(receipt.output.path,{origin:'local-musetalk',name:'本地口型-'+crypto.randomUUID().slice(0,8)+'.mp4',duration:input.duration,
    avatarRequest:context.input,lipSync:{engine:'musetalk-local',model:'MuseTalk 1.5',sourceFramePolicy:input.sourceFramePolicy,sourceVideoReusedOutsideFace:true,
     drivingAudioId:context.audio.id,newSpeechGeneratedHere:false,frames:receipt.generatedFrames,inferenceCalls:receipt.inferenceCalls,outputSha256:receipt.output.sha256,
     receiptPath:path.join(directory,'result.json'),qualityAccepted:false,referenceParityAccepted:false}},{persist:false});
   ctx.signal?.throwIfAborted();this.store.save();return asset;
  }catch(error){
   if(asset){this.store.data.assets=this.store.data.assets.filter(item=>item.id!==asset.id);fs.rmSync(asset.path,{force:true});}
   error.evidence={kind:'musetalk-local-v1',root,directory};throw error;
  }
 });}
}
module.exports={LocalMuseTalk,runtimeOptions,runWorker,verifyReceipt};
