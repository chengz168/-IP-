const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),directory=path.join(root,'evidence/validation/reference-sample-20261115');
if(!process.versions.electron||process.env.ELECTRON_RUN_AS_NODE){
 const {spawn}=require('node:child_process'),env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 const child=spawn(require('electron'),['--js-flags=--expose-gc',__filename],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});child.stdout.pipe(process.stdout);child.stderr.pipe(process.stderr);child.on('exit',code=>{process.exitCode=code||0;});
}else{
 const {app}=require('electron');app.setPath('userData',path.join(directory,'lifetime-electron-profile'));
 app.whenReady().then(async()=>{
  if(typeof global.gc!=='function')throw Error('没有暴露真实GC，本次生命周期检查不能通过');
  console.log('已进入Electron并可强制回收');
  const {createService}=require('../server/service.cjs'),service=createService(path.join(directory,'lifetime-workspace'));
  const prepared=JSON.parse(fs.readFileSync(path.join(directory,'editor-prepared.json'),'utf8'));
  service.store.data.settings.subtitleFontsDir='F:/Software/轻语IP智能体/aigc-human/resources/fonts';service.store.save();
  const render=require('../electron/cover-worker.cjs').coverRenderer(service,'renderTitle'),{titleSnapshot}=await import('../server/title-model.mjs');
  let cycles=0;const results=[],timer=setInterval(()=>{global.gc();cycles++;},20);
  try{
   for(let index=0;index<3;index++){
    console.log('开始真实绘制'+(index+1));
    const result=await render(titleSnapshot(prepared.edit,608,1056));
    if(!result?.data?.startsWith('data:image/png;base64,'))throw Error('没有真实PNG标题图层');
    const bytes=Buffer.from(result.data.split(',')[1],'base64');if(bytes.readUInt32BE(16)!==608||bytes.readUInt32BE(20)!==1056)throw Error('图层尺寸错误');
    results.push({iteration:index+1,bytes:bytes.length,bounds:result.bounds});console.log('真实绘制已返回'+(index+1));global.gc();cycles++;
   }
  }finally{clearInterval(timer);}
  fs.writeFileSync(path.join(directory,'cover-worker-lifetime.json'),JSON.stringify({at:new Date().toISOString(),electron:process.versions.electron,node:process.versions.node,forcedGcCycles:cycles,actualTitleRenders:results,passed:results.length===3},null,2));
  console.log(JSON.stringify({passed:true,forcedGcCycles:cycles,actualTitleRenders:results.length}));app.quit();
 }).catch(error=>{console.error(error);app.exit(1);});
}
