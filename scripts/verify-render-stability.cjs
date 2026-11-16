const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),directory=path.join(root,'evidence/validation/render-stability-20261115');
const option=(name,fallback)=>process.argv.find(value=>value.startsWith('--'+name+'='))?.slice(name.length+3)||fallback;
const label=option('label','candidate');if(!/^[a-z0-9-]+$/.test(label))throw Error('验证标签无效');
const reportFile=path.join(directory,label+'-report.json');fs.mkdirSync(directory,{recursive:true});
if(!process.versions.electron||process.env.ELECTRON_RUN_AS_NODE){
 const {spawn}=require('node:child_process'),env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 const runtime=option('runtime',require('electron'));
 const child=spawn(runtime,['--js-flags=--expose-gc',__filename,'--label='+label],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
 const log=fs.createWriteStream(path.join(directory,label+'.log'));child.stdout.on('data',data=>{process.stdout.write(data);log.write(data);});child.stderr.on('data',data=>{process.stderr.write(data);log.write(data);});
 child.on('error',error=>{log.end(String(error));process.exitCode=1;});child.on('exit',(code,signal)=>{log.end();fs.writeFileSync(path.join(directory,label+'-exit.json'),JSON.stringify({at:new Date().toISOString(),code,signal,runtime},null,2));process.exitCode=code===0?0:1;});
}else{
 const {app,BrowserWindow,ipcMain}=require('electron');app.setPath('userData',path.join(directory,label+'-profile'));
 // 验证进程在两个隐藏窗口之间保持运行，避免把自动退出当成绘制成功。
 app.on('window-all-closed',()=>{});
 const report={at:new Date().toISOString(),electron:process.versions.electron,passed:false,cases:[],forcedGcCycles:0};
 const save=()=>fs.writeFileSync(reportFile,JSON.stringify(report,null,2));save();
 app.whenReady().then(async()=>{
  assert.equal(typeof global.gc,'function','必须实际暴露GC');
  const service=require('../server/service.cjs').createService(path.join(directory,label+'-workspace'));
  service.store.data.settings.subtitleFontsDir='F:/Software/轻语IP智能体/aigc-human/resources/fonts';service.store.save();
  const prepared=JSON.parse(fs.readFileSync(path.join(root,'evidence/validation/reference-sample-20261115/editor-prepared.json'),'utf8'));
  const {titleSnapshot}=await import('../server/title-model.mjs'),{namecardSnapshot}=await import('../server/namecard-model.mjs');
  const {coverRenderer}=require('../electron/cover-worker.cjs'),title=coverRenderer(service,'renderTitle'),card=coverRenderer(service,'renderNamecard'),cover=coverRenderer(service);
  const listeners=ipcMain.listenerCount('studio:cover-read');
  const collected=()=>{global.gc();report.forcedGcCycles++;};
  const timer=setInterval(collected,20);
  try{
   for(const [index,[width,height]]of [[608,1056],[360,640],[640,360],[1080,1920],[3840,2160],[608,1056]].entries()){
    report.currentCase='标题'+(index+1);save();
    const result=await title(titleSnapshot(prepared.edit,width,height)),png=Buffer.from(result.data.split(',')[1],'base64');
    assert.equal(png.readUInt32BE(16),width);assert.equal(png.readUInt32BE(20),height);
    assert.equal(BrowserWindow.getAllWindows().length,0);assert.equal(ipcMain.listenerCount('studio:cover-read'),listeners);
    const file=path.join(directory,label+'-title-'+index+'.png');fs.writeFileSync(file,png);
    report.cases.push({type:'title',width,height,sha256:crypto.createHash('sha256').update(png).digest('hex'),file,workersClosed:true,listenersRestored:true});
    console.log('已完成 '+report.currentCase);collected();await new Promise(resolve=>setTimeout(resolve,80));save();
   }
   assert.equal(report.cases[0].sha256,report.cases[5].sha256,'同输入标题像素应稳定');
   report.currentCase='名片';save();
   const cardInput=namecardSnapshot({cardName:'夜间创作者',cardDescription:'真实本地绘制',cardDesign:{fontId:prepared.subtitleFont.id,fontFamily:prepared.subtitleFont.family}},608,1056);
   const cardResult=await card(cardInput),cardPng=Buffer.from(cardResult.data.split(',')[1],'base64');assert.equal(cardPng.readUInt32BE(16),608);assert.equal(cardPng.readUInt32BE(20),1056);
   report.cases.push({type:'namecard',width:608,height:1056,bytes:cardPng.length});collected();
   report.currentCase='封面';save();
   const coverResult=await cover({template:'default',modelVersion:1,title:'夜间创作验证',subtitle:'真实本地绘制'});assert(coverResult.startsWith('data:image/jpeg;base64,'));report.cases.push({type:'cover',bytes:Buffer.from(coverResult.split(',')[1],'base64').length});collected();
   report.currentCase='缺失字体';save();
   const invalid=titleSnapshot(prepared.edit,608,1056);invalid.design.custom.fontId='missing-stability-font';await assert.rejects(title(invalid),/字体已缺失/);report.missingFontRejected=true;
   report.currentCase='取消';save();
   const controller=new AbortController(),pending=title(titleSnapshot(prepared.edit,608,1056),{signal:controller.signal});setTimeout(()=>controller.abort(),5);await assert.rejects(pending,/已停止/);report.cancelRejected=true;
   for(let index=0;index<20;index++){collected();await new Promise(resolve=>setTimeout(resolve,20));}
   assert.equal(BrowserWindow.getAllWindows().length,0);assert.equal(ipcMain.listenerCount('studio:cover-read'),listeners);report.allWorkersClosed=true;report.listenersRestored=true;report.passed=true;report.currentCase='完成';save();
  }finally{clearInterval(timer);}
 }).catch(error=>{report.error=error.stack;save();console.error(error);}).finally(()=>{save();console.log(JSON.stringify({passed:report.passed,electron:report.electron,cases:report.cases.length,forcedGcCycles:report.forcedGcCycles}));app.exit(report.passed?0:1);});
}
