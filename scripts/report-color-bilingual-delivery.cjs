const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
// 只汇总已落盘证据，不重新生成视频或重复调用模型。
const root=path.resolve('evidence/validation/subtitle-color-bilingual-runtime');
const read=name=>JSON.parse(fs.readFileSync(path.join(root,name),'utf8'));
const runtime=read('media-runtime.json'),frames=read('actual-frame-checks.json'),desktop=read('desktop-media-verification.json'),checks=read('desktop-checks.json'),layouts=read('desktop-layout.json'),pack=read('package-report.json'),restored=read('workspace-restored.json'),reference=read('reference-restore.json'),translation=read('local-translation.json');
assert.equal(layouts.length,16);assert.equal(new Set(layouts.map(r=>r.name)).size,16);assert.ok(layouts.every(r=>r.issues.length===0));
assert.equal(runtime.media.length,23);assert.equal(desktop.length,2);assert.ok([...runtime.media,...desktop].every(r=>r.audio&&r.decodeExitCode===0));
assert.ok(restored.completeJsonBytesUnchanged&&restored.settingsUnchanged&&restored.activeRuns.length===0&&reference.unchanged);assert.ok(pack.sourceMatchesPackage);assert.equal(pack.startupVerified,false);
const testLog=fs.readFileSync(path.join(root,'full-test-final.log'),'utf8'),build=fs.readFileSync(path.join(root,'build.log'),'utf8');assert.match(testLog,/tests 482/);assert.match(testLog,/pass 482/);assert.match(testLog,/fail 0/);assert.match(build,/built in 4.50s/);
const issues=read('first-attempt-issues.json');
for(const issue of [
 {kind:'布局漏检与产品修正',detail:'原布局断言未覆盖导航摘要，目视发现1100×760大字号摘要越界13.875px。导航改flex列且卡片不压缩，补16项含摘要边界的实窗状态，均无记录问题。'},
 {kind:'交互验收工具错误',detail:'REPL超时及旧闭包造成部分记录未落盘，改为逐项读写磁盘，只补缺项；不将工具超时计为产品通过。'},
 {kind:'自动提示竞态与截图超时',detail:'计数后点击关闭提示发生自动消失竞态，750ms点击尝试仍失败。最终改正常等待提示隐藏，截图显式15秒超时，缺项复查完成。'},
 {kind:'跨进程比较工具错误',detail:'恢复时deepEqual因REPL对象原型不同失败；完整文件字节核对已通过，设置改JSON稳定比较后通过。没有修改原数据。'},
 {kind:'目视判断更正',detail:'曾在进度中误判成片白底按钮为浏览器默认样式；重新查看原版reference-render-result.png与静态上下文，确认原版相同状态确有白底模式/导出和蓝色打开，已向用户更正且未改此正确样式。'}
])if(!issues.some(r=>r.kind===issue.kind))issues.push(issue);
fs.writeFileSync(path.join(root,'first-attempt-issues.json'),JSON.stringify(issues,null,2));
const report={
 checkedAt:new Date().toISOString(),status:'progress',goalStatus:'active',completeReplica:false,referenceParityAccepted:false,qualityAccepted:false,
 implementedTemplates:['white_pinyin','variety_wave','cartoon_yellow','energy_pink_yellow','cute_pink','black_white_bilingual','yellow_white_bilingual','red_white_bilingual'],totalUpgradedTemplates:22,remainingLegacyTemplates:0,
 reference:{kind:'原厂只读静态模板规则及双语提示词定义；没有执行原厂模块',sameInputVendorFinalVideoCompared:false,fullProductVisualParity:false,completeHiddenPromptsKnown:false,mainTranslationCallConfirmed:false},
 validation:{
  firstTargetedAttempt:{total:21,pass:18,fail:3,exitCode:1},targeted:{pass:21,fail:0,exitCode:0},firstFullAttempt:{total:482,pass:481,fail:1,exitCode:1},fullTests:{pass:482,fail:0,exitCode:0,durationMs:4919.1577},
  build:{modules:3299,durationSeconds:4.50,exitCode:0,entry:'main-B3Dt9tZ2.js',css:'main-BUBzfLvp.css'},
  package:{exitCode:0,verifyExitCode:0,files:pack.files.length,sourceMatchesPackage:pack.sourceMatchesPackage,startupVerified:pack.startupVerified,limitation:pack.startupLimitation},
  media:{pipelineRenders:runtime.media.length,desktopButtonRenders:desktop.length,totalNewRenders:runtime.media.length+desktop.length,allHaveAudio:true,allFullDecodeExitCode:0,source:'纯色画面与正弦音轨，仅确定性字幕排版验证',pipelineFrames:frames.reduce((n,r)=>n+r.frames.length,0),desktopFrames:desktop.reduce((n,r)=>n+r.frames.length,0),stableAssertions:frames.length,finalBlankAssertions:frames.length,gifPreviews:runtime.previews.length,gifSampleFrames:16,pinyinWarmPixels:desktop[0].frames[2].warmPixels,desktopOutputs:desktop.map(({type,runId,assetId,path,width,height,duration,bytes})=>({type,runId,assetId,path,width,height,duration,bytes}))},
  desktop:{templateSelectionChecks:checks.filter(r=>r.type==='template-selection-and-keywords').length,playback:checks.filter(r=>r.type.startsWith('native-')),expandEscape:checks.find(r=>r.type==='preview-expand-escape'),refreshBinding:checks.find(r=>r.type==='bilingual-output-refresh-binding'),localLayoutStates:layouts.length,layoutScope:'仅字幕面板，两实窗尺寸×四字号×卡片/位置；不外推全页面全状态',allRecordedIssuesEmpty:true},
  translation:{success:translation.success,actualModelRequests:translation.requests.length,model:'qwen3.5:9b-q4_K_M',referenceModelLiteral:'deepseek-v3-2-251201',localTemperature:0,referenceTemperature:.7,qualityAccepted:false,usedInDesktopOutputs:false,limitation:'本机三条译文与桌面六条手工辅助数据是独立验证，不能混称'},
  workspace:restored,referenceDatabase:reference
 },
 limitations:[
  '22模板规则升级不等于原厂同输入成片或全产品一致验收。',
  '原厂逐单字策略已对照，但本机pypinyin词典与npm pinyin不同；重庆示例得到zhòng qìng，读音质量尚未通过。',
  '补充平面汉字𠀀在实际字体中出现缺字框；ASCII、标点和补充平面字符不标音。',
  '保留原厂固定负字间距，可爱彩色等低分辨率可能挤字。',
  '活力粉黄实际使用Math.random分组，预览与每次成片不保证相同随机结果。',
  '黄白双语保留全部多行原文/译文，与原厂split仅取前两段存在明确保护差异。',
  '双语只确认静态translateBatch定义，未核实原厂main.jsc实际主调用；本机模型、严格JSON协议、温度均不同。',
  '25视频为字幕合成样本，不代表业务文案、配音、数字人口型或原厂内容质量。',
  '仍有主链实际ASS/倍速调用、同输入原厂最终成片、全页面全状态对照、全部教程连续音画、完整隐藏提示词和业务生成质量待验。',
  '声音克隆/情绪/口型及发布服务尚未完成完整复刻，既有本地能力优先授权不变。'
 ],warnings:['主JS包541.70kB超过500kB提示','构建曾出现11exit监听器提示，打包author/重复依赖提示保留在日志'],issuesFile:'first-attempt-issues.json'
};
fs.writeFileSync(path.join(root,'delivery-report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({status:report.status,tests:482,renders:report.validation.media.totalNewRenders,layouts:layouts.length,packageFiles:pack.files.length,restoredPid:restored.pid,goalStatus:'active'},null,2));
