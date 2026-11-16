const {app,BrowserWindow}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const project=path.resolve(__dirname,'..'),root=path.join(project,'evidence/validation/custom-title-native'),workspace=path.join(root,'worker-check');
fs.mkdirSync(workspace,{recursive:true});app.setPath('userData',path.join(workspace,'electron-data'));
// 独立验收没有业务主窗，首个隐藏窗口关闭后仍需继续其余尺寸。
app.on('window-all-closed',()=>{});
const report={checkedAt:new Date().toISOString(),sourceElectron:true,cases:[]};
app.whenReady().then(async()=>{
 const state=JSON.parse(fs.readFileSync(path.join(root,'interactive-workspace/studio.json')));state.settings.outputDir=path.join(workspace,'output');fs.writeFileSync(path.join(workspace,'studio.json'),JSON.stringify(state));
 const service=require('../server/service.cjs').createService(workspace),draw=require('../electron/cover-worker.cjs').coverRenderer(service,'renderTitle'),{titleSnapshot}=await import('../server/title-model.mjs'),edit=state.drafts.find(d=>d.id===state.currentId).edit;
 for(const [width,height] of [[360,640],[640,360],[1080,1920],[3840,2160]]){
  const snapshot=titleSnapshot(edit,width,height),result=await draw(snapshot),png=Buffer.from(result.data.split(',')[1],'base64');assert.equal(png.readUInt32BE(16),width);assert.equal(png.readUInt32BE(20),height);assert.equal(BrowserWindow.getAllWindows().length,0);const file=path.join(root,`worker-${width}x${height}.png`);fs.writeFileSync(file,png);report.cases.push({width,height,file,bounds:result.bounds,workersClosed:true});
 }
 const invalid=titleSnapshot(edit,1080,1920);invalid.design.custom.fontId='missing-native-title-font';await assert.rejects(draw(invalid),/字体已缺失/);assert.equal(BrowserWindow.getAllWindows().length,0);report.missingFontClosed=true;
 const controller=new AbortController(),pending=draw(titleSnapshot(edit,1080,1920),{signal:controller.signal});setTimeout(()=>controller.abort(),10);await assert.rejects(pending,/已停止/);assert.equal(BrowserWindow.getAllWindows().length,0);report.cancelClosed=true;report.passed=true;
}).catch(error=>{report.error=error.stack;}).finally(()=>{fs.writeFileSync(path.join(root,'worker-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));app.exit(report.passed?0:1);});
