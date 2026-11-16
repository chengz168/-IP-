// 汇总真实生成、布局检查和文件保护凭据，不将技术通过写成人工质量验收。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {digest}=require('../integrations/musetalk-local/input.cjs');
const {Media,runProcess}=require('../server/media.cjs');
const root=path.resolve('evidence/validation/caption-cover-readability-20261115');
const checks=path.resolve('evidence/validation/local-full-workflow-20261115');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8')),load=name=>read(path.join(root,name));
async function main(){
 const reportFile=path.join(root,'delivery-report.json');assert(!fs.existsSync(reportFile),'已有总报告，不覆盖');
 const baseline=load('baseline.json'),generated=load('generated.json'),media=load('media.json'),finished=load('finished.json'),manual=load('manual-cover.json');
 const data=read('evidence/validation/musetalk-integration-20261115/workspace/studio.json');
 assert.equal(data.currentId,baseline.currentId);
 for(const draft of baseline.drafts)assert.deepEqual(data.drafts.find(d=>d.id===draft.id),draft);
 for(const key of ['settings','voices','publishRecords'])assert.deepEqual(data[key],baseline[key]);
 assert(baseline.protectedFiles.every(p=>digest(p.file)===p.sha256));
 assert.equal(data.runs.filter(r=>['queued','running','unknown'].includes(r.status)).length,0);
 assert.equal(data.workflowJobs.filter(j=>['queued','running','stopping'].includes(j.status)).length,0);
 assert.equal(generated.job.status,'awaiting_publish');assert.equal(generated.newSpeechGenerated,false);assert.equal(generated.newLipSyncGenerated,false);
 for(const output of Object.values(generated.outputs))assert.equal(digest(output.file),output.sha256);
 assert.equal(digest(manual.file),manual.sha256);assert(manual.checks.every(c=>!c.issues.length&&c.buttons.every(b=>b.same)));
 const binaries=new Media({data}).binaries();await runProcess(binaries.ffmpeg,['-v','error','-xerror','-i',manual.file,'-f','null','-']);
 const receipts={};for(const [mode,revision]of [['tests','caption-cover-raw'],['build','caption-cover-layout'],['package','caption-cover-layout'],['verify','caption-cover-layout']]){
  const file=path.join(checks,mode+'-'+revision+'-code.json');receipts[mode]={file,...read(file)};assert.equal(receipts[mode].exitCode,0);
 }
 const testLog=fs.readFileSync(path.join(checks,'tests-caption-cover-raw-stdout.log'),'utf8');assert(/(?:#|ℹ) tests 632\b/.test(testLog)&&/(?:#|ℹ) fail 0\b/.test(testLog));
 const packageReport=read('evidence/validation/package-report.json');assert(packageReport.sourceMatchesPackage);assert.equal(packageReport.files.length,200);
 const packageFile=path.join(root,'package-report-layout.json');fs.copyFileSync('evidence/validation/package-report.json',packageFile,fs.constants.COPYFILE_EXCL);
 const report={at:new Date().toISOString(),status:'progress',goalComplete:false,
  scope:'真实字幕分组、原始识别凭据、原版封面宽度和小窗口按钮遮挡修正',
  voicePreference:{receipt:path.resolve('evidence/validation/voice-listening-review-20261115/human-preference-C.json'),choice:'C',scope:'同稿A/B/C相对偏好',naturalnessAccepted:false,characterMatchAccepted:false},
  jobId:generated.job.id,runIds:generated.runs.map(r=>({id:r.id,type:r.type,status:r.status})),
  newSpeechGenerated:false,newLipSyncGenerated:false,sourceBodyAndBackgroundReused:true,
  captions:generated.draft.edit.captions,rawRecognitionPreserved:generated.rawWordEvidencePreserved,
  fullDecodeVerified:media.fullDecodeVerified,audioCorrelation:media.audioCorrelation,playback:finished.ended,
  outputs:generated.outputs,manualCover:{file:manual.file,sha256:manual.sha256,fullDecodeVerified:true,manualLinebreakOnly:true,autoTitleAlgorithmChanged:false},
  layout:{revision:manual.revision,checks:manual.checks,pageErrors:manual.pageErrors,smallPreviewLimitation:'1100×760且显示状态条时预览约83×147，未作像素一致验收'},
  visualReview:{directlyViewed:['caption-rebalanced.png','publish-playback.png','cover-editor.png','manual-cover-1100-layout-fixed.png','manual-cover-1400-layout-fixed.png','cover-manual-linebreak.jpg'],automaticTitleStillOrphaned:true,manualTitleTwoLines:true,olderCoverScreenshotHasLoadingThumbnails:true},
  validation:{receipts,backendTests:{count:632,failures:0,revision:'caption-cover-raw',rerunAfterCssOnlyChange:false},packageReport:packageFile,packageFiles:200,packagedStartupVerified:false},
  preservation:{restoredDraftId:data.currentId,originalDraftsUnchanged:true,settingsUnchanged:true,voicesUnchanged:true,publishRecordsUnchanged:true,protectedFilesUnchanged:baseline.protectedFiles.length,unfinishedRuns:0},
  failuresPreserved:['geometry-failed-1794759043408.json','manual-cover-1100.png','manual-cover-1400.png'],
  limitations:['自动标题末字单独落行尚未自动解决','字幕仍有繁体，未暗改ASR正文','声音自然度和人物匹配尚未验收','连续口型与完整长片质量尚未验收','全页面模板、功能、UI、交互一比一尚未完成','本批未导出发布包或上传平台','未启动打包EXE']};
 fs.writeFileSync(reportFile,JSON.stringify(report,null,2),{flag:'wx'});console.log(JSON.stringify({file:reportFile,restored:data.currentId,packageFiles:200,goalComplete:false}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
