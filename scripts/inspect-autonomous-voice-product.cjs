const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {Media,runProcess}=require('../server/media.cjs'),{LocalAsr}=require('../server/local-asr.cjs');
const {digest}=require('../integrations/musetalk-local/input.cjs'),{simplified,normalize}=require('./verify-indextts-output.cjs');
const root=path.resolve('evidence/validation/voice-design-20261115');
async function main(){
 const generated=JSON.parse(fs.readFileSync(path.join(root,'product-generated.json'),'utf8'));
 const candidate=JSON.parse(fs.readFileSync(path.join(root,'product-candidate.json'),'utf8'));
 assert.equal(digest(generated.file),generated.sha256);assert.equal(digest(candidate.reference.file),candidate.reference.sha256);
 const data=JSON.parse(fs.readFileSync('evidence/validation/musetalk-integration-20261115/workspace/studio.json','utf8'));
 const store={data,asset:id=>data.assets.find(a=>a.id===id)},media=new Media(store),asset=store.asset(generated.run.output.id);assert(asset);
 assert.equal(asset.speech.referenceSha256,candidate.reference.sha256);assert.equal(asset.speech.outputSha256,generated.sha256);
 const probe=await media.probe(generated.file),pcm=path.join(root,'product-native.s16le');
 await runProcess(media.binaries().ffmpeg,['-v','error','-xerror','-i',generated.file,'-f','null','-']);
 if(!fs.existsSync(pcm))await runProcess(media.binaries().ffmpeg,['-v','error','-n','-i',generated.file,'-map','0:a:0','-c:a','pcm_s16le','-f','s16le',pcm]);
 const bytes=fs.readFileSync(pcm);let peak=0,squares=0,fullScalePoints=0;
 for(let i=0;i<bytes.length;i+=2){const n=bytes.readInt16LE(i);peak=Math.max(peak,Math.abs(n));squares+=n*n;if(n===32767||n===-32768)fullScalePoints++;}
 assert(peak>0&&bytes.length>0);
 const report={at:new Date().toISOString(),runId:generated.run.id,file:generated.file,sha256:generated.sha256,probe,
  signal:{samples:bytes.length/2,peakNormalized:peak/32768,rmsNormalized:Math.sqrt(squares/(bytes.length/2))/32768,fullScalePoints},
  sourcePromptId:generated.sourcePromptId,referenceSha256:candidate.reference.sha256,referenceAudioWasSelfGenerated:true,originalHumanVoiceUsed:false,
  expectedText:candidate.text,newSpeechGenerated:true,fullDecodeVerified:true,audioMastering:asset.speech.audioMastering,
  voiceConsistencyAccepted:false,listeningAccepted:false,characterMatchAccepted:false,qualityAccepted:false};
 try{report.asr=await new LocalAsr(store,media).transcribe(asset.id,{progress:(_value,message)=>console.log(message)});report.recognizedSimplified=simplified(report.asr.text);report.asrTextMatchesInput=normalize(report.recognizedSimplified)===normalize(candidate.text);}
 catch(error){report.asrError=error.message;report.asrTextMatchesInput=false;}
 fs.writeFileSync(path.join(root,'product-inspection.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({runId:report.runId,duration:Number(probe.format.duration),signal:report.signal,recognized:report.recognizedSimplified,asrTextMatchesInput:report.asrTextMatchesInput,qualityAccepted:false}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
