// 核对Qwen候选经IndexTTS换稿的真实媒体和正文，不推断听觉质量。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {Media,runProcess}=require('../server/media.cjs'),{LocalAsr}=require('../server/local-asr.cjs');
const {digest}=require('../integrations/musetalk-local/input.cjs'),{simplified,normalize}=require('./verify-indextts-output.cjs');
const root=path.resolve('evidence/validation/voice-design-20261115/lifecycle'),read=name=>JSON.parse(fs.readFileSync(path.join(root,name),'utf8'));
async function main(){
 const target=path.join(root,'speech-inspection.json');assert(!fs.existsSync(target),'已有本轮媒体检查，不覆盖');
 const generated=read('speech-generated.json'),prepared=read('prepared.json');assert.equal(digest(generated.file),generated.sha256);
 const data=JSON.parse(fs.readFileSync('evidence/validation/musetalk-integration-20261115/workspace/studio.json','utf8'));
 const store={data,asset:id=>data.assets.find(a=>a.id===id)},media=new Media(store),asset=store.asset(generated.run.output.id),reference=store.asset(prepared.referenceId);
 assert.equal(digest(reference.path),prepared.referenceSha256);assert.equal(asset.speech.referenceSha256,prepared.referenceSha256);assert.equal(asset.speech.outputSha256,generated.sha256);
 await runProcess(media.binaries().ffmpeg,['-v','error','-xerror','-i',generated.file,'-f','null','-']);
 const probe=await media.probe(generated.file),pcm=path.join(root,'speech-native.s16le');
 await runProcess(media.binaries().ffmpeg,['-v','error','-n','-i',generated.file,'-map','0:a:0','-c:a','pcm_s16le','-f','s16le',pcm]);
 const bytes=fs.readFileSync(pcm);let peak=0,squares=0,fullScalePoints=0;
 for(let i=0;i<bytes.length;i+=2){const n=bytes.readInt16LE(i);peak=Math.max(peak,Math.abs(n));squares+=n*n;if(n===32767||n===-32768)fullScalePoints++;}
 assert(bytes.length>0&&peak>0);assert.equal(fullScalePoints,0);
 const report={at:new Date().toISOString(),runId:generated.run.id,file:generated.file,sha256:generated.sha256,referenceSha256:prepared.referenceSha256,sourceVoiceRunId:prepared.sourceVoiceRunId,
  probe,signal:{samples:bytes.length/2,peakNormalized:peak/32768,rmsNormalized:Math.sqrt(squares/(bytes.length/2))/32768,fullScalePoints},
  expectedText:generated.text,fullDecodeVerified:true,newSpeechGenerated:true,originalHumanVoiceUsed:false,voiceConsistencyAccepted:false,naturalnessAccepted:false,qualityAccepted:false};
 try{report.asr=await new LocalAsr(store,media).transcribe(asset.id,{progress:(_value,message)=>console.log(message)});report.recognizedSimplified=simplified(report.asr.text);report.asrTextMatchesInput=normalize(report.recognizedSimplified)===normalize(generated.text);}
 catch(e){report.asrError=e.message;report.asrTextMatchesInput=false;}
 fs.writeFileSync(target,JSON.stringify(report,null,2),{flag:'wx'});console.log(JSON.stringify({runId:report.runId,duration:Number(probe.format.duration),signal:report.signal,recognized:report.recognizedSimplified,asrTextMatchesInput:report.asrTextMatchesInput,qualityAccepted:false}));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
