const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve('evidence/validation/local-generation');
const study=path.resolve('evidence/research/generation-chain-20261115');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const launch=read(path.join(root,'launch.json')),data=read(path.join(root,'workspace/studio.json'));
const report=read(path.join(root,'product-output/media-report.json'));
const currentSha=crypto.createHash('sha256').update(fs.readFileSync(launch.original)).digest('hex');
const run=data.runs.find(r=>r.id===report.runId);
const pack=read('evidence/validation/package-report.json');
const candidate=read(path.join(study,'comfy-h3/official-prompt-guided/receipt.json'));
// 汇总真实证据；没有听审、口型与同输入原厂对照时持续保留未验收。
const receipt={checkedAt:new Date().toISOString(),goalStatus:'active',completeReplica:false,qualityAccepted:false,referenceParityAccepted:false,
 product:{runId:run.id,promptId:run.remoteId,status:run.status,video:report.video,sha256:report.sha256,duration:Number(report.probe.format.duration),
  newModelVideo:true,newVoiceGeneration:false,audioOrigin:report.audioOrigin,boundToOriginalDraft:report.boundToOriginalDraft,
  fullDecodeVerified:report.fullDecodeVerified,asr:report.asr?.text,recoveredAfterActualRestart:report.recoveredAfterActualRestart,
  playback:read(path.join(root,'product-playback.json')),audioAudited:false,syncReviewed:false,visualSampleReview:'五张抽帧未见底部伪字幕；不能代表全部帧或连续同步通过'},
 rejectedExperiment:{variant:'guided-generation',reason:'五抽帧出现底部伪字幕，质量拒绝'},
 controlledExperiment:{variant:'official-prompt-guided',promptId:candidate.submission?.prompt_id,status:candidate.history?.status?.status_str||candidate.submissionState,
  mediaReport:path.join(study,'comfy-h3/official-prompt-guided/media-report.json'),lowerRegionReview:read(path.join(study,'comfy-h3/official-prompt-guided/lower-frame-review/manifest.json')),qualityAccepted:false},
 officialSkill:read(path.join(study,'official-h3-skill-receipt.json')),
 voiceRuntime:{home:'D:/AI-Runtimes/super-ip/indextts-2.5',setupComplete:fs.existsSync('D:/AI-Runtimes/super-ip/indextts-2.5/setup.json'),weightsDownloadComplete:fs.existsSync('D:/AI-Runtimes/super-ip/indextts-2.5/downloads.json'),newInferenceVerified:false},
 verification:{tests:{command:'npm test',passed:521,failed:0,exitCode:0,log:path.join(study,'h3-final-tests-after-review.log')},
  build:{command:'npm run build',exitCode:0,log:path.join(study,'h3-final-build-after-review.log'),warning:'主包925.63kB，保留大包警告'},
  package:{checkedFiles:pack.files.length,sourceMatchesPackage:pack.sourceMatchesPackage,localRuntime:pack.localRuntime,startupVerified:false}},
 originalWorkspace:{file:launch.original,beforeSha256:launch.beforeSha256,afterSha256:currentSha,unchanged:launch.beforeSha256===currentSha},
 limitations:['本地H3当前产品接入仅单形象、1至15秒；长片与多镜头未验收','IndexTTS依赖下载尚未完成，不能声称已生成克隆声音','没有任务ID的提交保留未知并阻止重交，目前无UI查回入口','未连续听审、未做原厂同输入成片对照','此前打包EXE启动被自动审批拒绝，本轮仅打包核验、未启动EXE']};
fs.writeFileSync(path.join(root,'delivery-report.json'),JSON.stringify(receipt,null,2));
if(!receipt.originalWorkspace.unchanged||!receipt.verification.package.sourceMatchesPackage)throw Error('原工作区或目录包核验不一致');
console.log(JSON.stringify({file:path.join(root,'delivery-report.json'),product:receipt.product.status,originalUnchanged:receipt.originalWorkspace.unchanged,controlledExperiment:receipt.controlledExperiment.status}));
