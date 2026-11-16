const crypto=require('node:crypto');
const fs=require('node:fs');
const {capabilityBaseUrl}=require('./provider-endpoints.mjs');

// 只记录参与本次配音的输入，不将密钥或无关文字模型配置写入素材。
function speechContext(data){
 return {provider:structuredClone(data.settings.provider),voices:structuredClone(data.voices||[]),assets:data.settings.provider.ttsProtocol==='indextts-local'?structuredClone(data.assets||[]):[]};
}
function speechRequest(draft,context){
 const p=context.provider,v=draft.voice||{},windows=p.ttsProtocol==='windows',profile=context.voices.find(item=>item.id===v.profile);
 if(p.ttsProtocol==='indextts-local'){
  const reference=context.assets?.find(asset=>asset.id===profile?.sampleId),prosodyReference=context.assets?.find(asset=>asset.id===v.prosodyReferenceId);let referenceSha256='',prosodyReferenceSha256='';
  if(v.prosodyReferenceId&&(!prosodyReference||prosodyReference.type!=='audio'))throw Error('参考韵律音频不存在或不是音频素材，请重新选择');
  try{if(reference?.type==='audio')referenceSha256=crypto.createHash('sha256').update(fs.readFileSync(reference.path)).digest('hex');}catch{}
  try{if(prosodyReference?.type==='audio')prosodyReferenceSha256=crypto.createHash('sha256').update(fs.readFileSync(prosodyReference.path)).digest('hex');}catch{}
  return {version:'speech-request-v4',protocol:'indextts-local',model:'IndexTTS-2.5',audioPolicy:'vocoder-before-limit-peak-0.95-v2',home:p.indexttsHome||'',text:String(draft.finalText||''),
   speed:Number(v.speed),emotion:['normal','正常'].includes(v.emotion)?'':v.emotion||'',strength:Number(v.strength??.5),seed:42,
   language:({'中文':'ZH','英语':'EN','日语':'JA','西班牙语':'ES','阿拉伯语':'AR'})[draft.language||'中文']||'',
   profileId:v.profile||'',referenceId:reference?.id||'',referenceSha256,prosodyReferenceId:prosodyReference?.id||'',prosodyReferenceSha256};
 }
 return {version:'speech-request-v1',text:String(draft.finalText||''),protocol:p.ttsProtocol||'compatible',speed:Number(v.speed),emotion:v.emotion||'',profileId:v.profile||'',model:windows?'':v.model==='classic'?(p.ttsClassicModel||p.ttsModel||'').trim():(p.ttsFastModel||p.ttsModel||'').trim(),voice:windows?(v.systemVoice||p.systemVoice||''):(profile?.remoteId||p.voice||''),baseUrl:windows?'':capabilityBaseUrl(p,'tts')};
}
function speechCurrent(request,draft,data){return JSON.stringify(request)===JSON.stringify(speechRequest(draft,speechContext(data)));}
function speechEvidence(request){const {text,...rest}=request;return {...rest,textLength:text.length,textSha256:crypto.createHash('sha256').update(text).digest('hex')};}
module.exports={speechContext,speechRequest,speechCurrent,speechEvidence};
