// 原生窗口截图只用于实际视觉检查；不将几何检查或空白CDP图当作视觉通过。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const {chromium}=require('C:/Users/DELL/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core');
const root=path.resolve('evidence/validation/voice-design-20261115/candidate-recovery');
function run(command,args){const result=spawnSync(command,args,{encoding:'utf8',windowsHide:true});assert.equal(result.status,0,result.stderr);return result.stdout.trim();}
async function main(){
 const target=path.join(root,'native-captures.json');assert(!fs.existsSync(target),'已有原生截图记录，不覆盖');
 const handle=Number(run('python',['scripts/desktop-handle.py','--pid','13984']));assert(handle);
 const browser=await chromium.connectOverCDP('http://127.0.0.1:9351'),page=browser.contexts()[0].pages()[0],images=[];
 const call=(action,payload={})=>page.evaluate(({action,payload})=>window.studio.invoke(action,payload),{action,payload});
 const prior=(await call('state')).settings.fontSize;
 try{
  for(const [width,height,fontSize] of [[1400,1000,'comfortable'],[1100,760,'large']]){
   run('python',['scripts/resize-desktop.py','--handle',String(handle),'--width',String(width),'--height',String(height)]);
   await call('saveAppearance',{fontSize});await page.reload();await page.locator('.app main').waitFor();
   await page.locator('.top-menu>button').click();await page.getByRole('navigation',{name:'主菜单',exact:true}).getByRole('button',{name:'声音管理',exact:true}).click();await page.getByRole('button',{name:'设计新音色',exact:true}).click();
   const restore=page.getByRole('button',{name:'恢复这份试听的输入',exact:true});await restore.evaluate(n=>n.scrollIntoView({block:'center',behavior:'instant'}));
   const window=JSON.parse(run('python',['scripts/show-voice-validation-window.py','--handle',String(handle)]));
   const file=run('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File','C:/Users/DELL/.codex/skills/screenshot/scripts/take_screenshot.ps1','-Mode','temp','-WindowHandle',String(handle)]);
   assert(fs.existsSync(file));images.push({width,height,fontSize,file,window,visualInspected:false});
  }
 }finally{
  run('python',['scripts/resize-desktop.py','--handle',String(handle),'--width','1400','--height','1000']);await call('saveAppearance',{fontSize:prior});await page.reload();await browser.close();
 }
 fs.writeFileSync(target,JSON.stringify({at:new Date().toISOString(),images,tool:'screenshot skill Windows helper',captureMethod:'CopyFromScreen of explicitly located source window',visualInspected:false},null,2),{flag:'wx'});
 console.log(JSON.stringify({images}));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
