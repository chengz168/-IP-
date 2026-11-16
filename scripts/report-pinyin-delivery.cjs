const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
// 只读取本批已完成证据，不重跑模型、生成管道或原厂程序。
const root=path.resolve('evidence/validation/subtitle-pinyin-runtime'),read=name=>JSON.parse(fs.readFileSync(path.join(root,name),'utf8'));
const reference=read('reference-inspection.json'),dictionary=read('dictionary-comparison.json'),runtime=read('media-runtime.json'),media=read('media-verification.json'),layouts=read('desktop-layout.json'),checks=read('desktop-checks.json'),pack=read('package-report.json'),restored=read('workspace-restored.json'),vendor=read('reference-restore.json'),pageErrors=read('page-errors.json'),audit=read('production-dependency-audit.json');
assert.equal(dictionary.characters,27584);assert.equal(dictionary.differences,3910);assert.equal(runtime.media.length,3);assert.equal(media.frameChecks,32);assert.equal(layouts.length,4);
assert.ok(layouts.every(r=>r.window.width===Number(r.name.split('-')[0])&&r.window.height===(r.window.width===1100?760:1000)&&r.issues.length===0));assert.equal(new Set(layouts.map(r=>r.name)).size,4);
assert.equal(pack.sourceMatchesPackage,true);assert.equal(pack.pinyinRuntime.hashVerified,true);assert.equal(pack.pinyinRuntime.metadata.remainingFieldsEqual,true);assert.equal(pack.startupVerified,false);assert.ok(restored.completeJsonBytesUnchanged&&restored.settingsUnchanged&&restored.activeRuns.length===0&&vendor.unchanged);assert.equal(pageErrors.length,0);
const testLog=fs.readFileSync(path.join(root,'full-test.log'),'utf8'),targetedLog=fs.readFileSync(path.join(root,'targeted-tests.log'),'utf8'),buildLog=fs.readFileSync(path.join(root,'build.log'),'utf8');assert.match(testLog,/pass 489/);assert.match(testLog,/fail 0/);assert.match(targetedLog,/pass 28/);assert.match(buildLog,/built in 5.89s/);
const issues=[
 {kind:'路径读取失误',detail:'曾按旧lib/index.js路径读取npm入口，实际package.json指定lib/cjs/pinyin.js；已按真实入口核对，未将失败读文件当实现证据。'},
 {kind:'CDP启动观察过早',detail:'首次连接9333拒绝，检查同一源码进程8708仍在运行，随后连入成功；没有重启生成任务。'},
 {kind:'包元数据原始字节核验失败',detail:'首次报告111文件sourceMatchesPackage=false，原因是electron-builder移除pinyin package.json的bugs/scripts/keywords。原始报告保留package-first-attempt.json。首个包装命令在node后执行Copy-Item，整体退出码0掩盖node失败，不能以该退出码认定通过；最终命令显式传播校验退出码。'},
 {kind:'核验规则修正',detail:'正式代码入口与其他109源码资源仍逐字节哈希一致；依赖清单保存源/包两份原始SHA，rawBytesEqual=false，并只允许已观察到的三个被移除字段，其余字段完整比较通过。不能说pinyin package.json原始字节相同。'},
 {kind:'窗口句柄误判',detail:'Get-Process MainWindowHandle命中同进程可见无标题辅助窗口。最初两条1100命名记录实际1400宽，已保留desktop-layout-before-window-check.json并剔除不当汇总。列举指定PID顶层窗口，确认有标题主窗口后实调1100×760重测；helper新增宽高与记录名断言。最终四条均匹配实际尺寸。'},
 {kind:'原版依赖边界',detail:'原版仅声明pinyin ^4.0.0，包中未找到依赖实际文件。没有执行原厂模块、未核实原厂安装版本与主调用，不把本地固定4.0.0冒认为原厂运行结果。'}
];fs.writeFileSync(path.join(root,'first-attempt-issues.json'),JSON.stringify(issues,null,2));
const report={
 checkedAt:new Date().toISOString(),status:'progress',goalStatus:'active',completeReplica:false,referenceParityAccepted:false,qualityAccepted:false,
 changes:['白色注音使用固定npm pinyin 4.0.0，按原模板逐单字STYLE_TONE/heteronym false','生产注音不再启动Python；移除设置入口，原有配置数据保留兼容','仅白色注音engine2升3使旧成片和模板GIF失效，其他21套规则保持','目录包核对真实词典代码入口与精简后的依赖清单；局部布局验证增加真实尺寸断言'],
 reference,dictionary:{characters:dictionary.characters,differences:dictionary.differences,examples:dictionary.examples,referenceOutputVerified:false,qualityAccepted:false},
 validation:{
  targeted:{pass:28,fail:0,durationMs:374.7723,exitCode:0},fullTests:{pass:489,fail:0,durationMs:4936.1873,exitCode:0},build:{modules:3299,durationSeconds:5.89,exitCode:0,entry:'main-DLwQ-yjh.js',css:'main-BUBzfLvp.css'},
  package:{exitCode:0,verifyExitCode:0,files:pack.files.length,sourceMatchesPackage:pack.sourceMatchesPackage,pinyinRuntime:pack.pinyinRuntime,startupVerified:false,limitation:pack.startupLimitation},
  media:{pipelineRenders:runtime.media.length,desktopButtonRenders:1,totalNewRenders:runtime.media.length+1,allHaveAudio:[...runtime.media,media.desktop].every(r=>r.audio),allFullDecodeExitCode:[...runtime.media,media.desktop].every(r=>r.decodeExitCode===0)?0:null,source:runtime.source,invalidPythonConfigured:runtime.invalidPythonConfigured,frames:media.frameChecks,stableAssertions:media.stableAssertions,keywordColorAssertions:media.keywordColorAssertions,finalBlankAssertions:media.finalBlankAssertions,gif:runtime.preview,gifSampleFrames:media.gifSampleFrames.length,desktopAssetId:media.desktop.assetId},
  desktop:{checks:checks.filter(r=>r.type!=='layout-summary'),layoutStates:layouts.map(({name,window})=>({name,window})),pageErrors,scope:'仅本批设置入口和字幕局部状态；不外推全页面全交互'},
  modelRequests:0,productionDependencyAudit:{exitCode:0,reportedVulnerabilities:audit.metadata.vulnerabilities.total,scope:'npm audit --omit=dev，仅本次查询结果'},workspace:restored,referenceDatabase:vendor
 },
 limitations:['原版实际pinyin安装版本和main.jsc主调用仍未核实，同输入原厂最终成片未比较。','逐单字策略保留，重庆仍输出zhòng qìng、音乐仍按单字输出yīn lè；不是上下文准确读音保证。','补充平面字符不标音，已目视确认𠀀存在缺字框；字号、字体或词典名字不能替代内容质量验收。','四次新视频为复用合成源的排版验证，未冒称业务出片、原厂云端生成或声音/口型质量。','全部教程连续音画、完整隐藏提示词、全页面全状态、业务文案与配音/视频质量、克隆情绪口型及平台发布继续待验。'],
 warnings:['主包541.19kB提示','全套测试保留MODULE_TYPELESS_PACKAGE_JSON及11 exit监听器警告','打包author及重复依赖提示保留'],issuesFile:'first-attempt-issues.json'
};fs.writeFileSync(path.join(root,'delivery-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,tests:report.validation.fullTests.pass,newVideos:report.validation.media.totalNewRenders,frames:media.frameChecks,layouts:layouts.length,packageFiles:pack.files.length,restoredPid:restored.pid,goalStatus:'active'},null,2));
