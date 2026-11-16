const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const directory=path.resolve('evidence/validation/reference-video-night-20261115');
const read=name=>JSON.parse(fs.readFileSync(path.join(directory,name),'utf8'));
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const collection=read('collection.json'),media=read('media-verification.json'),playback=read('playback.json');
assert.equal(media.promptId,collection.promptId);assert.equal(playback.assetId,collection.asset.id);
assert(media.historyGraphMatched&&media.uploadChecks.every(item=>item.matched)&&media.video.fullDecodeVerified);
assert.equal(media.video.frames,192);assert.equal(hash(media.video.path),media.video.sha256);
assert(playback.fullNativePlaybackToEnded&&playback.refreshBinding);assert.deepEqual(playback.pageErrors,[]);
const protectedFiles=media.protectedFiles.map(item=>({...item,unchanged:hash(item.file)===item.sha256}));assert(protectedFiles.every(item=>item.unchanged));
const quality={at:new Date().toISOString(),promptId:collection.promptId,status:'rejected-for-reference-parity',reviewMethod:'直接查看3张四路对照拼图，共9个时间点；未完成连续音画和逐音素听审',reviewedSheets:media.comparison.sheets,sampledTimes:media.comparison.samples.map(item=>item.time),observations:[
 {time:'4-5秒',finding:'新参考视频方案出现侧头和视线变化，旧首帧方案相同时刻基本面向正前；头部姿态与原片仍有差异。'},
 {time:'7秒',finding:'新参考方案与源视频均出现闭眼，旧首帧样本此抽帧仍睁眼；只证明该抽帧的可见状态。'},
 {time:'所查9个时刻',finding:'新参考方案脸型、眼镜与嘴部表情未与原成片一致，头发、衣服和背景细节仍变化。'},
 {time:'整片技术参数',finding:'生成画面608×1056，低于原1080×1920且比例不同；没有做超分。'},
],decision:'不替换默认生产图，不延长为208秒批量生成；继续核查专用视频配音方案。',originalAudioReused:true,newSpeechGenerated:false,continuousLipSyncReviewed:false,audioAudited:false,qualityAccepted:false,referenceParityAccepted:false,completeReplica:false};
fs.writeFileSync(path.join(directory,'quality-review.json'),JSON.stringify(quality,null,2));
const report={at:new Date().toISOString(),scope:'示例2夜间8秒Ref2VA真实生成实验及独立软件播放器验收',promptId:collection.promptId,documentedModelTaskIds:[collection.promptId],modelRuntimeLog:'evidence/research/generation-chain-20261115/comfy-h3/comfy-startup.log',modelExecutionDurationFromLog:'00:33:17',generatedVideo:media.video,rawModel:media.rawModel,sourceInputChecks:media.uploadChecks,originalAudioReused:true,newSpeechGenerated:false,audioCorrelation:media.audioCorrelation,comparison:media.comparison,playback,qualityReview:quality,protectedFiles,productionCodeChanged:false,productionGraphChanged:false,formalReferenceVideoModeImplemented:false,submittedThroughProductButton:false,experimentalAssetBoundForPlayback:true,fullProductTestsRerun:false,packageRebuilt:false,reason:'本批只增加实验核验/研究脚本和文档，没有生产源码变更；完成实际媒体与桌面验证。',startupVerifiedForPackagedExe:false,remaining:['达到原片同等人物与连续口型质量','本输入的新声音与完整208秒','正式单片/长片/多镜头参考视频模式的接入与恢复','全部页面、模板、按钮、交互与样式一致性','原厂服务器内部完整提示词','打包EXE独立启动验收'],qualityAccepted:false,referenceParityAccepted:false,completeReplica:false,goalStatus:'active'};
fs.writeFileSync(path.join(directory,'delivery-report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({promptId:collection.promptId,frames:media.video.frames,fullNativePlayback:true,protectedFilesUnchanged:true,qualityAccepted:false,referenceParityAccepted:false,completeReplica:false,goalStatus:'active'}));
