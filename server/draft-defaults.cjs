const fs=require('node:fs');

// 新任务仅继承唯一且文件仍可用的本地参考音色，不替换已有任务的选择。
function localDefaultVoice(data){
 if(data.settings?.provider?.ttsProtocol!=='indextts-local')return '';
 const profiles=data.voices.filter(voice=>voice.sampleId);
 if(profiles.length!==1)return '';
 const profile=profiles[0],sample=data.assets.find(asset=>asset.id===profile.sampleId&&asset.type==='audio');
 if(!sample?.path)return '';
 try{const stat=fs.statSync(sample.path);return stat.isFile()&&stat.size>0?profile.id:'';}catch{return '';}
}
module.exports={localDefaultVoice};
