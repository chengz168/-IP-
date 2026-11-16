// 只汇总已执行的真实检查，字幕质量改进与声音/口型验收分别记录。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const {digest}=require('../integrations/musetalk-local/input.cjs');
const root=path.resolve(__dirname,'../evidence/validation/caption-phrases-C-20261116');
const read=name=>JSON.parse(fs.readFileSync(path.join(root,name),'utf8'));
const log=name=>fs.readFileSync(path.join(root,name),'utf8');
const media=read('media-result.json'),recognition=read('recognition-result.json'),pack=read('package-report.json'),baseline=read('baseline.json');
const counts=file=>Object.fromEntries(['tests','pass','fail','cancelled','skipped'].map(key=>{const m=log(file).match(new RegExp('^ℹ '+key+' (\\d+)','mu'));assert(m,'检查日志缺少'+key);return[key,Number(m[1])]}));
const before=counts('regression-before.log'),after=counts('regression-after.log'),full=counts('full-test.log');
assert.equal(before.fail,2);assert.equal(after.tests,28);assert.equal(after.fail,0);assert.equal(full.tests,677);assert.equal(full.pass,677);assert.equal(full.fail+full.skipped+full.cancelled,0);
assert.equal(pack.sourceMatchesPackage,true);assert.equal(pack.files.length,204);assert(/built in/.test(log('build.log')));
assert(media.fullDecode&&media.productPlayback.ended&&media.refreshBinding&&media.noNewSubmissionAfterReload);
assert.equal(digest(media.output.path),media.output.sha256);
const protection=baseline.protectedFiles.map(file=>({file:file.file,expected:file.sha256,actual:digest(file.file)}));
assert(protection.every(file=>file.expected===file.actual));
const ffmpeg='F:/Software/轻语IP智能体/aigc-human/resources/ffmpeg/bin/ffmpeg.exe';
const visualPairs=[];
for(const frame of media.frames){
 const file=path.join(root,'字幕修前修后-'+frame.time+'.png');
 const result=spawnSync(ffmpeg,['-v','error','-n','-i',frame.before,'-i',frame.after,'-filter_complex','[0:v][1:v]hstack=inputs=2[pair]','-map','[pair]','-frames:v','1',file],{windowsHide:true,encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);visualPairs.push({time:frame.time,path:file,layout:'左侧旧字幕，右侧修后字幕'});
}
const result={
 at:new Date().toISOString(),classification:'progress',overallGoalComplete:false,
 changedProductionFiles:[{path:path.resolve('server/caption-recognition.mjs'),sha256:digest('server/caption-recognition.mjs')}],
 regression:{before:{...before,exitCode:1,expectedFailure:true},after:{...after,exitCode:0},full:{...full,exitCode:0}},
 validationCommands:[
  {command:'node --test tests/caption-phrase-boundaries.test.cjs',phase:'before',exitCode:1},
  {command:'node --test tests/caption-phrase-boundaries.test.cjs tests/caption-recognition.test.cjs tests/workflow-jobs.test.cjs',phase:'after',exitCode:0},
  {command:'npm test',environment:'FFMPEG_PATH与FFPROBE_PATH指向项目实际媒体工具',exitCode:0},
  {command:'npm run build',exitCode:0},
  {command:'electron-builder --win dir',exitCode:0},
  {command:'node scripts/verify-package.cjs',exitCode:0},
  {command:'node scripts/verify-caption-phrases-C-result.cjs',exitCode:0,priorFailure:'界面state不暴露磁盘path，首轮误用导致ffprobe undefined；已改从持久化工作区读取，未重交识别或剪辑任务'}
 ],
 actualProductOperations:{transcribeRunId:recognition.runId,renderRunId:media.runId,throughActualButtons:true,newTranscribeRuns:1,newRenderRuns:1,newSpeechRuns:0,newAvatarRuns:0},
 output:media.output,source:media.source,captions:recognition.captions,wordBoundariesPreserved:recognition.wordBoundariesPreserved,
 duration:Number(media.metadata.streams.find(stream=>stream.codec_type==='video').duration),frames:200,
 fullDecode:true,fullNativeUnmutedPlayback:true,refreshBinding:true,noNewSubmissionAfterReload:true,audio:media.audio,
 visualReview:{observedFiles:[...media.frames.map(frame=>frame.after),path.join(root,'product-playback-ended.png')],observations:['0.65秒实际烧录为“走一走，”，4.7秒实际烧录为“几分钟，”。','字幕不再把这两个短语拆开，沿真实识别词时间调整边界。','当前样片仍沿用已有蓝白简约模板、原C声音和口型，不据此判断口型或声音更自然。'],continuousLipSyncAccepted:false,naturalnessAccepted:false,referenceParityAccepted:false},
 visualPairs,package:{checkedFiles:pack.files.length,sourceMatchesPackage:true,startupVerified:false},
 protectedFiles:protection,protectedFilesUnchanged:true,productionDataChanged:false,
 warnings:['全套保留MODULE_TYPELESS_PACKAGE_JSON/MaxListeners警告，未导致测试失败。','构建仍有大于500kB的资源块提示，未将其描述为性能达标。'],
 limitations:['原厂云端断句算法未知，本次为本地识别可读性修正。','四时刻口型余量0/10/20试验未证明牙齿改善，仍保留默认10。','正式平台上传、打包EXE独立启动、全页面功能模板UI交互一比一及整体生成质量仍未完成。']
};
fs.writeFileSync(path.join(root,'delivery-report.json'),JSON.stringify(result,null,2),{flag:'wx'});
console.log(JSON.stringify({tests:full.tests,packagedFiles:pack.files.length,fullPlayback:true,protectedFiles:protection.length,output:media.output.path,overallGoalComplete:false}));
