const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {Media,runProcess}=require('../server/media.cjs'),{LocalAsr}=require('../server/local-asr.cjs');
const {spawnSync}=require('node:child_process');
const directory=path.resolve('evidence/validation/indextts-generation'),label=process.argv[2];
const read=file=>JSON.parse(fs.readFileSync(path.join(directory,file),'utf8')),hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const normalize=text=>String(text).replace(/[\p{P}\p{Z}\s]/gu,'');
function simplified(text){
 const converted=spawnSync('powershell.exe',['-NoProfile','-Command',"$taskUtf8=[System.Text.UTF8Encoding]::new($false);[Console]::InputEncoding=$taskUtf8;[Console]::OutputEncoding=$taskUtf8;Add-Type -AssemblyName Microsoft.VisualBasic;$taskText=[Console]::In.ReadToEnd();[Console]::Write([Microsoft.VisualBasic.Strings]::StrConv($taskText,[Microsoft.VisualBasic.VbStrConv]::SimplifiedChinese,2052))"],{input:text,encoding:'utf8',windowsHide:true});
 if(converted.status!==0)throw Error('Windows简繁转换失败：'+converted.stderr);
 return converted.stdout;
}
function signal(bytes){let peak=0,squares=0,clipped=0;for(let i=0;i<bytes.length;i+=2){const sample=Math.abs(bytes.readInt16LE(i));peak=Math.max(peak,sample);squares+=sample*sample;if(sample>=32767)clipped++;}assert(bytes.length>0&&peak>0);return {decodedSamples:bytes.length/2,peakNormalized:peak/32768,rmsNormalized:Math.sqrt(squares/(bytes.length/2))/32768,fullScaleSamples:clipped};}
async function main(){
 if(!['normal','happy','fast'].includes(label))throw Error('请指定已成功的normal、happy或fast产物');
 const inputs=read('inputs.json'),submission=read('submit-'+label+'.json'),data=read('workspace/studio.json'),run=data.runs.find(item=>item.id===submission.run?.id);
 if(run?.status!=='succeeded'||!run.output?.id)throw Error('原声音任务尚未成功，不能制造输出收据');
 const asset=data.assets.find(item=>item.id===run.output.id),out=path.join(directory,label+'-output');fs.mkdirSync(out,{recursive:true});
 assert.equal(asset.origin,'local-indextts');assert.equal(asset.speech.model,'IndexTTS-2.5');assert.equal(asset.speech.referenceSha256,inputs.reference.sha256);
 assert.equal(asset.speech.outputSha256,hash(asset.path));assert.equal(hash(inputs.reference.path),inputs.reference.sha256);assert.notEqual(hash(asset.path),inputs.reference.sha256);
 assert.equal(run.parameters.input.text,inputs.text);assert.equal(run.parameters.input.speed,label==='fast'?1.2:1);assert.equal(run.parameters.input.emotion,label==='happy'?'happy':'');
 assert.equal(asset.speech.audioMastering.policy,'vocoder-before-limit-peak-0.95-v2');
 const store={data,asset:id=>data.assets.find(item=>item.id===id)},media=new Media(store),probe=await media.probe(asset.path),pcm=path.join(out,'output.pcm');
 await runProcess(media.binaries().ffmpeg,['-v','error','-y','-i',asset.path,'-map','0:a:0','-ac','1','-ar','24000','-c:a','pcm_s16le','-f','s16le',pcm]);
 const bytes=fs.readFileSync(pcm),native=path.join(out,'native.pcm');
 await runProcess(media.binaries().ffmpeg,['-v','error','-y','-i',asset.path,'-map','0:a:0','-c:a','pcm_s16le','-f','s16le',native]);
 const report={at:new Date().toISOString(),label,runId:run.id,path:asset.path,sha256:hash(asset.path),origin:asset.origin,model:asset.speech.model,
  probe,request:run.parameters.input,elapsedSeconds:asset.speech.elapsedSeconds,fullDecodeVerified:true,newTextDiffersFromReference:true,
  signal:signal(bytes),nativeSignal:{sampleRate:Number(probe.streams.find(stream=>stream.codec_type==='audio').sample_rate),...signal(fs.readFileSync(native))},audioMastering:asset.speech.audioMastering,
  protectedFiles:inputs.protectedFiles.map(item=>({...item,unchanged:hash(item.file)===item.sha256})),audioAudited:false,qualityAccepted:false,referenceParityAccepted:false,completeReplica:false};
 try{report.asr=await new LocalAsr(store,media).transcribe(asset.id,{progress:(_value,message)=>console.log(message)});report.asrLiteralTextMatchesInput=normalize(report.asr.text)===normalize(inputs.text);report.asrSimplified=simplified(report.asr.text);report.asrNormalization='Windows Microsoft.VisualBasic.Strings.StrConv SimplifiedChinese LCID2052; strip punctuation and whitespace';report.asrTextMatchesInput=normalize(report.asrSimplified)===normalize(simplified(inputs.text));}catch(error){report.asrError=error.message;}
 assert(report.protectedFiles.every(item=>item.unchanged));fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({runId:run.id,path:asset.path,duration:probe.format.duration,asrTextMatchesInput:report.asrTextMatchesInput,elapsedSeconds:report.elapsedSeconds,nativeSignal:report.nativeSignal,audioMastering:report.audioMastering,qualityAccepted:false},null,2));
 assert.equal(report.nativeSignal.fullScaleSamples,0);assert.equal(report.asrTextMatchesInput,true);
}
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
module.exports={simplified,normalize};
