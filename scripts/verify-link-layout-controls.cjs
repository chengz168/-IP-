const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const {chromium}=require('C:/Users/DELL/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core');
const directory=path.resolve('evidence/validation/local-link-extraction');
async function main(){
 const browser=await chromium.connectOverCDP('http://127.0.0.1:9346'),page=browser.contexts()[0].pages()[0],errors=[],states=[];page.on('pageerror',error=>errors.push(error.message));
 const initial=await page.evaluate(()=>window.studio.invoke('state'));
 const labels={compact:'紧凑',standard:'标准',comfortable:'舒适',large:'大'};
 const setFont=async id=>{await page.getByRole('button',{name:'常规设置',exact:true}).click();await page.getByRole('group',{name:'界面字号',exact:true}).getByRole('button',{name:labels[id],exact:true}).click();await page.waitForFunction(id=>document.querySelector('.app').dataset.size===id,id);await page.getByRole('button',{name:'模型设置',exact:true}).click();};
 const launch=JSON.parse(fs.readFileSync(path.join(directory,'relaunch.json'),'utf8'));
 const handle=Number(spawnSync('python',['scripts/desktop-handle.py','--pid',String(launch.pid)],{encoding:'utf8'}).stdout.trim());assert(handle);
 const resize=(width,height)=>{assert.equal(spawnSync('python',['scripts/resize-desktop.py','--handle',String(handle),'--width',String(width),'--height',String(height)]).status,0);};
 try{
  for(const [width,height]of [[1400,1000],[1100,760]]){
   resize(width,height);await page.waitForFunction(width=>innerWidth===width,width);
   for(const fontSize of Object.keys(labels)){
    await setFont(fontSize);await page.getByRole('button',{name:'保存并检查链接解析器',exact:true}).scrollIntoViewIfNeeded();
    await page.evaluate(async()=>{await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
    const result=await page.locator('.link-extract-settings').evaluate(node=>{const issues=[];for(const field of node.querySelectorAll('input,select,button')){const bounds=field.getBoundingClientRect();if(bounds.left<0||bounds.right>innerWidth+1)issues.push('控件横向越界');if(field.scrollWidth>field.clientWidth+2&&field.tagName!=='INPUT')issues.push('控件文字溢出');}if(node.scrollWidth>node.clientWidth+2)issues.push('区域横向溢出');return {width:innerWidth,height:innerHeight,fontSize:document.querySelector('.app').dataset.size,issues};});
    states.push(result);assert.deepEqual(result.issues,[]);await page.screenshot({path:path.join(directory,`settings-${width}-${fontSize}.png`)});
   }
  }
  assert.deepEqual(errors,[]);
 }finally{
  await setFont(initial.settings.fontSize);resize(1400,1000);
  const oldReport=path.join(directory,'layout.json'),backup=path.join(directory,'layout-api-refresh-timeout.json');if(fs.existsSync(oldReport)&&!fs.existsSync(backup))fs.copyFileSync(oldReport,backup);
  fs.writeFileSync(oldReport,JSON.stringify({at:new Date().toISOString(),states,pageErrors:errors,actualFontButtons:true,previousFailure:'旧脚本直接IPC保存字号后没有触发前端刷新；改用真实字号按钮。'},null,2));await browser.close();
 }
 console.log(JSON.stringify({states:states.length,actualFontButtons:true,pageErrors:errors}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
