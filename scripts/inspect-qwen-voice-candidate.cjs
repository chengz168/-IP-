// 检查真实新音频的解码、采样及ASR；这些数据不替代真人感和人物匹配试听。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {Media,runProcess}=require('../server/media.cjs'),{LocalAsr}=require('../server/local-asr.cjs'),{digest}=require('../integrations/musetalk-local/input.cjs'),{normalize,simplified}=require('./verify-indextts-output.cjs');
const root=path.resolve('evidence/validation/voice-design-20261115');
async function main(){
 const kind=process.argv[2];assert(['clear','warm','lively','chat','oral'].includes(kind));
 const generated=JSON.parse(fs.readFileSync(path.join(root,'qwen-'+kind+'-generated.json'),'utf8'));assert.equal(digest(generated.file),generated.sha256);
 const data=JSON.parse(fs.readFileSync('evidence/validation/musetalk-integration-20261115/workspace/studio.json','utf8')),store={data,asset:id=>data.assets.find(asset=>asset.id===id)},media=new Media(store),asset=store.asset(generated.run.output.assetId);assert(asset);
 const receipt=JSON.parse(fs.readFileSync(asset.voiceDesign.receiptPath,'utf8'));assert.equal(receipt.referenceAudio,null);assert.equal(receipt.newSpeechGenerated,true);
 await runProcess(media.binaries().ffmpeg,['-v','error','-xerror','-i',generated.file,'-f','null','-']);
 const probe=await media.probe(generated.file),pcm=path.join(root,'qwen-'+kind+'-native.s16le');
 await runProcess(media.binaries().ffmpeg,['-v','error','-n','-i',generated.file,'-map','0:a:0','-c:a','pcm_s16le','-f','s16le',pcm]);
 const bytes=fs.readFileSync(pcm);let peak=0,squares=0,fullScalePoints=0;
 for(let i=0;i<bytes.length;i+=2){const n=bytes.readInt16LE(i);peak=Math.max(peak,Math.abs(n));squares+=n*n;if(n===32767||n===-32768)fullScalePoints++;}
 assert(bytes.length/2===receipt.samples&&peak>0&&fullScalePoints===0);
 const report={at:new Date().toISOString(),kind,file:generated.file,sha256:generated.sha256,runId:generated.run.id,probe,
  signal:{samples:bytes.length/2,peakNormalized:peak/32768,rmsNormalized:Math.sqrt(squares/(bytes.length/2))/32768,fullScalePoints},
  worker:{model:receipt.model,revision:receipt.modelRevision,dtype:receipt.dtype,elapsedSeconds:receipt.elapsedSeconds,audio:receipt.audio},
  fullDecodeVerified:true,newSpeechGenerated:true,referenceAudio:null,expectedText:receipt.job.text,
  naturalnessAccepted:false,characterMatchAccepted:false,qualityAccepted:false};
 try{report.asr=await new LocalAsr(store,media).transcribe(asset.id,{progress:(_number,message)=>console.log(message)});report.recognizedSimplified=simplified(report.asr.text);report.asrTextMatchesInput=normalize(report.recognizedSimplified)===normalize(receipt.job.text);}
 catch(error){report.asrError=error.message;report.asrTextMatchesInput=false;}
 fs.writeFileSync(path.join(root,'qwen-'+kind+'-inspection.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({kind,duration:receipt.duration,signal:report.signal,recognized:report.recognizedSimplified,asrTextMatchesInput:report.asrTextMatchesInput,qualityAccepted:false}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
