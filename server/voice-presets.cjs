const fs=require('node:fs'),crypto=require('node:crypto');
const catalog=require('./voice-presets.json');
const {hashFile}=require('./local-indextts.cjs');
const sampleText='你好，今天我们一起看看这款产品。先看它的外观，再把几个需要留意的细节，慢慢说清楚。';
function presetJob(preset){return {text:sampleText,instruct:preset.instruct,language:'Chinese',seed:20261125+catalog.findIndex(p=>p.id===preset.id),max_new_tokens:1024};}
const definitionHash=preset=>crypto.createHash('sha256').update(JSON.stringify(presetJob(preset))).digest('hex');

// 预设定义属于系统，生成样本属于本地工作区；不复用其他用户的私人参考声音。
class VoicePresets{
 constructor(service){this.service=service;this.pending=new Set();}
 installed(preset){
  const {store}=this.service;
  const voice=store.data.voices.find(v=>v.provenance?.kind==='builtin-voice-preset'&&v.provenance.presetId===preset.id&&v.provenance.definitionSha256===definitionHash(preset));
  if(!voice)return null;
  const asset=store.data.assets.find(a=>a.id===voice.sampleId);
  try{if(asset?.type==='audio'&&fs.existsSync(asset.path)&&hashFile(asset.path)===voice.provenance.outputSha256)return voice;}catch{}
  return null;
 }
 list(){return catalog.map(p=>{const voice=this.installed(p);return {id:p.id,name:p.name,gender:p.gender,scene:p.scene,description:p.description,voiceId:voice?.id||'',sampleId:voice?.sampleId||'',ready:!!voice};});}
 async prepare({id,presetId}){
  const {store,voiceDesign}=this.service;store.draft(id);
  const preset=catalog.find(p=>p.id===presetId);if(!preset)throw Error('声音预设不存在，请重新选择');
  const existing=this.installed(preset);if(existing)return existing;
  if(this.pending.has(presetId))throw Error('此声音预设正在生成，请等待或停止当前任务');
  this.pending.add(presetId);
  try{
   const result=await voiceDesign.generate({id,job:presetJob(preset)});
   const asset=store.asset(result.assetId),record=store.data.runs.find(r=>r.type==='voice-design'&&r.status==='succeeded'&&r.draftId===id&&r.output?.assetId===asset.id);
   if(!record||asset.origin!=='qwen-voice-design'||asset.voiceDesign?.referenceAudio!==null||JSON.stringify(asset.voiceDesign.job)!==JSON.stringify(presetJob(preset))||hashFile(asset.path)!==asset.voiceDesign.outputSha256)throw Error('声音预设未返回一致的本地生成记录');
   const prior=store.data.voices.find(v=>v.provenance?.kind==='builtin-voice-preset'&&v.provenance.presetId===presetId),index=prior?store.data.voices.indexOf(prior):-1;
   const voice={id:prior?.id||crypto.randomUUID(),name:prior?.name||preset.name,sampleId:asset.id,status:'sample-only',createdAt:prior?.createdAt||new Date().toISOString(),
    provenance:{kind:'builtin-voice-preset',presetId,definitionSha256:definitionHash(preset),runId:record.id,model:asset.voiceDesign.model,referenceAudio:null,outputSha256:asset.voiceDesign.outputSha256,savedByUser:false,qualityAccepted:false}};
   if(index>=0)store.data.voices[index]=voice;else store.data.voices.push(voice);
   try{store.save();}catch(error){if(index>=0)store.data.voices[index]=prior;else store.data.voices=store.data.voices.filter(v=>v.id!==voice.id);throw error;}
   return voice;
  }finally{this.pending.delete(presetId);}
 }
}
module.exports={VoicePresets,catalog,presetJob,definitionHash};
