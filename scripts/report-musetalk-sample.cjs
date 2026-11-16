const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve('evidence/validation/musetalk-sample-20261115'),home='D:/AI-Runtimes/super-ip/musetalk-1.5';
const read=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const destination=path.join(root,'delivery-report.json');if(fs.existsSync(destination))throw Error('已有收据，停止覆盖');
const result=read(path.join(root,'trial-1/result.json')),measurement=read(path.join(root,'trial-1/review/measurement.json')),readiness=read(path.join(root,'readiness-final-v2.json')),playback=read(path.join(root,'playback.json'));
if(result.status!=='technical-complete'||!readiness.readyForCandidateTrial)throw Error('真实结果或就绪状态不符');
const previous=read('evidence/validation/lipsync-native-input-20261115/delivery-report.json');
const production=previous.productionChecks.map(row=>({...row,unchanged:hash(row.file)===row.sha256}));
const packagedH3=require('@electron/asar').extractFile(path.resolve('release/win-unpacked/resources/app.asar'),'server/comfy-h3.cjs');
production.push({file:'server/comfy-h3.cjs',sha256:hash('server/comfy-h3.cjs'),baseline:'现有目录包app.asar',unchanged:hash('server/comfy-h3.cjs')===crypto.createHash('sha256').update(packagedH3).digest('hex')});
const protectedFiles=previous.protectedFiles.map(row=>({...row,unchanged:hash(row.file)===row.sha256}));
if(production.some(row=>!row.unchanged)||protectedFiles.some(row=>!row.unchanged))throw Error('受保护源码或数据变化');
const tests=[{command:'py -3.10 -m unittest discover -s integrations/musetalk-local -p test_*.py',count:18,exitCode:read(path.join(root,'final-python-tests-exit.json')).exitCode},
{command:'py -3.10 scripts/test-verified-wheel.py',count:5,exitCode:read('evidence/research/generation-chain-20261115/lipsync-plan/wheel-download-tests-final-exit.json').exitCode}];
if(tests.some(row=>row.exitCode!==0))throw Error('测试未通过');
const models=read(path.join(home,'model-receipt.json')),dependencies=read(path.join(home,'dependency-receipt.json'));
const report={at:new Date().toISOString(),scope:'已授权MuseTalk独立环境安装、示例二夜间8秒真实局部口型生成及三路对照',referenceAvatar:'示例2-夜间',
 runtime:{home,modelCount:models.files.length,modelBytes:models.expectedBytes,modelDownloadComplete:models.complete,modelReceiptMatches:readiness.modelDownloadReceiptMatches,allKnownHashesChecked:readiness.knownHashesChecked,
 independentOfficialModelMetadataVerified:false,sourceCommit:readiness.sourceCommit,sourceFilesVerified:readiness.sources.length,isolatedPython:readiness.isolatedPython,dependencyInstallation:dependencies,device:readiness.device,dependencyImports:readiness.dependencyImports},
 result,measurement,playback,validation:{tests,allPassed:true,totalTargetedTests:23,skipped:0,workerExitCode:read(path.join(root,'trial-1-exit.json')).exitCode,comparisonExitCode:read(path.join(root,'comparison-review-exit.json')).exitCode,playbackExitCode:read(path.join(root,'playback-exit.json')).exitCode,fullProductTestsRepeated:false,productionBuildRepeated:false,packageRepeated:false,reason:'本轮只新增独立候选模块、准备/验证脚本和文档，未接当前生产入口'},
 productionChecks:production,protectedFiles,newModelTrials:1,modelBatchCalls:60,newGeneratedFaceFrames:240,newSpeechGenerated:false,originalAudioReused:true,sourceBodyAndBackgroundReused:true,
 staticVisualReview:{directlyViewed:['trial-1/generated-frames/00000060.png','trial-1/source-frames/00000060.png','trial-1/review/comparison-grid.jpg','trial-1/review/frame-06.png','output/playwright/musetalk-night-20261115.png'],observed:'候选保留原示例转头、视线、眼镜、头发、衣服及背景；嘴部确有新生成，嘴型与原版仍存在差异。仅静态观察未替代连续口型/听审。'},
 pending:['逐句连续口型和嘴周质量验收','带声音完整听审','原厂同输入同质量验收','新文案及新配音到本候选的完整产品链路','产品生成按钮接入与取消/错误桌面验证','完整208秒生成及长片契约','全部功能模板UI交互一比一','原厂隐藏提示词暂无可靠信息'],
 listeningAccepted:false,continuousLipSyncAccepted:false,qualityAccepted:false,referenceParityAccepted:false,productIntegrationComplete:false,completeReplica:false,goalStatus:'active'};
fs.writeFileSync(destination,JSON.stringify(report,null,2));console.log(JSON.stringify({report:destination,modelCount:report.runtime.modelCount,modelBytes:report.runtime.modelBytes,tests:23,trialStatus:result.status,protectedFilesUnchanged:true,productionUnchanged:true,qualityAccepted:false},null,2));
