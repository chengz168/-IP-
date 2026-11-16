const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve('evidence/validation/subtitle-motion-runtime');
const read=name=>JSON.parse(fs.readFileSync(path.join(root,name),'utf8'));
const runtime=read('media-runtime.json'),frames=read('actual-frame-checks.json'),desktop=read('desktop-media-verification.json'),checks=read('desktop-checks.json'),layouts=read('desktop-layout.json'),restored=read('workspace-restored.json'),packaged=read('package-report.json');
assert.equal(runtime.media.length,17);assert.equal(runtime.previews.length,6);assert.equal(checks.filter(c=>!c.passed).length,0);assert.equal(layouts.length,8);assert.equal(packaged.sourceMatchesPackage,true);assert.equal(restored.byteIdentical,true);
const report={status:'progress',goalStatus:'active',completeReplica:false,referenceParityAccepted:false,qualityAccepted:false,
 implementedTemplates:['scrolling_3lines','scrolling_4lines','3d_flip','purple_slide','red_yellow','red_blue_science'],totalUpgradedTemplates:9,remainingLegacyTemplates:13,
 reference:{kind:'原厂只读静态解码规则及既有交互证据',executesVendorModules:false,sameInputVendorFinalVideoCompared:false,fullProductVisualParity:false,completeHiddenPromptsKnown:false},
 validation:{targetedTests:{pass:26,fail:0,durationMs:231.336,exitCode:0},fullTests:{pass:447,fail:0,durationMs:4559.8427,exitCode:0},build:{modules:3299,durationSeconds:5.65,exitCode:0,entry:'main-BgaoiQp0.js',css:'main-By_ieeBr.css'},package:{exitCode:0,verifyExitCode:0,files:packaged.files.length,sourceMatchesPackage:true,startupVerified:false},
  media:{pipelineRenders:runtime.media.length,desktopButtonRenders:1,totalNewRenders:runtime.media.length+1,allHaveAudio:true,allFullDecodeExitCode:0,source:'合成纯色画面和正弦音轨，仅确定性字幕排版验证',modelRequests:0,frameChecks:frames.reduce((n,r)=>n+r.frames.length,0),desktopFrames:desktop.frames.length,gifSampleFrames:12,gifPreviews:runtime.previews,finalBlankAssertions:17,tenSecondGapBlankAssertions:3,threeDTailAssertions:2,desktop},
  desktop:{recordCount:checks.length,recordsIncludeLayoutSummary:true,independentBusinessFlowCountClaimed:false,layouts:layouts.length,windows:[[1400,1000],[1100,760]],fontSizes:['compact','large'],nativePlaybackAdvanceSeconds:checks.find(c=>c.advance)?.advance,pageErrors:read('desktop-errors.json')},
  warnings:['11个exit监听器警告仍保留','主包541.20kB提示仍保留','package author及重复依赖提示仍保留','此前打包EXE启动被自动审批拒绝，本批未尝试绕过'],
 },restored,
 limitations:['剩余13模板仍是旧规则，未完成逐套实际生成对照','没有原厂同输入最终视频逐帧比较','原厂main.jsc倍速实际调用未核实，本地时段按倍速缩放、固定毫秒动画不变','关键词来自有效本地辅助数据，本批没有模型请求；未取得原厂完整关键词提示词','八局部布局检查不等于全页面全状态像素一致','全部教程连续音画、完整隐藏提示词、文案与音画业务质量、声音克隆情绪、口型和平台发布仍待完成']};
fs.writeFileSync(path.join(root,'delivery-report.json'),JSON.stringify(report,null,2));
fs.writeFileSync(path.join(root,'first-attempt-issues.json'),JSON.stringify([{kind:'核对记录更正',detail:'findings最初将3D误记90度，完整读取后紧接更正为fry12；最终代码与测试使用12。'},{kind:'只读搜索路径失败',detail:'查找不存在的TopBar.vue和上一轮desktop-checks.json返回失败，随后直接核对App.vue及本轮独立记录。没有计为通过。'}],null,2));
console.log(JSON.stringify({file:path.join(root,'delivery-report.json'),status:report.status,tests:447,renders:18,layouts:8,restored:true}));
