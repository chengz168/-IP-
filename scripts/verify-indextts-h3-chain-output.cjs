const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {Media,runProcess}=require('../server/media.cjs'),{LocalAsr}=require('../server/local-asr.cjs'),{graphSignature}=require('../server/comfy-h3.cjs');
const {simplified,normalize}=require('./verify-indextts-output.cjs');
const directory=path.resolve('evidence/validation/indextts-h3-chain'),read=file=>JSON.parse(fs.readFileSync(path.join(directory,file),'utf8')),hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex'),hashFile=file=>hash(fs.readFileSync(file));
async function main(){
 const inputs=read('inputs.json'),data=read('workspace/studio.json'),submission=read('submission.json'),calls=read('http-calls.json'),run=data.runs.find(run=>run.id===submission.runId);
 if(run?.status!=='succeeded')throw Error('原H3任务尚未完成，未创建替代输出');
 const asset=data.assets.find(asset=>asset.id===run.output.id),draft=data.drafts.find(draft=>draft.id===inputs.draftId),remote=run.remote,output=path.join(directory,'product-output');fs.mkdirSync(output,{recursive:true});
 assert.equal(draft.video.assetId,asset.id);assert.equal(asset.origin,'comfy-h3');assert.equal(hashFile(asset.path),asset.h3.outputSha256);assert.equal(asset.h3.promptId,run.remoteId);
 assert.equal(graphSignature(remote.graph),remote.graphSha256);const posts=calls.filter(call=>call.method==='POST'&&call.url==='/prompt');assert.equal(posts.length,1);
 assert.equal(posts[0].promptId,run.remoteId);assert.equal(posts[0].clientId,remote.clientId);assert.equal(posts[0].graphSha256,remote.graphSha256);
 assert.equal(hashFile(inputs.audio.path),inputs.audio.sha256);assert.equal(hashFile(inputs.reference.path),inputs.reference.sha256);
 const store={data,asset:id=>data.assets.find(asset=>asset.id===id)},media=new Media(store),probe=await media.probe(asset.path),video=probe.streams.find(stream=>stream.codec_type==='video');
 await runProcess(media.binaries().ffmpeg,['-v','error','-i',asset.path,'-f','null','-']);
 const expectedDriver=path.join(output,'expected-driver.wav'),expectedImage=path.join(output,'expected-reference.png');
 await runProcess(media.binaries().ffmpeg,['-v','error','-y','-i',inputs.audio.path,'-map','0:a:0','-vn','-ac','1','-ar','32000','-c:a','pcm_s16le',expectedDriver]);
 await runProcess(media.binaries().ffmpeg,['-v','error','-y','-i',inputs.reference.path,'-frames:v','1','-update','1',expectedImage]);
 for(const [item,expected]of [[remote.audio,expectedDriver],[remote.image,expectedImage]]){
  const response=await fetch(remote.baseUrl+'/view?'+new URLSearchParams({filename:item.name,subfolder:item.subfolder,type:'input'}));assert.equal(response.status,200);const uploaded=Buffer.from(await response.arrayBuffer());assert.equal(hash(uploaded),item.sha256);assert.equal(hashFile(expected),item.sha256);
 }
 const referencePcm=path.join(output,'reference.pcm'),resultPcm=path.join(output,'result.pcm');
 for(const [file,target]of [[inputs.audio.path,referencePcm],[asset.path,resultPcm]])await runProcess(media.binaries().ffmpeg,['-v','error','-y','-i',file,'-map','0:a:0','-ac','1','-ar','32000','-c:a','pcm_s16le','-f','s16le',target]);
 const left=fs.readFileSync(referencePcm),right=fs.readFileSync(resultPcm),count=Math.min(left.length,right.length)/2;let dot=0,l=0,r=0;
 for(let index=0;index<count;index++){const a=left.readInt16LE(index*2),b=right.readInt16LE(index*2);dot+=a*b;l+=a*a;r+=b*b;}
 const contactSheet=path.join(output,'contact-sheet.jpg');await runProcess(media.binaries().ffmpeg,['-v','error','-y','-i',asset.path,'-vf','fps=1,scale=240:-1,tile=4x2','-frames:v','1','-update','1',contactSheet]);
 const bottomSheets=[];for(let start=0;start<Number(video.nb_frames);start+=56){const end=Math.min(Number(video.nb_frames)-1,start+55),file=path.join(output,'bottom-'+start+'-'+end+'.jpg');await runProcess(media.binaries().ffmpeg,['-v','error','-y','-i',asset.path,'-vf',`select='between(n,${start},${end})',crop=iw:ih*0.3:0:ih*0.7,scale=240:-1,tile=8x7`,'-frames:v','1','-update','1',file]);bottomSheets.push({start,end,file});}
 const report={at:new Date().toISOString(),runId:run.id,promptId:run.remoteId,file:asset.path,sha256:hashFile(asset.path),bytes:fs.statSync(asset.path).size,probe,submitCount:posts.length,newGeneratedVideo:true,newVoiceSource:inputs.audio,newVoiceCloneOfHuman:false,avatarReference:inputs.reference,fullDecodeVerified:true,boundToDraft:true,uploadedImageAndDriverMatchVerifiedSources:true,audioComparison:{sourceSamples:left.length/2,resultSamples:right.length/2,comparedSamples:count,correlationAtZeroLag:dot/Math.sqrt(l*r)},contactSheet,bottomSheets,protectedFiles:inputs.protectedFiles.map(item=>({...item,unchanged:hashFile(item.file)===item.sha256})),audioAudited:false,continuousLipSyncReviewed:false,qualityAccepted:false,referenceParityAccepted:false,completeReplica:false};
 try{report.asr=await new LocalAsr(store,media).transcribe(asset.id,{progress:(_value,message)=>console.log(message)});report.asrSimplified=simplified(report.asr.text);report.asrTextMatchesInput=normalize(report.asrSimplified)===normalize(simplified(inputs.text));}catch(error){report.asrError=error.message;}
 fs.writeFileSync(path.join(output,'media-report.json'),JSON.stringify(report,null,2));assert(report.protectedFiles.every(item=>item.unchanged));assert.equal(report.asrTextMatchesInput,true);assert(report.audioComparison.correlationAtZeroLag>.99);
 console.log(JSON.stringify({file:asset.path,sha256:report.sha256,duration:probe.format.duration,frames:video.nb_frames,fullDecodeVerified:true,asrMatches:true,audioCorrelation:report.audioComparison.correlationAtZeroLag,newVideoSubmissions:1,qualityAccepted:false},null,2));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
