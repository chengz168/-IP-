const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const directory=path.resolve('evidence/validation/indextts-generation'),read=name=>JSON.parse(fs.readFileSync(path.join(directory,name),'utf8'));
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
async function hashLargeFile(file){const digest=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(file))digest.update(chunk);return digest.digest('hex');}
async function main(){
 const inputs=read('inputs.json'),state=read('workspace/studio.json'),home='D:/AI-Runtimes/super-ip/indextts-2.5';
 const downloads=JSON.parse(fs.readFileSync(path.join(home,'downloads.json'),'utf8')),setup=JSON.parse(fs.readFileSync(path.join(home,'setup.json'),'utf8'));
 const verifiedFiles=[];
 for(const file of downloads.files){
  const target=path.join(home,'upstream/checkpoints',file.target),stat=fs.statSync(target);
  assert.equal(stat.size,file.bytes);const sha256=await hashLargeFile(target);assert.equal(sha256,file.outputSha256);if(file.sha256)assert.equal(sha256,file.sha256);
  verifiedFiles.push({file:file.target,bytes:stat.size,sha256,publishedSha256Available:!!file.sha256,matchesDownloadReceipt:true});
 }
 const candidates=['normal','happy','fast'].map(label=>{
  const media=read(label+'-output/report.json'),playback=read(label+'-playback.json'),submit=read('submit-'+label+'.json'),run=state.runs.find(run=>run.id===media.runId);
  assert.equal(run?.status,'succeeded');assert.equal(submit.run.id,run.id);assert.equal(playback.runId,run.id);assert.equal(hash(media.path),media.sha256);
  assert.equal(media.nativeSignal.fullScaleSamples,0);assert(playback.fullNativePlaybackToEnded&&playback.bindingAfterReload);
  assert.equal(media.audioMastering.policy,'vocoder-before-limit-peak-0.95-v2');
  return {label,runId:run.id,assetId:run.output.id,file:media.path,sha256:media.sha256,durationSeconds:Number(media.probe.format.duration),speed:media.request.speed,emotion:media.request.emotion,strength:media.request.strength,nativeSignal:media.nativeSignal,audioMastering:media.audioMastering,asrOriginal:media.asr.text,asrSimplified:media.asrSimplified,asrTextMatchesInput:media.asrTextMatchesInput,fullDecodeVerified:true,fullPlaybackToEnded:true,refreshBinding:true,contentCheck:media.asrTextMatchesInput?'asr-text-matched':'requires-listening-review',audioAudited:false,qualityAccepted:false};
 });
 const layout=read('layout-report.json'),packageReport=JSON.parse(fs.readFileSync('evidence/validation/package-report.json','utf8'));
 assert(layout.layoutChecksPassed&&layout.states.length===16);assert(packageReport.sourceMatchesPackage);assert(candidates[0].asrTextMatchesInput&&candidates[2].asrTextMatchesInput);
 const protectedFiles=inputs.protectedFiles.map(file=>({...file,unchanged:hash(file.file)===file.sha256}));assert(protectedFiles.every(file=>file.unchanged));
 const report={at:new Date().toISOString(),scope:'本地IndexTTS模型安装与真实参考配音验证，非整体复刻验收',runtime:{home,upstreamCommit:setup.upstream_revision,source:downloads.source,sourceEndpoint:downloads.endpoint,downloadReceipt:path.join(home,'downloads.json'),verifiedFiles,totalBytes:verifiedFiles.reduce((sum,file)=>sum+file.bytes,0),fileCount:verifiedFiles.length,environmentCheck:read('environment-before-submit-fast.json')},text:inputs.text,reference:inputs.reference,referenceProvenance:inputs.provenance,candidates,speedComparison:{normalDuration:candidates[0].durationSeconds,fastDuration:candidates[2].durationSeconds,durationRatio:candidates[0].durationSeconds/candidates[2].durationSeconds,requestedSpeed:1.2},archives:['baseline-raw','intermediate-after-limit-v3'],validation:{torchTests:{passed:7,total:7,exitCode:0,log:path.resolve('evidence/research/generation-chain-20261115/indextts-before-limit-python-tests.log')},nodeTests:{passed:563,total:563,exitCode:0,durationMs:7247.9127,log:path.resolve('evidence/research/generation-chain-20261115/indextts-before-limit-full-tests.log')},build:{exitCode:0,durationSeconds:8.46,chunkWarning:true},package:{exitCode:0,sourceMatchesPackage:true,checkedFiles:packageReport.files.length,startupVerified:false},layout:{states:layout.states.length,passed:true,pageErrors:layout.pageErrors}},protectedFiles,unresolved:['高兴情绪候选ASR将台灯识别为胎能，暂不能区分发音问题或识别错误，未判正文通过','尚未进行实际听审或真人音色相似度验收','连续口型、参考原厂同输入效果与整品UI交互一致性未验收','原厂完整隐藏提示词暂无可靠证据'],audioAudited:false,qualityAccepted:false,referenceParityAccepted:false,completeReplica:false};
 fs.writeFileSync(path.join(directory,'delivery-report.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({file:path.join(directory,'delivery-report.json'),downloadedFiles:report.runtime.fileCount,totalBytes:report.runtime.totalBytes,candidates:candidates.map(item=>({label:item.label,duration:item.durationSeconds,asrMatches:item.asrTextMatchesInput,fullScaleSamples:item.nativeSignal.fullScaleSamples})),layoutStates:layout.states.length,protectedFilesUnchanged:true,qualityAccepted:false},null,2));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
