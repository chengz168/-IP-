// 直接读取已恢复源码窗口的渲染表面；系统区域截图可能被其他窗口遮挡，不能作目标窗口证据。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const {chromium}=require('C:/Users/DELL/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core');
const root=path.resolve('evidence/validation/voice-design-20261115/candidate-recovery'),directory=path.join(root,'surface-captures');fs.mkdirSync(directory,{recursive:true});
function run(args){const result=spawnSync('python',args,{encoding:'utf8',windowsHide:true});assert.equal(result.status,0,result.stderr);return result.stdout.trim();}
async function main(){
 const target=path.join(root,'surface-captures.json');assert(!fs.existsSync(target),'已有本次渲染表面截图，不覆盖');
 const browser=await chromium.connectOverCDP('http://127.0.0.1:9351'),page=browser.contexts()[0].pages()[0],cdp=await page.context().newCDPSession(page),images=[];
 const handle=Number(run(['scripts/desktop-handle.py','--pid','13984']));
 const call=(action,payload={})=>page.evaluate(({action,payload})=>window.studio.invoke(action,payload),{action,payload});
 const prior=(await call('state')).settings.fontSize;
 try{
  for(const [width,height,fontSize] of [[1400,1000,'comfortable'],[1100,760,'large']]){
   run(['scripts/resize-desktop.py','--handle',String(handle),'--width',String(width),'--height',String(height)]);await call('saveAppearance',{fontSize});await page.reload();await page.locator('.app main').waitFor();
   await page.locator('.top-menu>button').click();await page.getByRole('navigation',{name:'主菜单',exact:true}).getByRole('button',{name:'声音管理',exact:true}).click();await page.getByRole('button',{name:'设计新音色',exact:true}).click();
   await page.getByRole('button',{name:'恢复这份试听的输入',exact:true}).evaluate(n=>n.scrollIntoView({block:'center',behavior:'instant'}));
   const file=path.join(directory,width+'-'+fontSize+'.png');let timer;
   const result=await Promise.race([cdp.send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('渲染表面捕获超时，保留几何检查，不能声称视觉通过')),8000);})]).finally(()=>clearTimeout(timer));
   fs.writeFileSync(file,Buffer.from(result.data,'base64'),{flag:'wx'});images.push({width,height,fontSize,file,visualInspected:false});
  }
 }finally{
  run(['scripts/resize-desktop.py','--handle',String(handle),'--width','1400','--height','1000']);await call('saveAppearance',{fontSize:prior});await page.reload();await browser.close();
 }
 fs.writeFileSync(target,JSON.stringify({at:new Date().toISOString(),images,captureMethod:'CDP Page.captureScreenshot fromSurface=true after restoring minimized source window',visualInspected:false},null,2),{flag:'wx'});console.log(JSON.stringify({images}));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
