const fs=require('node:fs'),path=require('node:path');
const capabilities=['text','vision','tts','asr'];
const protocols={text:['compatible','ollama'],vision:['compatible','ollama'],tts:['compatible','indextts-local','windows'],asr:['compatible','local-whisper']};
const providerFields=['baseUrl','ttsBaseUrl','asrBaseUrl','visionBaseUrl','textProtocol','visionProtocol','ttsProtocol','asrProtocol','indexttsHome','asrPythonPath','asrModelPath'];
const unknown=()=>Object.fromEntries(capabilities.map(key=>[key,'unknown']));
const failure=(code,message,extra={})=>Object.assign(new Error(message),{code,...extra});
const {capabilityBaseUrl:endpoint}=require('./provider-endpoints.mjs');
const {checkedChanges}=require('./provider-keys.cjs');
function redact(value,secret){if(typeof value==='string')return value.split(secret).join('[已隐藏]');if(Array.isArray(value))return value.map(item=>redact(item,secret));if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,redact(item,secret)]));return value;}
function withSignal(promise,signal){return new Promise((resolve,reject)=>{const abort=()=>reject(signal.reason);signal.addEventListener('abort',abort,{once:true});Promise.resolve(promise).then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));if(signal.aborted)abort();});}
function baseAddress(value){let url;try{url=new URL(value);}catch{throw failure('DISCOVERY_INVALID_INPUT','请填写完整的模型服务地址');}if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw failure('DISCOVERY_INVALID_INPUT','模型地址只支持不含凭据、查询参数和片段的HTTP或HTTPS地址');return url.toString().replace(/\/$/,'');}
function model(id,name,source,values={}){return {id,name:name||id,source,installed:null,availability:'listed',capabilities:unknown(),capabilityEvidence:'unknown',generationVerified:false,...values};}
function fileCheck(file,label,kind='file'){
 try{const stat=fs.statSync(file),present=kind==='directory'?stat.isDirectory():stat.isFile()&&stat.size>0;return {label,path:file,present,...(!present?{reason:kind==='directory'?'不是目录':'不是普通文件或文件为空'}:{})};}
 catch(error){return {label,path:file,present:false,reason:error.code==='ENOENT'?'不存在':'无法读取（'+(error.code||'UNKNOWN')+'）'};}
}

class ModelDiscovery{
 constructor(providers){this.providers=providers;this.controllers=new Map();}
 cancel(requestId){if(typeof requestId!=='string')return {cancelled:false};const active=this.controllers.get(requestId);if(!active)return {cancelled:false};active.abort();return {cancelled:true};}
 async discover(input={}){
  const {requestId,capability}=input,checkedAt=new Date().toISOString();
  const result={requestId:typeof requestId==='string'?requestId:'',capability,source:'',protocol:'',status:'error',models:[],error:null,message:'',checkedAt,generationVerified:false};
  if(typeof requestId!=='string'||!/^[\w-]{1,128}$/.test(requestId)||!capabilities.includes(capability))return {...result,error:{code:'DISCOVERY_INVALID_INPUT',message:'模型发现请求标识或能力无效'}};
  if(this.controllers.has(requestId))return {...result,error:{code:'DISCOVERY_BUSY',message:'该模型发现请求仍在执行'}};
  if(input.timeoutMs!==undefined&&(!Number.isInteger(input.timeoutMs)||input.timeoutMs<1000||input.timeoutMs>15000))return {...result,error:{code:'DISCOVERY_INVALID_INPUT',message:'模型发现超时需为1000至15000毫秒'}};
  if(input.changeKey!==undefined&&typeof input.changeKey!=='boolean'||input.changeKey===true&&typeof input.key!=='string')return {...result,error:{code:'DISCOVERY_INVALID_INPUT',message:'临时密钥参数无效'}};
  try{if(input.capabilityKeys!==undefined){checkedChanges(input.capabilityKeys);if(Object.keys(input.capabilityKeys).some(key=>!capabilities.includes(key)))throw Error();}}catch{return {...result,error:{code:'DISCOVERY_INVALID_INPUT',message:'独立临时密钥参数无效'}};}
  const controller=new AbortController();this.controllers.set(requestId,controller);const timeout=AbortSignal.timeout(input.timeoutMs??12000),signal=AbortSignal.any([controller.signal,timeout]);
  let secret='';
  try{
   if(input.provider!==undefined&&(!input.provider||typeof input.provider!=='object'||Array.isArray(input.provider)))throw failure('DISCOVERY_INVALID_INPUT','模型配置草稿无效');
   // 草稿仅参与本次查询，不赋值给store、不新建运行，也不缓存凭据。
   const provider={};for(const key of providerFields){const value=input.provider?.[key]??this.providers.config()[key];if(value!==undefined&&typeof value!=='string')throw failure('DISCOVERY_INVALID_INPUT','模型配置字段格式无效');provider[key]=value?.trim()||'';}
   const protocol=provider[capability==='text'?'textProtocol':capability==='vision'?'visionProtocol':capability==='tts'?'ttsProtocol':'asrProtocol']||'compatible';
   result.protocol=protocol;result.source=protocol==='compatible'?'compatible':protocol==='ollama'?'ollama':'local';
   if(!protocols[capability].includes(protocol))throw failure('DISCOVERY_INVALID_INPUT','当前能力不支持该模型协议');
   signal.throwIfAborted();
   if(protocol==='ollama'||protocol==='compatible'){
    const base=baseAddress(endpoint(provider,capability)),local=protocol==='ollama';
    // 本地列表完全不读取云密钥；明确清除独立草稿后才沿用全局草稿或已保存值。
    if(!local){
     const own=input.capabilityKeys&&Object.hasOwn(input.capabilityKeys,capability)?input.capabilityKeys[capability].trim():this.providers.secrets.getScoped?await withSignal(this.providers.secrets.getScoped(capability),signal):'';
     secret=own||(input.changeKey===true?input.key:await withSignal(this.providers.secrets.get(),signal));
    }
    signal.throwIfAborted();const headers=secret?{Authorization:'Bearer '+secret}:{};
    const data=await this.json(local?base.replace(/\/v1$/,'')+'/api/tags':base+'/models',{headers},signal);
    const items=local?data?.models:data?.data;if(!Array.isArray(items)||items.length>1000)throw failure('DISCOVERY_INVALID_RESPONSE','模型列表格式无效或超过1000项');
    const seen=new Set();
    for(const item of items){
     const id=local?item?.name||item?.model:item?.id;if(typeof id!=='string'||!id.trim()||id.length>1000)throw failure('DISCOVERY_INVALID_RESPONSE','模型列表包含无效模型ID');
     if(seen.has(id))continue;seen.add(id);
     const entry=model(id,typeof item.name==='string'?item.name:id,result.source,{installed:local?true:null});
     if(!local&&item.capabilities&&typeof item.capabilities==='object'&&!Array.isArray(item.capabilities))for(const key of capabilities){if(typeof item.capabilities[key]==='boolean'){entry.capabilities[key]=item.capabilities[key]?'supported':'unsupported';entry.capabilityEvidence='provider-metadata';}}
     result.models.push(entry);
    }
    if(local){
     const root=base.replace(/\/v1$/,'');let next=0;
     // 详情只读取模型声明，最多四路并发，整体共用同一取消和超时信号。
     await Promise.all(Array.from({length:Math.min(4,result.models.length)},async()=>{while(next<result.models.length){const entry=result.models[next++];try{const detail=await this.json(root+'/api/show',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:entry.id})},signal);if(Array.isArray(detail?.capabilities)&&detail.capabilities.every(value=>typeof value==='string')){entry.capabilityEvidence='ollama-show';for(const [key,label]of [['text','completion'],['vision','vision']])entry.capabilities[key]=detail.capabilities.includes(label)?'supported':'unsupported';}}catch(error){signal.throwIfAborted();entry.capabilityEvidence='unknown';entry.capabilityWarning='模型详情不可读取，能力尚未确认';}}}));
    }
    result.status=result.models.length?'ready':'empty';result.message=result.models.length?'已读取模型列表；未执行生成验证':'服务返回空模型列表，可保留手填模型';
   }else if(protocol==='windows'){
    const rows=await new (require('./windows-speech.cjs').WindowsSpeech)(this.providers.store,this.providers.media).voices({signal});signal.throwIfAborted();if(!Array.isArray(rows)||rows.some(row=>typeof row?.name!=='string'||!row.name.trim()))throw failure('DISCOVERY_INVALID_RESPONSE','系统音色列表无效');
    result.models=rows.map(row=>model(row.name,row.name,'local',{installed:true,capabilities:{...unknown(),tts:'supported'},capabilityEvidence:'integration-contract'}));result.status=result.models.length?'ready':'empty';result.message='已读取本机系统音色，未执行合成';
   }else{
    Object.assign(result,this.localEnvironment(provider,capability,protocol));
   }
   signal.throwIfAborted();
  }catch(error){
   const code=controller.signal.aborted?'DISCOVERY_CANCELLED':timeout.aborted?'DISCOVERY_TIMEOUT':typeof error.code==='string'&&error.code.startsWith('DISCOVERY_')?error.code:'DISCOVERY_CONNECTION_FAILED';
   const message=code==='DISCOVERY_CANCELLED'?'模型发现已取消':code==='DISCOVERY_TIMEOUT'?'模型发现超时，请检查服务后重试':code==='DISCOVERY_CONNECTION_FAILED'?'无法连接模型服务，请检查地址与网络':error.message;
   result.status=code==='DISCOVERY_CANCELLED'?'cancelled':'error';result.models=[];result.error={code,message,...(error.httpStatus?{httpStatus:error.httpStatus}:{})};result.message=message;
  }finally{this.controllers.delete(requestId);}
  // 服务元数据不可信，避免异常服务把收到的凭据作为名称或ID原样回显。
  return secret?redact(result,secret):result;
 }
 async json(url,options,signal){
  const response=await fetch(url,{...options,redirect:'error',signal});
  if(!response.ok)throw failure('DISCOVERY_HTTP_ERROR','模型服务返回HTTP '+response.status,{httpStatus:response.status});
  const reader=response.body?.getReader();let text='';
  if(reader){let bytes=0;const decoder=new TextDecoder();try{for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.length;if(bytes>2*1024*1024)throw failure('DISCOVERY_INVALID_RESPONSE','模型列表响应超过大小限制');text+=decoder.decode(part.value,{stream:true});}text+=decoder.decode();}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}}
  else text=await response.text();
  let result;try{result=JSON.parse(text);}catch{throw failure('DISCOVERY_INVALID_JSON','模型服务没有返回有效JSON');}return result;
 }
 localEnvironment(provider,capability,protocol){
  let home=protocol==='indextts-local'?provider.indexttsHome:provider.asrModelPath;
  if(!home)return {status:'unavailable',models:[],environment:{status:'unconfigured',runtimeStatus:'not-detected',checks:[],issues:['尚未配置本地模型路径']},error:{code:'LOCAL_ENVIRONMENT_INCOMPLETE',message:'尚未配置本地模型路径'},message:'尚未配置本地模型路径'};
  if(!path.isAbsolute(home))throw failure('DISCOVERY_INVALID_INPUT','本地模型路径必须为绝对路径');
  let checks=[fileCheck(home,'模型目录','directory')],issues=[],name,id;
  if(protocol==='indextts-local'){
   const inspection=require('./local-indextts.cjs').inspectEnvironment(provider);name=id='IndexTTS-2.5';
   checks.push(fileCheck(inspection.python,'独立Python'),fileCheck(path.join(home,'setup.json'),'安装记录'));
   issues=[...inspection.issues,...inspection.missingModels.map(item=>'缺少 '+item)];
  }else{
   name=path.basename(home);id=home;const python=provider.asrPythonPath;
   if(!python||!path.isAbsolute(python))issues.push('尚未配置已有Python解释器的绝对路径');else checks.push(fileCheck(python,'Python解释器'));
   for(const file of ['model.bin','config.json','tokenizer.json'])checks.push(fileCheck(path.join(home,file),file));
  }
  issues.push(...checks.filter(check=>!check.present).map(check=>check.label+'：'+check.reason));
  const complete=!issues.length,present=checks[0].present;
  return {status:complete?'ready':'unavailable',models:present?[model(id,name,'local',{installed:complete?true:null,availability:complete?'files-present':'path-only',capabilities:{...unknown(),[capability]:'supported'},capabilityEvidence:'integration-contract'})]:[],environment:{status:complete?'files-present':present?'path-only':'missing',runtimeStatus:'not-detected',checks,issues},error:complete?null:{code:'LOCAL_ENVIRONMENT_INCOMPLETE',message:'本地模型文件或环境尚未齐备'},message:complete?'已配置文件齐备，依赖、设备和生成能力尚未检测':'本地模型文件或环境尚未齐备'};
 }
}
module.exports={ModelDiscovery,endpoint};
