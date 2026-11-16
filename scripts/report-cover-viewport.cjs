// 汇总真实页面、媒体和目录包证据；技术通过不代表封面内容或原版一致性验收。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const root=path.resolve('evidence/validation/cover-viewport-20261116');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8')),load=name=>read(path.join(root,name));
const write=(name,value)=>fs.writeFileSync(path.join(root,name),JSON.stringify(value,null,2),{flag:'wx'});
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
if(process.argv[2]==='media'){
 const interaction=load('interaction.json'),settings=load('baseline.json').settings,file=interaction.output.file;
 assert.equal(hash(file),interaction.output.sha256);
 const probe=spawnSync(settings.ffprobePath,['-v','error','-show_streams','-of','json',file],{encoding:'utf8',windowsHide:true});
 assert.equal(probe.status,0,probe.stderr);const streams=JSON.parse(probe.stdout).streams;assert.equal(streams[0].width,1080);assert.equal(streams[0].height,1920);
 const decode=spawnSync(settings.ffmpegPath,['-v','error','-i',file,'-f','null','-'],{encoding:'utf8',windowsHide:true});assert.equal(decode.status,0,decode.stderr);
 write('media.json',{at:new Date().toISOString(),file,sha256:hash(file),streams,probeExitCode:probe.status,decodeExitCode:decode.status,decodeStderr:decode.stderr,visuallyReviewed:true,visualFinding:'导出文字与编辑预览对应；新增功能测试图层与原标题重叠，不作为成品排版质量通过。',contentQualityAccepted:false});
 console.log(JSON.stringify({width:streams[0].width,height:streams[0].height,probeExitCode:probe.status,decodeExitCode:decode.status}));
}else if(process.argv[2]==='final'){
 const before=load('baseline-recovered-layout.json'),after=load('fixed-layout.json'),prepared=load('prepared.json'),interaction=load('interaction.json'),media=load('media.json'),cleanup=load('cleanup.json');
 assert.equal(before.checks.length,16);assert.equal(after.checks.length,16);assert.deepEqual(before.canvasUnchanged,prepared.canvas);assert.deepEqual(after.canvasUnchanged,prepared.canvas);assert.deepEqual(after.pageErrors,[]);assert.deepEqual(interaction.pageErrors,[]);assert.equal(cleanup.originalDataUnchanged,true);assert.equal(cleanup.protectedFilesUnchanged,6);
 const receipts=Object.fromEntries(['build','package','verify'].map(mode=>{const receipt=read(path.resolve('evidence/validation/local-full-workflow-20261115',mode+'-cover-viewport-code.json'));assert.equal(receipt.exitCode,0);return[mode,receipt];}));
 const packageReport=read('evidence/validation/package-report.json');assert.equal(packageReport.sourceMatchesPackage,true);write('package-report.json',packageReport);
 const comparisons=after.checks.map(c=>{const b=before.checks.find(v=>v.width===c.width&&v.height===c.height&&v.withStatus===c.withStatus&&v.fontSize===c.fontSize);assert(b);return{width:c.width,height:c.height,withStatus:c.withStatus,fontSize:c.fontSize,beforeCanvas:b.canvas,afterCanvas:c.canvas,viewport:c.holder,beforeScreenshot:b.shot,afterScreenshot:c.shot};});
 const errors=fs.readFileSync(path.join(root,'errors.jsonl'),'utf8').trim().split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));
 const report={at:new Date().toISOString(),status:'局部封面可用性修正已验证，整体目标继续进行',productionChanges:['src/cover.css','src/components/CoverEditor.vue'],comparisons,canvasPixelsUnchanged:prepared.canvas,interaction,media,cleanup,codeReceipts:receipts,package:{checkedFiles:packageReport.files.length,sourceMatchesPackage:true,startupVerified:false},modelSubmissions:0,reviewedScreenshots:['interaction-selected-layer.png','interaction-real-cover.png','interaction-reload.png'],errorsRetained:errors,limitations:['小窗口通过独立滚动查看完整画布，并非完整画布同时可见。','鼠标拖动和键盘移动组合验证已通过，未单独证明每个键盘步长。','功能测试封面文字重叠，不当作商业排版质量验收。','基线验证曾误选其他同名窗口并将其调至1400×1000，缺乏该窗口更早尺寸证据，不能声称所有其他窗口尺寸完全恢复。','645项后端检查属于前一账号批；本批Vue/CSS使用16状态及真实交互验证，未重复整套后端检查。','原版全页面功能/UI/交互一致性、声音真人感与人物匹配、连续口型和完整长片仍未验收。','原厂隐藏提示词暂无可靠信息；账号真实认证、成功发布预检与上传尚未验收。','没有启动打包EXE。'],referencePixelParityAccepted:false,overallGoalComplete:false};
 write('delivery-report.json',report);console.log(JSON.stringify({states:comparisons.length,packageFiles:packageReport.files.length,sourceMatchesPackage:true,restored:cleanup.originalDataUnchanged,overallGoalComplete:false}));
}else throw Error('请选择media或final');
