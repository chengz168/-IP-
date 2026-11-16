// 汇总原自动链与修后重剪，保留失败和人工质量缺口，不把导出当上传。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve('evidence/validation/local-full-workflow-20261115'),read=name=>JSON.parse(fs.readFileSync(path.join(root,name),'utf8'));
const file=path.join(root,'delivery-report.json');assert(!fs.existsSync(file),'已有整链报告，不覆盖');
const original=read('generated.json'),repaired=read('unity-audio/generated.json'),inspection=read('unity-audio/media-inspection.json'),exported=read('exported.json'),finished=read('finished.json');
const checks=Object.fromEntries(['tests','build','package','verify'].map(kind=>[kind,read(kind+'-unity-audio-code.json')]));assert(Object.values(checks).every(c=>c.exitCode===0));
const packageReport=JSON.parse(fs.readFileSync('evidence/validation/package-report.json','utf8'));assert(packageReport.sourceMatchesPackage);
fs.writeFileSync(path.join(root,'unity-audio/package-report.json'),JSON.stringify(packageReport,null,2),{flag:'wx'});
const report={at:new Date().toISOString(),status:'technical-chain-complete-with-quality-gaps',workflowJobId:original.job.id,draftId:original.draft.id,
 stages:original.job.stages,newSpeechAndLipSyncActuallyGenerated:true,firstAttemptPassedMediaCheck:false,audioDiagnosis:read('audio-diagnosis/report.json'),
 repair:{...repaired.audioRepair,output:repaired.outputs.render,inspection,playback:read('playback-unity-audio.json'),explicitPublishSelection:read('unity-audio/publish-binding.json')},
 export:exported,restoration:finished,checks,packageFiles:packageReport.files.length,sourceMatchesPackage:true,packagedExeStarted:false,
 visualReview:{directlyViewed:['unity-audio/caption-grid.jpg','cover.jpg','publish-result-unity-audio.png'],captionQualityAccepted:false,coverQualityAccepted:false,
  observations:['字幕是实际ASR输出，仍有繁体字和单独的了字短句','字幕模板保留上句并切换颜色的实际画面已查看，未据此宣称与原版一致','封面标题末尾走字单独换行，质量不合格','修后发布页完整播放正确新素材；历史自动流程因手工重剪提示需重新处理，未掩盖为首次自动任务全部通过']},
 errors:[{action:'首次媒体核对',error:'render零偏移波形相关性约0.0457，未通过0.95门槛',resolution:'隔离复现确认atempo=1引入变化；原速绕过后实际新render相关0.9999458915，旧产物保留'},
  {action:'最初音轨回归测试',error:'纯扫频未重现，旧代码也通过',resolution:'改为44100Hz多频率非周期包络及停顿，旧代码失败，修后通过'},
  {action:'重剪收集',error:'前端state移除path导致copyFileSync收到undefined',resolution:'只读持久化原任务记录后补收；未重复点击剪辑'},
  {action:'首次修后发布页播放核对',error:'发布页已有显式视频选择仍为旧剪辑，来源断言失败',resolution:'经产品API明确更新本轮技术草稿发布素材为新render，再完整播放、导出并核对SHA'}],
 naturalnessAccepted:false,characterMatchAccepted:false,continuousLipSyncAccepted:false,referenceParityAccepted:false,uploaded:false,completeReplica:false,goalStatus:'active'};
fs.writeFileSync(file,JSON.stringify(report,null,2),{flag:'wx'});
const update='\n## 2026-11-15 实际自动整链及原速音轨修后验证\n\n真实自动任务ea61687a完成八阶段至awaiting_publish，新配音5.421859秒、新口型163帧5.433333秒。首次render音轨相关失败，诊断和修后实际重剪c4969d59已留档；修后相关0.9999458915、完整解码/ASR正文规范化一致、产品内完整不静音播放及刷新绑定通过。发布页显式素材仍为旧剪辑，首次来源断言失败，经产品API明确改选新成片才再次播放和导出；不冒认自动首次无错。实际导出包视频/封面SHA相符、未上传。原草稿3057d521已恢复，所有旧草稿/设置/发布记录及6保护SHA不变。全套629项0失败0跳过，构建/目录包/200文件一致核对退出0；未启动打包EXE。\n\n字幕抽帧、封面、发布页图已直接查看：仍有繁体和单字了短句；封面末尾走字单独一行不合格；声音/人物匹配/连续口型/视觉一比一未验收。导出仅技术样片。总报告local-full-workflow-20261115/delivery-report.json，旧失败与修后证据均保留，整体goal active。\n';
for(const name of ['task_plan.md','findings.md','progress.md'])fs.appendFileSync(name,update);
console.log(JSON.stringify({file,packageFiles:report.packageFiles,exported:exported.record.directory,uploaded:false,qualityAccepted:false}));
