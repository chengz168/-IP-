// 来源切换只修改设置草稿；每个协议保留自己的未保存字段，不写日常配置。
export const modelGroups={
 text:{protocol:'textProtocol',model:'model',fields:['model','baseUrl','textMaxTokens','textContextTokens']},
 vision:{protocol:'visionProtocol',model:'visionModel',fields:['visionModel','visionBaseUrl']},
 tts:{protocol:'ttsProtocol',model:'ttsModel',fields:['ttsModel','ttsBaseUrl','voice','indexttsHome','systemVoice','ttsClassicModel','ttsFastModel']},
 asr:{protocol:'asrProtocol',model:'asrModel',fields:['asrModel','asrBaseUrl','asrModelPath','asrPythonPath','asrLanguage']}
};
export function createProtocolDrafts(){
 const memory=new Map();
 return {
  switch(provider,group,next){
   const spec=modelGroups[group];if(!spec)throw Error('未知模型能力');
   const prior=provider[spec.protocol]||'compatible';if(prior===next)return;
   memory.set(group+':'+prior,Object.fromEntries(spec.fields.map(field=>[field,provider[field]])));
   const saved=memory.get(group+':'+next);
   // 首次切换保留现有值，避免自动填入不存在的模型或覆盖已保存地址。
   if(saved)for(const field of spec.fields){if(saved[field]===undefined)delete provider[field];else provider[field]=saved[field];}
   provider[spec.protocol]=next;
  },
  clear(){memory.clear();}
 };
}

// 超时或输入变更后立即结束本次界面等待；旧网络回包不会再写入当前列表。
export function createDiscoveryController(request,{timeoutMs=20000,cancel=()=>{}}={}){
 let version=0,pendingCancel;
 const invalidate=()=>{version++;pendingCancel?.();pendingCancel=undefined;};
 return {
  invalidate,
  async run(payload){
   invalidate();const mine=version;let timer;
   const stop=()=>{try{Promise.resolve(cancel(payload)).catch(()=>{});}catch{}};
   const cancelled=new Promise(resolve=>{pendingCancel=()=>{stop();resolve({phase:'stale'});};});
   const timeout=new Promise(resolve=>{timer=setTimeout(()=>resolve({phase:'timeout',message:'读取模型列表超时，请检查服务后重试。当前配置已保留。'}),timeoutMs);});
   const job=Promise.resolve().then(()=>request(payload)).then(result=>({phase:'result',result}),error=>({phase:'error',message:error?.message||'读取模型列表失败'}));
   const result=await Promise.race([job,timeout,cancelled]);clearTimeout(timer);
   if(mine!==version)return {phase:'stale'};
   pendingCancel=undefined;
   if(result.phase==='timeout')stop();
   return result;
  }
 };
}

const capabilityNames={text:'文本',vision:'视觉',tts:'语音合成',asr:'语音识别'};
export function discoveryModels(result,capability){
 if(!Array.isArray(result.models))throw Error('模型发现返回结构无效，请重试。');
 const seen=new Set();
 return result.models.flatMap(model=>{
  if(!model||typeof model.id!=='string'||!model.id.trim())throw Error('模型发现返回了无效模型标识，请重试。');
  if(seen.has(model.id))return [];seen.add(model.id);
  const state=model.capabilities?.[capability],name=capabilityNames[capability];
  const detail=state==='supported'?(model.capabilityEvidence==='integration-contract'?'接口适配声明支持'+name:'服务声明支持'+name):state==='unsupported'?'服务声明不支持'+name:name+'能力未确认';
  const availability=model.availability==='files-present'?'文件齐备，未验证生成':model.availability==='path-only'?'仅发现路径，未验证生成':'仅发现列表，未验证生成';
  return [{id:model.id,label:typeof model.name==='string'?model.name:model.id,detail:detail+'；'+availability,disabled:state==='unsupported'}];
 });
}
