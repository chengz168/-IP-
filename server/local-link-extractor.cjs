const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const {validateReferenceDuration}=require('./reference-media-limits.cjs');
const {shareLink}=require('./share-link.mjs');
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const maxBytes=200*1024*1024;
// 只有画面分析显式请求无声视频时，才允许绕过不存在的音轨识别。
function sourceAudio(info,options={}){
 if(options.allowSilentVideo!==undefined&&typeof options.allowSilentVideo!=='boolean')throw Error('无声视频选项必须为布尔值');
 const hasAudio=info.streams.some(stream=>stream.codec_type==='audio'),hasVideo=info.streams.some(stream=>stream.codec_type==='video');
 if(!hasAudio&&!(options.allowSilentVideo===true&&hasVideo))throw Error('链接对应媒体没有音轨，无法提取口播文案');
 return hasAudio;
}
const silentResult=()=>({text:'',segments:[],timingAvailable:false,unavailableReason:'源视频没有音轨，仅能分析实际可见画面',engine:'none',hasAudio:false});
function extractionMode(config){const mode=config.extractProtocol||(config.extractUrl?'bridge':'local');if(!['local','browser-session','bridge'].includes(mode))throw Error('链接提取接入方式无效');return mode;}
function runWorker(python,worker,args,ctx={},timeout=180000){
 ctx.signal?.throwIfAborted();
 return new Promise((resolve,reject)=>{
  const child=spawn(python,['-u',worker,...args],{windowsHide:true,env:{...process.env,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8',PYTHONDONTWRITEBYTECODE:'1'}});
  let output='',stderr='',reason='',failure,termination;
  const terminate=()=>{
   if(termination)return;
   if(process.platform==='win32'&&child.pid)termination=new Promise(done=>{const killer=spawn('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});killer.on('error',()=>{child.kill();done();});killer.on('close',code=>{if(code!==0)child.kill();done();});});
   else{child.kill();termination=Promise.resolve();}
  };
  const stop=()=>{reason='本地链接提取已取消';terminate();},timer=setTimeout(()=>{reason='本地链接解析超过允许时限，请检查网络或缩短媒体';terminate();},timeout);
  ctx.signal?.addEventListener('abort',stop,{once:true});if(ctx.signal?.aborted)stop();
  child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
  child.stdout.on('data',chunk=>{output+=chunk;if(output.length>1024*1024){failure=Error('链接解析结果超过限制');terminate();}});
  child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-6000);});child.on('error',error=>{failure=Error(error.code==='ENOENT'?'未找到本地链接解析器的Python解释器':'本地解析进程启动失败：'+error.message);});
  child.on('close',async code=>{
   if(termination)await termination;clearTimeout(timer);ctx.signal?.removeEventListener('abort',stop);
   if(reason||ctx.signal?.aborted)return reject(Error(reason||'本地链接提取已取消'));if(failure)return reject(failure);
   let result;try{result=JSON.parse(output.trim().split(/\r?\n/).at(-1));}catch{}
   if(code!==0||result?.error)return reject(Error('本地链接解析失败：'+String(result?.error||stderr||'退出码'+code).slice(-2000)));
   if(!result||typeof result!=='object'||Array.isArray(result))return reject(Error('本地链接解析器返回无效结果'));resolve(result);
  });
 });
}
class LocalLinkExtractor{
 constructor(store,media,providers){this.store=store;this.media=media;this.providers=providers;}
 options(){
  const config=this.store.data.settings.provider,python=config.extractPythonPath||'',packagePath=config.extractPackagePath||'';
  if(!path.isAbsolute(python)||!fs.existsSync(python)||!fs.statSync(python).isFile())throw Error('请在模型设置中配置链接解析Python解释器完整路径');
  if(!path.isAbsolute(packagePath)||!fs.existsSync(path.join(packagePath,'yt_dlp','__main__.py')))throw Error('请在模型设置中配置已安装的yt-dlp包目录');
  const file=path.resolve(__dirname,'..','integrations','local-link-extractor','worker.py'),worker=file.replace('app.asar'+path.sep,'app.asar.unpacked'+path.sep);
  return {python,packagePath,worker};
 }
 async check(ctx={}){const {python,packagePath,worker}=this.options(),result=await runWorker(python,worker,['--package',packagePath,'--mode','check'],ctx,30000);if(result.engine!=='yt-dlp'||typeof result.version!=='string'||!/^\d{4}\.\d{2}\.\d{2}(?:\..+)?$/.test(result.version))throw Error('解析器未返回可验证版本');return {...result,ready:true,platformsVerified:false};}
 async extract(value,ctx={},extractOptions={}){
  if(extractOptions.preferVideo!==undefined&&typeof extractOptions.preferVideo!=='boolean')throw Error('优先视频参数必须为布尔值');
  if(extractOptions.allowSilentVideo!==undefined&&typeof extractOptions.allowSilentVideo!=='boolean')throw Error('无声视频选项必须为布尔值');
  const url=shareLink(value),{python,packagePath,worker}=this.options(),cookieFile=extractOptions.cookieFile||'',directory=fs.mkdtempSync(path.join(this.store.outputDir(),'.link-input-'));let asset;
  if(cookieFile&&(!path.isAbsolute(cookieFile)||!fs.existsSync(cookieFile)||!fs.statSync(cookieFile).isFile()))throw Error('浏览器会话 Cookie 文件无效');
  const cookieArgs=cookieFile?['--cookies',cookieFile]:[];
  try{
   ctx.progress?.(5,'正在解析视频分享链接');
   const metadata=await runWorker(python,worker,['--package',packagePath,'--url',url,'--mode','metadata','--output',directory,...cookieArgs],ctx);
   if(metadata.is_live)throw Error('只支持非直播音视频');
   if(metadata.duration!=null)validateReferenceDuration(metadata.duration,'链接媒体');
   ctx.progress?.(15,'正在下载链接对应的音视频');
   const downloaded=await runWorker(python,worker,['--package',packagePath,'--url',url,'--mode','download','--output',directory,...cookieArgs,...(extractOptions.preferVideo?['--prefer-video']:[])],ctx,10*60*1000);
   if(typeof downloaded.file!=='string'||path.dirname(path.resolve(downloaded.file))!==directory||fs.lstatSync(downloaded.file).isSymbolicLink())throw Error('解析器返回的媒体文件不在本次独立目录');
   const stat=fs.statSync(downloaded.file);if(!stat.isFile()||stat.size<=0||stat.size>maxBytes)throw Error('下载媒体为空或超过200MB');
   const info=await this.media.probe(downloaded.file),duration=Number(info.format.duration);
   const hasAudio=sourceAudio(info,extractOptions);
   validateReferenceDuration(duration,'链接媒体');
   ctx.signal?.throwIfAborted();
   asset=this.store.addAsset(downloaded.file,{type:info.streams.some(stream=>stream.codec_type==='video')?'video':'audio',origin:'local-link-extract',sourceUrl:url,sourceTitle:metadata.title||'',duration},{persist:false});
   if(!['audio','video'].includes(asset.type))throw Error('解析媒体扩展名不受支持');
   const source={url,originalShareText:value,title:String(metadata.title||'').slice(0,2000),extractor:metadata.extractor||'',version:metadata.version,assetId:asset.id,sha256:sha(asset.path),bytes:asset.size,duration,hasAudio};
   ctx.onReferenceAsset?.(asset.id,source.sha256);
   ctx.progress?.(25,hasAudio?'正在识别链接音轨，下载标题不会作为正文':'无音轨视频已采集，交由画面分析，不生成原片台词');
   const result=hasAudio?await this.providers.transcribe(asset.id,ctx):silentResult();ctx.signal?.throwIfAborted();
   if(hasAudio&&(typeof result?.text!=='string'||!result.text.trim()))throw Error('链接音轨未识别到有效文案');
   if(sha(asset.path)!==source.sha256)throw Error('下载媒体在识别期间发生变化，未接收结果');
   this.store.save();return {...result,sourceAssetId:asset.id,linkSource:source};
  }catch(error){if(asset){this.store.data.assets=this.store.data.assets.filter(item=>item.id!==asset.id);fs.rmSync(asset.path,{force:true});try{this.store.save();}catch(saveError){error.cleanupError=saveError.message;}}throw error;}
  finally{fs.rmSync(directory,{recursive:true,force:true});}
 }
 async extractDownloaded(file,value,ctx={},metadata={}){
  const url=shareLink(value),directory=path.dirname(path.resolve(file));let asset;
  try{
   if(!fs.existsSync(file)||!fs.statSync(file).isFile()||fs.statSync(file).size<=0||fs.statSync(file).size>maxBytes)throw Error('浏览器返回的媒体文件为空或超过200MB');
   const info=await this.media.probe(file),duration=Number(info.format.duration);
   const hasAudio=sourceAudio(info,metadata);
   validateReferenceDuration(duration,'链接媒体');
   ctx.signal?.throwIfAborted();
   asset=this.store.addAsset(file,{type:info.streams.some(stream=>stream.codec_type==='video')?'video':'audio',origin:'browser-link-extract',sourceUrl:url,sourceTitle:String(metadata.title||''),duration},{persist:false});
   const source={url,originalShareText:value,title:String(metadata.title||'').slice(0,2000),extractor:'douyin-browser-session',version:'browser-session',assetId:asset.id,sha256:sha(asset.path),bytes:asset.size,duration,hasAudio};
   ctx.onReferenceAsset?.(asset.id,source.sha256);
   ctx.progress?.(25,hasAudio?'正在识别浏览器会话媒体音轨，页面标题不会作为正文':'无音轨视频已采集，交由画面分析，不生成原片台词');
   const result=hasAudio?await this.providers.transcribe(asset.id,ctx):silentResult();ctx.signal?.throwIfAborted();
   if(hasAudio&&(typeof result?.text!=='string'||!result.text.trim()))throw Error('链接音轨未识别到有效文案');
   if(sha(asset.path)!==source.sha256)throw Error('下载媒体在识别期间发生变化，未接收结果');
   this.store.save();return {...result,sourceAssetId:asset.id,linkSource:source};
  }catch(error){if(asset){this.store.data.assets=this.store.data.assets.filter(item=>item.id!==asset.id);fs.rmSync(asset.path,{force:true});try{this.store.save();}catch(saveError){error.cleanupError=saveError.message;}}throw error;}
  finally{fs.rmSync(file,{force:true});}
 }
}
module.exports={LocalLinkExtractor,shareLink,extractionMode,runWorker};
