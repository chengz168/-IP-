const fs=require('node:fs');
const {capabilityBaseUrl}=require('./provider-endpoints.mjs');
function asrConfig(provider){return provider.asrProtocol==='local-whisper'?{protocol:'local-whisper',python:provider.asrPythonPath||'',model:provider.asrModelPath||'',language:provider.asrLanguage||'zh'}:{protocol:provider.asrProtocol||'compatible',baseUrl:capabilityBaseUrl(provider,'asr'),model:provider.asrModel||''};}
function sourceStamp(store,id){const asset=store.asset(id),stat=fs.statSync(asset.path);if(!stat.isFile())throw Error('识别源不是有效媒体文件');return {assetId:id,path:asset.path,size:stat.size,mtimeMs:stat.mtimeMs,type:asset.type};}
function asrInput(store,id){return {source:sourceStamp(store,id),config:asrConfig(store.data.settings.provider)};}
function asrCurrent(store,input){try{return JSON.stringify(asrInput(store,input.source.assetId))===JSON.stringify(input);}catch{return false;}}
module.exports={asrInput,asrCurrent,asrConfig,sourceStamp};
