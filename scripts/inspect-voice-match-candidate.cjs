const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {Media,runProcess}=require('../server/media.cjs'),{LocalAsr}=require('../server/local-asr.cjs');
const {digest}=require('../integrations/musetalk-local/input.cjs'),{simplified,normalize}=require('./verify-indextts-output.cjs');
const root=path.resolve('evidence/validation/voice-match-review-20261115'),label=process.argv[2];
async function main(){
 assert(['normal','slower'].includes(label));const read=name=>JSON.parse(fs.readFileSync(path.join(root,name),'utf8')),input=read('candidates.json'),generated=read('generated-'+label+'.json');
 const data=JSON.parse(fs.readFileSync('evidence/validation/musetalk-integration-20261115/workspace/studio.json','utf8'));
 const store={data,asset:id=>data.assets.find(a=>a.id===id)},media=new Media(store),asset=store.asset(generated.run.output.id),file=generated.file;assert.equal(digest(file),generated.sha256);
 await runProcess(media.binaries().ffmpeg,['-v','error','-xerror','-i',file,'-f','null','-']);
 const pcm=path.join(root,'signal-'+label+'.pcm');await runProcess(media.binaries().ffmpeg,['-v','error','-n','-i',file,'-map','0:a:0','-c:a','pcm_s16le','-f','s16le',pcm]);
 const bytes=fs.readFileSync(pcm);let peak=0,clipped=0,squares=0;for(let i=0;i<bytes.length;i+=2){const value=bytes.readInt16LE(i);peak=Math.max(peak,Math.abs(value));squares+=value*value;if(Math.abs(value)>=32767)clipped++;}assert(peak>0);assert.equal(clipped,0);
 const asr=await new LocalAsr(store,media).transcribe(asset.id),recognized=simplified(asr.text);
 const report={at:new Date().toISOString(),label,file,sha256:digest(file),referenceSha256:input.reference.sha256,text:input.text,asr,recognizedSimplified:recognized,asrTextMatchesInput:normalize(recognized)===normalize(input.text),
  signal:{samples:bytes.length/2,peakNormalized:peak/32768,rmsNormalized:Math.sqrt(squares/(bytes.length/2))/32768,fullScaleSamples:clipped},
  fullDecodeVerified:true,voiceSimilarityAccepted:false,listeningAccepted:false,qualityAccepted:false};
 fs.writeFileSync(path.join(root,'inspection-'+label+'.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({label,duration:asset.duration,recognized,asrTextMatchesInput:report.asrTextMatchesInput,fullScaleSamples:clipped,qualityAccepted:false}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
