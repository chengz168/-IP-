// 对比记录必须与实际输入和产物一致；不生成主观自然度分数。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {digest}=require('../integrations/musetalk-local/input.cjs');
const root=path.resolve('evidence/validation/voice-design-20261115'),read=name=>JSON.parse(fs.readFileSync(path.join(root,name),'utf8'));
const target=path.join(root,'naturalness-report.json');assert(!fs.existsSync(target),'已有本批收据，不覆盖');
const plan=read('naturalness-plan.json'),jobs=Object.fromEntries(['warm','chat','oral'].map(kind=>[kind,read('job-'+kind+'.json')]));
for(const key of ['text','language','seed','max_new_tokens'])assert.equal(jobs.warm[key],jobs.chat[key]);
for(const key of ['instruct','language','seed','max_new_tokens'])assert.equal(jobs.chat[key],jobs.oral[key]);
assert.notEqual(jobs.warm.instruct,jobs.chat.instruct);assert.notEqual(jobs.chat.text,jobs.oral.text);
const candidates=['warm','chat','oral'].map(kind=>{
 const generated=read('qwen-'+kind+'-generated.json'),inspection=read('qwen-'+kind+'-inspection.json');
 const playback=read('qwen-'+kind+(kind==='warm'?'-playback.json':'-exact-playback.json'));
 assert.equal(generated.run.status,'succeeded');assert.equal(digest(generated.file),generated.sha256);assert.equal(inspection.sha256,generated.sha256);
 assert.deepEqual(generated.run.parameters.job,jobs[kind]);assert(inspection.fullDecodeVerified&&playback.fullNativePlaybackToEnded);
 assert.equal(playback.runId,generated.run.id);assert(!playback.ended.muted);assert.deepEqual(playback.pageErrors,[]);
 return {kind,runId:generated.run.id,file:generated.file,sha256:generated.sha256,duration:Number(inspection.probe.format.duration),job:jobs[kind],
  newSpeechGenerated:true,submittedThroughProductButton:true,referenceAudio:null,signal:inspection.signal,fullDecodeVerified:true,asrTextMatchesInput:inspection.asrTextMatchesInput,
  recognizedText:inspection.recognizedSimplified,fullNativePlaybackToEnded:true,playbackMode:kind==='warm'?'existing-product-audition':'temporary-audio-control-using-product-media-protocol',
  refreshCandidateRecovered:playback.refreshCandidateRecovered,naturalnessAccepted:false,characterMatchAccepted:false,qualityAccepted:false};
});
const protectedFiles=read('prepared.json').protectedFiles.map(item=>({...item,unchanged:digest(item.file)===item.sha256}));assert(protectedFiles.every(item=>item.unchanged));
const errors=[{action:'chat既有播放脚本',error:'刷新后等待弹窗audio超时',resolution:'当时已提交oral，未把历史候选的刷新等待认定通过；改按精确素材ID独立播放，未重生成'},
 {action:'oral既有播放脚本',error:'播放结束后page.screenshot超时',resolution:'截图与听感无关；新脚本将实际ended及精确素材核对直接留档，不依赖截图'}];
const report={at:new Date().toISOString(),scope:'本地自主女声自然度受控候选',status:'awaiting-human-listening',userFeedback:plan.userFeedback,comparisons:plan.comparisons,candidates,protectedFiles,
 technicalErrors:errors,newModelSubmissions:2,productionDefaultsChanged:false,newModelsDownloaded:false,postProcessed:false,qualityScoreInvented:false,
 naturalnessAccepted:false,characterMatchAccepted:false,qualityAccepted:false,longVideoResumed:false,completeReplica:false,goalStatus:'active',
 checks:{scriptSyntaxVerified:true,productionCodeChanged:false,newFullSuiteRun:false,newBuildRun:false,notes:'本批只改研究验证脚本，既有全套构建和打包记录不冒认本批重跑'}};
fs.writeFileSync(target,JSON.stringify(report,null,2),{flag:'wx'});
const update='\n## 2026-11-15 自然度两组真实结果\n\nchat任务0337e86f真实生成9.52秒；oral任务33217dfa真实生成9.92秒。两者都经既有产品按钮提交，完整解码、ASR规范化正文一致、满幅0；精确素材ID经产品media协议原生不静音播放结束。不是原声搬用，无后期变速/变调/加混响，未修改生产预设。真人感、人物匹配仍待用户听审，不把技术完成当质量。旧chat播放脚本在刷新等待超时（提交oral发生在旧脚本未退出前，未将该恢复记为通过）；旧oral在播放后的截图超时。改用精确素材播放留档，不重生成。6项保护文件全SHA不变。总收据naturalness-report.json，goal active。\n';
for(const file of ['task_plan.md','findings.md','progress.md','docs/自主音色设计接入与验收.md'])fs.appendFileSync(path.resolve(file),update);
console.log(JSON.stringify({file:target,candidates:candidates.map(c=>({kind:c.kind,duration:c.duration,asrTextMatchesInput:c.asrTextMatchesInput})),protectedFilesUnchanged:protectedFiles.length,qualityAccepted:false}));
