const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {Media,runProcess}=require('../server/media.cjs'),{LocalAsr}=require('../server/local-asr.cjs');
const {digest}=require('../integrations/musetalk-local/input.cjs');
const {simplified,normalize}=require('./verify-indextts-output.cjs');
const root=path.resolve('evidence/validation/voice-design-20261115/h3-autonomous');
async function main(){
 const generated=JSON.parse(fs.readFileSync(path.join(root,'generated.json'),'utf8'));
 assert.equal(digest(generated.audio),generated.audioSha256);assert.equal(generated.referenceAudio,null);assert(generated.newSpeechGenerated);
 const data=JSON.parse(fs.readFileSync('evidence/validation/musetalk-integration-20261115/workspace/studio.json','utf8'));
 const asset={id:'h3-autonomous-actual-generated',type:'audio',path:generated.audio},store={data,asset:id=>{assert.equal(id,asset.id);return asset;}},media=new Media(store);
 const {ffmpeg}=media.binaries(),probe=await media.probe(asset.path),signalFile=path.join(root,'voice-native-mono.f32le');
 await runProcess(ffmpeg,['-v','error','-xerror','-i',asset.path,'-f','null','-']);
 if(!fs.existsSync(signalFile))await runProcess(ffmpeg,['-v','error','-n','-i',asset.path,'-map','0:a:0','-ac','1','-c:a','pcm_f32le','-f','f32le',signalFile]);
 const bytes=fs.readFileSync(signalFile);assert(bytes.length>0&&bytes.length%4===0);
 let peak=0,squares=0,fullScale=0,nonFinite=0;
 for(let i=0;i<bytes.length;i+=4){const sample=bytes.readFloatLE(i);if(!Number.isFinite(sample)){nonFinite++;continue;}peak=Math.max(peak,Math.abs(sample));squares+=sample*sample;if(Math.abs(sample)>=1)fullScale++;}
 const report={at:new Date().toISOString(),promptId:generated.promptId,audio:asset.path,sha256:digest(asset.path),expectedText:generated.expectedText,probe,
  signal:{samples:bytes.length/4,peak,rms:Math.sqrt(squares/(bytes.length/4)),fullScalePoints:fullScale,nonFinitePoints:nonFinite},
  fullDecodeVerified:true,newSpeechGenerated:true,referenceAudio:null,asrTextMatchesInput:false,listeningAccepted:false,characterMatchAccepted:false,qualityAccepted:false};
 assert.equal(nonFinite,0);assert(peak>0);
 try{report.asr=await new LocalAsr(store,media).transcribe(asset.id,{progress:(_value,message)=>console.log(message)});report.recognizedSimplified=simplified(report.asr.text);report.asrTextMatchesInput=normalize(report.recognizedSimplified)===normalize(generated.expectedText);}
 catch(error){report.asrError=error.message;}
 fs.writeFileSync(path.join(root,'audio-inspection.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({audio:asset.path,duration:Number(probe.format.duration),signal:report.signal,recognized:report.recognizedSimplified,asrTextMatchesInput:report.asrTextMatchesInput,asrError:report.asrError,qualityAccepted:false}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
