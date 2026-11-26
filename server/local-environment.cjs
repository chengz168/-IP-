const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {spawn,execFile}=require('node:child_process');
const {setTimeout:sleep}=require('node:timers/promises');
const defaults={autoStart:true,comfyRoot:'',comfyPython:'',ollamaExecutable:''};
const installedComfy='D:/Comfy-Desktop/ComfyUI-Installs/test-1/ComfyUI';
const filePresent=file=>{try{return fs.statSync(file).isFile()&&fs.statSync(file).size>0;}catch{return false;}};
function validateEnvironmentSettings(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!Object.hasOwn(defaults,key)))throw Error('本地环境设置格式无效');
 const result={...defaults,...value};if(typeof result.autoStart!=='boolean')throw Error('自动启动选项必须为开关');
 for(const key of ['comfyRoot','comfyPython','ollamaExecutable']){if(typeof result[key]!=='string'||result[key].length>2000||result[key].includes('\0'))throw Error('本地环境路径格式无效');result[key]=result[key].trim();if(result[key]&&!path.isAbsolute(result[key]))throw Error('本地环境路径必须为完整路径');}
 return result;
}
function endpoint(kind,value){
 const url=new URL(value);if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw Error('本地服务地址格式无效');
 if(kind==='ollama')url.pathname=url.pathname.replace(/\/(?:v1|api)\/?$/,'');
 const baseUrl=url.toString().replace(/\/$/,'');return {id:kind+':'+baseUrl,kind,name:kind==='comfy'?'ComfyUI 图片 / 视频服务':'Ollama 文本 / 视觉服务',baseUrl,local:url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname),url};
}
function failure(message){return Object.assign(Error(message),{stopBatch:true,environmentFailure:true});}
function alive(pid){if(!Number.isSafeInteger(pid)||pid<=0)return false;try{process.kill(pid,0);return true;}catch(error){return error.code!=='ESRCH';}}
const ownIdentity={pid:process.pid,executable:process.execPath,createdAt:new Date(Date.now()-process.uptime()*1000).toISOString()};
let actualOwnIdentity;
function sameIdentity(a,b){return !!a&&!!b&&a.pid===b.pid&&typeof a.createdAt==='string'&&a.createdAt===b.createdAt&&typeof a.executable==='string'&&typeof b.executable==='string'&&path.resolve(a.executable).toLowerCase()===path.resolve(b.executable).toLowerCase();}
async function inspectProcess(pid){
 if(!alive(pid))return null;
 if(process.platform==='win32')return new Promise((resolve,reject)=>{
  // 只读取进程身份；不按 PID 终止服务，避免误伤被系统复用的进程。
  const script=`$p=Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}' -ErrorAction Stop; if($null -ne $p){@{pid=[int]$p.ProcessId;executable=$p.ExecutablePath;createdAt=$p.CreationDate.ToUniversalTime().ToString('o')}|ConvertTo-Json -Compress}`;
  execFile('powershell.exe',['-NoProfile','-NonInteractive','-WindowStyle','Hidden','-Command',script],{windowsHide:true,timeout:10000,maxBuffer:16384},(error,stdout)=>{if(error)return reject(Error('无法读取本地进程身份：'+error.message));try{const value=stdout.trim()?JSON.parse(stdout.replace(/^\uFEFF/,'')):null;if(value&&(!value.executable||!value.createdAt))throw Error('系统未提供可执行文件或创建时间');resolve(value);}catch(cause){reject(Error('无法核对本地进程身份：'+cause.message));}});
 });
 if(process.platform==='linux'){const stat=fs.readFileSync('/proc/'+pid+'/stat','utf8'),fields=stat.slice(stat.lastIndexOf(')')+2).split(' ');return {pid,executable:fs.readlinkSync('/proc/'+pid+'/exe'),createdAt:fields[19]};}
 throw Error('当前系统尚不支持核对进程身份');
}
function lockSnapshot(file){try{const stat=fs.statSync(file),text=fs.readFileSync(file,'utf8');return {text,identity:[stat.dev,stat.ino,stat.birthtimeMs,stat.mtimeMs,stat.size].join(':'),mtimeMs:stat.mtimeMs};}catch(error){if(error.code==='ENOENT')return null;throw error;}}
function sameSnapshot(a,b){return !!a&&!!b&&a.identity===b.identity&&a.text===b.text;}
function saveProcessRecord(file,value){
 const candidate=file+'.'+crypto.randomUUID()+'.tmp';
 // 在同目录完整落盘后替换，异常中断不会把已有进程记录截断。
 try{fs.writeFileSync(candidate,JSON.stringify(value,null,2),{flag:'wx'});fs.renameSync(candidate,file);}finally{fs.rmSync(candidate,{force:true});}
}
class LocalEnvironment{
 constructor(store,options={}){
  this.store=store;this.options=options;this.enabled=options.enabled!==false;this.fetch=options.fetch||fetch;this.spawn=options.spawn||spawn;this.sleep=options.sleep||sleep;
  // 隔离子进程替身可使用本进程身份；真实 Windows 身份必须来自系统创建时间，不能用启动时间估算值。
  this.inspectProcess=options.inspectProcess||(options.spawn?async pid=>pid===process.pid?{...ownIdentity}:inspectProcess(pid):inspectProcess);
  this.home=options.home||path.join((options.env||process.env).LOCALAPPDATA||os.homedir(),'SuperIP','local-services');this.entries=new Map();this.pending=new Map();this.controller=new AbortController();this.checking=false;this.updatedAt='';
 }
 settings(){return validateEnvironmentSettings(this.store.data.settings.localEnvironment||{});}
 descriptors(){
  const p=this.store.data.settings.provider||{},items=[];
  const add=(kind,url)=>{const item=endpoint(kind,url);if(!items.some(row=>row.id===item.id))items.push(item);};
  if(p.storyImageProtocol==='comfy'||!p.storyImageProtocol&&p.storyImageBaseUrl)add('comfy',p.storyImageBaseUrl||'http://127.0.0.1:8188');
  if(['comfy-h3','comfy-wan22'].includes(p.storyVideoProtocol)||!p.storyVideoProtocol&&p.storyVideoBaseUrl)add('comfy',p.storyVideoBaseUrl||'http://127.0.0.1:8188');
  if(p.avatarProtocol==='comfy-h3')add('comfy',p.avatarUrl||'http://127.0.0.1:8188');
  if(p.textProtocol==='ollama')add('ollama',p.baseUrl||'http://127.0.0.1:11434');
  if(p.visionProtocol==='ollama')add('ollama',p.visionBaseUrl||p.baseUrl||'http://127.0.0.1:11434');return items;
 }
 update(item,status,message,extra={}){this.updatedAt=new Date().toISOString();const old=this.entries.get(item.id)||{};this.entries.set(item.id,{...old,id:item.id,name:item.name,baseUrl:item.baseUrl,status,message,inferenceVerified:false,...extra});}
 workers(){
  const p=this.store.data.settings.provider||{},items=[];
  const inspect=(id,name,work)=>{try{work();items.push({id,name,status:'on-demand',message:'文件预检通过，生成任务执行时按需加载；尚未验证本次推理',inferenceVerified:false});}catch(error){items.push({id,name,status:'failed',message:error.message,inferenceVerified:false});}};
  if(p.ttsProtocol==='indextts-local')inspect('indextts','本地 IndexTTS 配音',()=>{const r=require('./local-indextts.cjs').inspectEnvironment(p);if(!r.readyForProbe)throw Error([...r.issues,...r.missingModels].join('；'));});
  if(p.avatarProtocol==='musetalk-local')inspect('musetalk','本地 MuseTalk 口型',()=>require('./local-musetalk.cjs').runtimeOptions(p));
  if(p.asrProtocol==='local-whisper')inspect('asr','本地语音识别',()=>{if(!filePresent(p.asrPythonPath)||!p.asrModelPath||!fs.existsSync(p.asrModelPath))throw Error('本地语音识别解释器或模型路径缺失，请检查模型设置');});
  if(p.voiceDesignHome)inspect('voice-design','本地音色设计',()=>require('./voice-design.cjs').runtimeOptions(p));return items;
 }
 state(){
  const services=[...this.entries.values(),...this.workers()],checking=this.checking||this.pending.size>0;
  return structuredClone({status:checking?(services.some(row=>row.status==='starting')?'starting':'checking'):services.some(row=>row.status==='failed')?'degraded':services.length?'ready':'idle',checking,services,updatedAt:this.updatedAt,enabled:this.enabled});
 }
 async probe(item){
  const timeout=AbortSignal.timeout(this.options.probeTimeoutMs||2000),signal=AbortSignal.any([timeout,this.controller.signal]);
  try{const response=await this.fetch(item.baseUrl+(item.kind==='comfy'?'/system_stats':'/api/tags'),{signal});if(!response.ok)return {ready:false,occupied:true,message:'服务返回 HTTP '+response.status};const data=await response.json();
   const valid=item.kind==='comfy'?data?.system&&Array.isArray(data.devices):Array.isArray(data?.models);return valid?{ready:true}:{ready:false,occupied:true,message:'地址返回的内容不是'+item.name};
  }catch(error){if(this.controller.signal.aborted)throw error;return {ready:false,occupied:timeout.aborted||error.name==='TimeoutError'||error.name==='SyntaxError',message:error.message};}
 }
 launchSpec(item,settings){
  const env={...(this.options.env||process.env),PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8'},platform=this.options.platform||process.platform;
  // 部分桌面启动环境未传用户名，Windows Python 的 getpass 依赖该变量。
  if(platform==='win32'&&!env.USERNAME)env.USERNAME=os.userInfo().username;
  if(!item.local)throw failure('远端服务不由本机启动，请检查服务端状态：'+item.baseUrl);
  if(item.url.pathname!=='/'&&item.url.pathname!=='')throw failure('自动启动需要本机服务根地址，请检查模型设置：'+item.baseUrl);
  if(item.kind==='comfy'){
   const root=settings.comfyRoot||installedComfy,python=settings.comfyPython||path.join(root,'.venv',platform==='win32'?'Scripts/python.exe':'bin/python');
   if(!settings.comfyRoot&&Number(item.url.port||80)!==8188)throw failure('非默认ComfyUI端口需要在本地环境设置指定已有安装目录');
   if(!filePresent(path.join(root,'main.py'))||!filePresent(python))throw failure('未找到可用的 ComfyUI 安装目录或 Python，请在设置 → 模型设置 → 本地环境填写已有路径');
   const data=path.join(this.home,'comfy-data');for(const name of ['input','output','user'])fs.mkdirSync(path.join(data,name),{recursive:true});
   return {file:python,args:['-u','main.py','--listen',item.url.hostname==='[::1]'?'::1':item.url.hostname,'--port',item.url.port||'80','--disable-auto-launch','--disable-assets','--reserve-vram','2','--input-directory',path.join(data,'input'),'--output-directory',path.join(data,'output'),'--user-directory',path.join(data,'user')],cwd:root,env};
  }
  const executable=settings.ollamaExecutable||path.join(env.LOCALAPPDATA||os.homedir(),'Programs','Ollama',platform==='win32'?'ollama.exe':'ollama');
  if(!filePresent(executable))throw failure('未找到 Ollama 程序，请在本地环境设置指定已安装的程序完整路径');
  return {file:executable,args:['serve'],cwd:path.dirname(executable),env:{...env,OLLAMA_HOST:item.baseUrl}};
 }
 async launch(item,settings){
  fs.mkdirSync(this.home,{recursive:true});const token=crypto.createHash('sha256').update(item.id).digest('hex').slice(0,24),directory=path.join(this.home,token);fs.mkdirSync(directory,{recursive:true});
  const lock=path.join(directory,'startup.lock'),record=path.join(directory,'process.json'),logPath=path.join(directory,'service.log'),deadline=Date.now()+(this.options.startupTimeoutMs||(item.kind==='comfy'?150000:45000)),ownerToken=crypto.randomUUID();let owner=false,launchError,ownedSnapshot;
  this.update(item,'starting','正在启动并等待服务健康检查…',{logPath});
  try{
   while(Date.now()<deadline){
    this.controller.signal.throwIfAborted();const health=await this.probe(item);if(health.ready){this.update(item,'ready','服务已就绪；模型将在生成时加载',{logPath});return;}
    if(!owner){
     const candidate=lock+'.'+ownerToken+'.tmp',ownerIdentity=this.options.spawn?ownIdentity:await (actualOwnIdentity??=inspectProcess(process.pid).catch(error=>{actualOwnIdentity=null;throw error;}));
     if(!ownerIdentity)throw failure('无法读取工作台进程身份，未发布启动锁，请重试');
     try{
      // 完整写入后原子发布，竞争者不会看到本实例尚未写完的空锁。
      try{fs.writeFileSync(candidate,JSON.stringify({pid:process.pid,token:ownerToken,identity:ownerIdentity}),{flag:'wx'});fs.linkSync(candidate,lock);owner=true;ownedSnapshot=lockSnapshot(lock);}finally{fs.rmSync(candidate,{force:true});}
     }
     catch(error){
      if(error.code!=='EEXIST')throw error;const before=lockSnapshot(lock);if(!before)continue;let other;try{other=JSON.parse(before.text);}catch{}
      let stale=false;
      if(other?.pid){const identity=await this.inspectProcess(other.pid);if(!identity)stale=true;else if(other.identity)stale=!sameIdentity(other.identity,identity);else throw failure('旧启动锁缺少可验证的进程身份；请等待原窗口启动完成或正常关闭原窗口后重试：'+lock);}
      else if(Date.now()-before.mtimeMs>=(this.options.lockStaleMs??5000)){
       // 旧版本可能留下截断锁。先静置、再核对文件身份，不能删除正在写入或已替换的新锁。
       await this.sleep(this.options.lockRecoveryCheckMs??100,undefined,{signal:this.controller.signal});stale=sameSnapshot(before,lockSnapshot(lock));
      }
      if(stale&&sameSnapshot(before,lockSnapshot(lock))){fs.unlinkSync(lock);continue;}
      await this.sleep(250,undefined,{signal:this.controller.signal});continue;
     }
     // 持锁后再检查健康和上次子进程，多个工作区共用同一个端口与启动记录。
     const lockedHealth=await this.probe(item);if(lockedHealth.ready){this.update(item,'ready','已复用其他窗口启动的服务',{logPath});return;}
     if(lockedHealth.occupied)throw failure('拿到启动锁后地址已有其他响应，未重复启动：'+item.baseUrl+'（'+lockedHealth.message+'）');
     let previous;try{previous=JSON.parse(fs.readFileSync(record,'utf8'));if(!previous||!Number.isSafeInteger(previous.pid)||previous.pid<=0)throw Error('缺少有效 PID');}catch(error){if(error.code!=='ENOENT')throw failure('此前启动记录损坏，无法确认原服务是否仍在加载，未重复启动；请确认原服务已正常停止后归档该记录并重试：'+record);}
     const previousIdentity=previous?.pid?await this.inspectProcess(previous.pid):null;
     if(previousIdentity&&!previous.identity)throw failure('此前启动记录缺少可验证的进程身份，未重复启动；请等待服务就绪，或正常关闭原服务后重试：'+record);
     if(previousIdentity&&sameIdentity(previous.identity,previousIdentity)){this.update(item,'starting','正在等待此前启动的服务就绪…',{logPath,pid:previous.pid,managed:true});}
     else{
      if(health.occupied)throw failure('地址已响应但尚不是可用的'+item.name+'，未重复启动：'+item.baseUrl+'（'+health.message+'）');
      const spec=this.launchSpec(item,settings),fd=fs.openSync(logPath,'a');let child;
       try{
        // Windows 下不让 ComfyUI 脱离工作台创建独立控制台；输出仍写入日志，避免 Python 子进程弹出黑色窗口。
        child=this.spawn(spec.file,spec.args,{cwd:spec.cwd,env:spec.env,windowsHide:true,detached:false,stdio:['ignore',fd,fd]});
        child.on('error',error=>{launchError=error;});child.on('exit',(code,signal)=>{launchError=Error('本地服务进程退出（'+(signal||code)+'）');});child.unref();
       }
      finally{fs.closeSync(fd);}
      if(Number.isSafeInteger(child.pid)){
       const next={pid:child.pid,executable:spec.file,baseUrl:item.baseUrl,startedAt:new Date().toISOString(),identity:null};saveProcessRecord(record,next);
       const identity=await this.inspectProcess(child.pid);if(launchError)throw failure('本地服务启动失败：'+launchError.message+'；日志：'+logPath);
       if(!identity)throw failure('本地服务启动后进程已退出；请检查日志：'+logPath);
       if(!this.options.spawn&&path.resolve(identity.executable).toLowerCase()!==path.resolve(spec.file).toLowerCase())throw failure('本地服务进程身份与启动程序不一致，未重复启动；请检查日志：'+logPath);
       next.identity=identity;saveProcessRecord(record,next);
      }
      this.update(item,'starting','已启动进程，正在等待服务可用…',{logPath,pid:child.pid,managed:true});
     }
    }
    if(launchError)throw failure('本地服务启动失败：'+launchError.message+'；日志：'+logPath);
    await this.sleep(500,undefined,{signal:this.controller.signal});
   }
   throw failure('本地服务启动等待超时，未重复启动进程；请检查日志后重试：'+logPath);
  }finally{if(owner)try{const current=lockSnapshot(lock);if(sameSnapshot(ownedSnapshot,current)&&JSON.parse(current.text).token===ownerToken)fs.unlinkSync(lock);}catch{}}
 }
 async ensure(item,ctx={}){
  ctx.signal?.throwIfAborted();if(!this.enabled)return;
  if(!this.pending.has(item.id)){
   const promise=(async()=>{this.update(item,'checking','正在检查服务连接…');try{const health=await this.probe(item);if(health.ready){this.update(item,'ready','服务已运行，直接复用');return;}
    const settings=this.settings();if(!settings.autoStart)throw failure('本地服务未就绪，自动启动已关闭：'+item.baseUrl);
    if(!item.local)throw failure('远端服务无法连接，请检查服务端：'+item.baseUrl);
    if(health.occupied)throw failure('服务地址已被其他响应占用或响应超时，未启动第二个进程：'+item.baseUrl+'（'+health.message+'）');
    await this.launch(item,settings);
   }catch(error){this.update(item,'failed',error.message);throw Object.assign(error,{stopBatch:true,environmentFailure:true});}})();
   this.pending.set(item.id,promise);promise.finally(()=>{if(this.pending.get(item.id)===promise)this.pending.delete(item.id);}).catch(()=>{});
  }
  const promise=this.pending.get(item.id);if(!ctx.signal)return promise;
  // 取消当前任务只停止它的等待，不影响其他窗口共用的服务启动。
  return new Promise((resolve,reject)=>{const abort=()=>reject(ctx.signal.reason||Error('已停止等待本地服务'));ctx.signal.addEventListener('abort',abort,{once:true});promise.then(resolve,reject).finally(()=>ctx.signal.removeEventListener('abort',abort)).catch(()=>{});if(ctx.signal.aborted)abort();});
 }
 ensureComfy(base,ctx={}){return this.ensure(endpoint('comfy',base),ctx);}
 ensureOllama(base,ctx={}){return this.ensure(endpoint('ollama',base),ctx);}
 ollamaFor(url){let target;try{target=new URL(url);}catch{return null;}return this.descriptors().find(item=>item.kind==='ollama'&&item.url.origin===target.origin&&target.pathname.startsWith(item.url.pathname.replace(/\/$/,'')));
 }
 async start(){if(this.starting)return this.starting;this.checking=true;const work=(async()=>{try{const items=this.descriptors(),ids=new Set(items.map(item=>item.id));for(const id of this.entries.keys())if(!ids.has(id)&&!this.pending.has(id))this.entries.delete(id);await Promise.allSettled(items.map(item=>this.ensure(item)));}catch(error){this.entries.set('configuration',{id:'configuration',name:'本地环境配置',status:'failed',message:error.message,inferenceVerified:false});}finally{this.checking=false;this.updatedAt=new Date().toISOString();}return this.state();})();this.starting=work;try{return await work;}finally{this.starting=null;}}
 close(){this.controller.abort(Error('工作台已关闭，停止等待环境启动'));}
}
module.exports={LocalEnvironment,validateEnvironmentSettings,endpoint};
