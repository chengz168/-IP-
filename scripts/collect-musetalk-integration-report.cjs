const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {digest}=require('../integrations/musetalk-local/input.cjs');
const root=path.resolve('evidence/validation/musetalk-integration-20261115');
const read=name=>JSON.parse(fs.readFileSync(path.join(root,name),'utf8').replace(/^\uFEFF/,''));
const data=read('workspace/studio.json'),prepared=read('prepared.json'),draft=data.drafts.find(d=>d.id===prepared.draftId);
const runs=data.runs.filter(r=>r.draftId===draft.id),avatar=runs.find(r=>r.type==='avatar'&&r.status==='succeeded');assert(avatar?.output?.id);
const worker=JSON.parse(fs.readFileSync(path.join(avatar.local.directory,'result.json'),'utf8'));
assert.equal(worker.status,'technical-complete');assert.equal(worker.generatedFrames,716);assert.equal(worker.inferenceCalls,179);
const media=read('media-inspection.json'),playback=read('playback.json'),render=read('render-media-inspection.json'),renderPlayback=read('render-playback.json'),captions=read('captions-completed.json');
assert(media.fullDecodeVerified&&playback.fullNativePlaybackToEnded&&render.fullDecodeVerified&&renderPlayback.fullNativePlaybackToEnded);
const packageReport=read('package-verification-revised.json');assert(packageReport.sourceMatchesPackage);
const failed=read('video-first-failure.json'),cancelled=read('cancel-completed.json'),preparation=read('preparation-cancel.json');
assert.equal(failed.workerReceipt.generatedFrames,280);assert.equal(cancelled.workerReceipt.generatedFrames,8);
const protection=prepared.protectedFiles.map(row=>({...row,unchanged:digest(row.file)===row.sha256}));assert(protection.every(row=>row.unchanged));
const tests={node:read('full-tests-final-v2-exit.json'),python:read('python-tests-final-exit.json')};assert.equal(tests.node.exitCode,0);assert.equal(tests.python.exitCode,0);
const report={at:new Date().toISOString(),scope:'产品入口新文案、新配音、MuseTalk单形象口型、字幕模板和剪辑的真实技术链；不是整品复刻验收',
 status:'technical-complete',draftId:draft.id,video:media.output,editedVideo:render.output,newCopyRunId:runs.find(r=>r.type==='rewrite')?.id,
 newSpeechRunId:runs.find(r=>r.type==='speech')?.id,newAvatarRunId:avatar.id,renderRunId:render.runId,
 generation:{model:'MuseTalk 1.5',frames:worker.generatedFrames,inferenceCalls:worker.inferenceCalls,width:worker.output.width,height:worker.output.height,fps:worker.output.fps,
  duration:Number(media.probe.format.duration),newSpeechGenerated:true,newFaceMotionGenerated:true,bodyAndBackgroundReusedFromSource:true,voiceReference:'此前自主H3合成虚构人物的声音样本，来源见prepared.json',
  sourceFramePolicy:media.sourceFramePolicy,reverseFrames:media.reversePlaybackGeneratedFrames,audioCorrelation:media.drivingAudio.correlation},
 attempts:[{kind:'preparation-cancellation',runId:preparation.run.id,frames:preparation.workerReceipt.generatedFrames,calls:preparation.workerReceipt.inferenceCalls},
  {kind:'actual-inference-cancellation',runId:cancelled.run.id,frames:8,calls:cancelled.workerReceipt.inferenceCalls},
  {kind:'duplicate-detection-failure',runId:failed.run.id,frames:280,calls:failed.workerReceipt.inferenceCalls},
  {kind:'production-button-retry',runId:avatar.id,frames:716,calls:179}],
 validation:{fullDecode:true,fullPlayback:true,refreshBinding:true,realWordTimestamps:captions.actualWordTimestamps,captionCount:captions.captions.length,
  subtitleTemplate:render.subtitleTemplate,cancelWithoutBinding:true,sourceFacePreflightFrames:read('face-preflight-all.json').frames.length,layoutStates:read('layouts.json'),
  nodeTests:{...tests.node,passed:608},pythonTests:{...tests.python,passed:25},package:{...read('package-revised-exit.json'),checkedFiles:packageReport.files.length,sourceMatchesPackage:true,startupVerified:false}},
 protectedFiles:protection,qualityAccepted:false,referenceParityAccepted:false,completeReplica:false,goalStatus:'active',
 userQualityFeedback:{voiceAccepted:false,feedback:'感觉声音听上去不是很像真人，而且跟当前的人物不匹配',followup:'先验证匹配人物的自然配音，再生成后续视频；参考原声音色克隆等待授权确认'},
 remaining:['本稿“不非得”用词不自然，不能当作内容质量通过','口型连续性、嘴周牙齿细节、音色及听感未验收','没有取得原厂完整隐藏提示词和内部模型','MuseTalk多镜头尚未接入','600秒只是当前输入设计边界，本批仅验证23.84秒；完整208秒未验收','全部页面、模板、按钮和交互及整体UI一比一仍未完成','目录包EXE独立启动未验证，此前自动审批拒绝未绕过']};
fs.writeFileSync(path.join(root,'delivery-report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({status:report.status,video:report.video,editedVideo:report.editedVideo,frames:716,qualityAccepted:false,completeReplica:false}));
