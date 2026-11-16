// 汇总实际按钮、逐帧来源、媒体、取消、布局及目录包证据，质量验收单列。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {digest}=require('../integrations/musetalk-local/input.cjs'),{sourceIndex}=require('../integrations/musetalk-local/production-input.cjs');
const root=path.resolve('evidence/validation/musetalk-multi-20261115'),read=name=>JSON.parse(fs.readFileSync(path.join(root,name),'utf8'));
const target=path.join(root,'delivery-report.json');assert(!fs.existsSync(target),'已有交付收据');
const media=read('media.json'),playback=read('playback.json'),cancel=read('cancel-completed.json'),integrity=read('integrity.json'),layouts=read('layouts.json'),before=read('refresh-baseline.json'),after=read('refresh-fixed.json');
assert.equal(digest(media.output),media.sha256);assert.equal(playback.runId,media.runId);assert(playback.fullPlaybackToEnded&&playback.refreshBinding);
assert(cancel.actualProductSubmitAndStop&&cancel.inferenceStarted&&cancel.wrapperProcessExited&&cancel.noAssetAdded&&cancel.noVideoBound&&cancel.noNextShotStarted&&cancel.canGenerateAgain);
assert.equal(cancel.worker.status,'cancelled');assert(Object.values(after.controls).every(Boolean));assert(Object.values(before.controls).some(value=>!value));
const mappings=media.receipt.parts.map(part=>{
 const input=JSON.parse(fs.readFileSync(part.inputManifest,'utf8')),worker=JSON.parse(fs.readFileSync(part.receiptPath,'utf8'));
 const rows=fs.readFileSync(path.join(path.dirname(part.receiptPath),'face-measurements.jsonl'),'utf8').trim().split(/\r?\n/).map(JSON.parse);
 assert.equal(rows.length,part.generatedFrames);assert.equal(digest(part.path),part.sha256);assert.equal(worker.inputManifestSha256,digest(part.inputManifest));
 assert(rows.every((row,index)=>row.frame===index&&row.sourceFrame===sourceIndex(index,input.sourceFrameCount)&&row.changedPixelsInsideFaceBox>0&&row.outsideFaceBoxIdenticalBeforeEncoding));
 return {shotIndex:part.index,generatedFrames:part.generatedFrames,retainedFrames:part.retainedFrames,sourceVideoSha256:input.video.sha256,allSourceIndicesVerified:true,allOutsideFaceBoxesIdenticalBeforeEncoding:true};
});
const checks=Object.fromEntries(['tests','build','package','verify'].map(mode=>{const receipt=read(mode+'-refresh-lock-code.json');assert.equal(receipt.exitCode,0);return [mode,receipt];}));
const testLog=fs.readFileSync(path.join(root,'tests-refresh-lock-stdout.log'),'utf8');assert(/tests 626/.test(testLog)&&/pass 626/.test(testLog)&&/fail 0/.test(testLog)&&/skipped 0/.test(testLog));
const packaged=JSON.parse(fs.readFileSync('evidence/validation/package-report.json','utf8'));assert(packaged.sourceMatchesPackage);assert.equal(packaged.files.length,200);
fs.copyFileSync('evidence/validation/package-report.json',path.join(root,'package-report-final.json'),fs.constants.COPYFILE_EXCL);
assert.equal(layouts.states,8);assert.deepEqual(layouts.pageErrors,[]);assert(integrity.originalDraftsUnchanged&&integrity.protectedFiles.every(item=>item.unchanged)&&integrity.unfinishedRuns===0);
const codeFiles=['server/musetalk-sequence.cjs','server/local-musetalk.cjs','server/avatar-request.cjs','server/workflow-jobs.cjs','server/h3-activity.mjs','src/components/VideoPanel.vue','src/views/SettingsView.vue'].map(file=>({file:path.resolve(file),sha256:digest(path.resolve(file))}));
const visualReview={at:new Date().toISOString(),inspectedImages:[path.join(root,'configured-editor.png'),...layouts.images,media.montage],
 observations:['实际镜头编辑器两行选择框、时长输入、排序及删除按钮对齐，行间和页脚有可见间距','1100大字号下分两行布局，控件及确定/取消均在弹窗内','抽帧可见夜间切至白天，4时刻人物及背景可辨'],
 continuousLipSyncAccepted:false,voiceNaturalnessAccepted:false,referencePixelParityAccepted:false};
fs.writeFileSync(path.join(root,'visual-review.json'),JSON.stringify(visualReview,null,2),{flag:'wx'});
const report={at:new Date().toISOString(),scope:'本地MuseTalk多镜头正式入口、真实生成、刷新锁定和实际推理取消',status:'technical-chain-complete-quality-review-required',
 output:media.output,outputSha256:media.sha256,duration:media.plan.duration,fps:media.plan.fps,frames:media.receipt.retainedFrames,inferredFrames:media.receipt.generatedFrames,inferenceCalls:media.receipt.inferenceCalls,
 shots:media.plan.shots.map(shot=>({index:shot.index,avatarId:shot.avatarId,requestedDuration:shot.requestedDuration,startFrame:shot.startFrame,endFrame:shot.endFrame,driverSamples:shot.driverSamples,paddedDriverSamples:shot.paddedDriverSamples,trimmedDriverSamples:shot.trimmedDriverSamples})),
 newVideoGenerated:true,newSpeechGenerated:false,sourceBodyAndBackgroundReused:true,completeOriginalAudioUsed:true,audioCorrelation:media.correlation,mappings,playback,cancel,
 refreshedSameLiveRun:{before,after},layouts:{states:8,pageErrors:[],images:layouts.images},visualReview,checks,nodeTests:{total:626,passed:626,failed:0,skipped:0},packagedFiles:200,sourceMatchesPackage:true,
 packagedExeStartupVerified:false,packagedExeLimitation:packaged.startupLimitation,integrity,codeFiles,newModelsDownloaded:false,originalDefaultsChanged:false,
 technicalLimitations:['逐镜头重新加载模型，启动开销大于一次加载','不同画幅等比补边，源需要符合既有整数CFR/无旋转等约束','短于1秒的镜头模型侧补静音再裁回，不能据技术通过认定其口型质量','当前真实样片为4秒，不代表600秒多镜头已实际出片验收'],
 humanVoiceNaturalnessAccepted:false,characterMatchAccepted:false,continuousLipSyncAccepted:false,referenceParityAccepted:false,completeReplica:false,goalStatus:'active'};
fs.writeFileSync(target,JSON.stringify(report,null,2),{flag:'wx'});
const update='\n## 2026-11-15 MuseTalk多镜头实际交付记录\n\n已实现生产多镜头并通过真实编辑器、生成视频、完整不静音播放及刷新绑定；6da161f8实际121帧/4.033333秒，推理149帧/38批次，原音轨相关0.999920497。3ade33f4专用取消任务在实际inference_started之后经停止处理返回cancelled，工作器cancelled、PID退出、无素材新增、未启动后续镜头。实际同活跃任务刷新复现按钮失锁并修正，前后门禁已留档。最终626项Node检查全通过、构建和目录包/200文件一致均退出0；新增生产变动后才重跑，历史625项保留。8状态几何及3张UI图/抽帧图已直接查看。原全部草稿与6保护SHA不变，恢复原3057d521，无未结束任务。总收据musetalk-multi-20261115/delivery-report.json。声音真人感、连续口型、完整长片及原版全页面功能/UI/交互仍未验收，整体goal继续active。\n';
for(const file of ['task_plan.md','findings.md','progress.md','docs/MuseTalk多镜头接入设计.md'])fs.appendFileSync(path.resolve(file),update);
console.log(JSON.stringify({report:target,output:media.output,frames:report.frames,inferenceCalls:report.inferenceCalls,tests:626,packagedFiles:200,originalDraftsUnchanged:true,qualityAccepted:false}));
