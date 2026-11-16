const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const {chromium}=require('C:/Users/DELL/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core');
const root=path.resolve('evidence/validation/h3-multi-generation'),launch=JSON.parse(fs.readFileSync(path.join(root,'relaunch.json'),'utf8'));

async function main(){
 const browser=await chromium.connectOverCDP('http://127.0.0.1:9340'),page=browser.contexts()[0].pages()[0],report={at:new Date().toISOString(),states:[],pageErrors:[]};page.on('pageerror',error=>report.pageErrors.push(error.message));
 const call=(action,payload)=>page.evaluate(({action,payload})=>window.studio.invoke(action,payload),{action,payload}),before=await call('state'),fontSize=before.settings.fontSize;
 const handle=Number(spawnSync('python',['scripts/desktop-handle.py','--pid',String(launch.pid)],{encoding:'utf8'}).stdout.trim());assert(handle);
 // 最小化窗口只改变恢复矩形，无法触发实际渲染尺寸；先恢复明确PID的验收窗口。
 assert.equal(spawnSync('python',['-c','import ctypes,sys;ctypes.windll.user32.ShowWindow(int(sys.argv[1]),9)',String(handle)]).status,0);
 const resize=(width,height)=>{const result=spawnSync('python',['scripts/resize-desktop.py','--handle',String(handle),'--width',String(width),'--height',String(height)],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);};
 try{
  await page.locator('.video-config').waitFor();
  for(const [width,height]of [[1400,1000],[1100,760]]){
   resize(width,height);await page.waitForFunction(width=>innerWidth===width,width);
   for(const size of ['compact','standard','comfortable','large']){
    await call('saveAppearance',{fontSize:size});await page.waitForFunction(size=>document.querySelector('.app').dataset.size===size,size);
    await page.getByRole('button',{name:'生成视频',exact:true}).scrollIntoViewIfNeeded();
    await page.evaluate(async()=>{await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
    const state=await page.evaluate(()=>{
     const selectors=['.video-config','.video-config>.hint','.video-shot-summary','.video-audio','.video-model'],issues=[];
     for(const selector of selectors){const node=document.querySelector(selector);if(node&&node.scrollWidth>node.clientWidth+2)issues.push(selector+'横向溢出');}
     const button=[...document.querySelectorAll('.video-config button')].find(node=>node.textContent==='生成视频'),rect=button.getBoundingClientRect();
     if(rect.left<0||rect.right>innerWidth||rect.top<0||rect.bottom>innerHeight)issues.push('生成按钮不在视口内');
     return {width:innerWidth,height:innerHeight,fontSize:document.querySelector('.app').dataset.size,button:rect.toJSON(),issues};
    });
    report.states.push(state);assert.deepEqual(state.issues,[]);await page.screenshot({path:path.join(root,'layout-'+width+'-'+size+'.png')});
   }
  }
  assert.deepEqual(report.pageErrors,[]);report.layoutChecksPassed=true;report.referencePixelParityAccepted=false;
 }catch(error){report.error=error.stack;throw error;}
 finally{
  await call('saveAppearance',{fontSize});resize(1400,1000);await page.waitForFunction(size=>document.querySelector('.app').dataset.size===size,fontSize).catch(()=>{});
  const after=await call('state');assert.deepEqual(after.drafts[0].video,before.drafts[0].video);assert.deepEqual(after.settings.provider,before.settings.provider);
  fs.writeFileSync(path.join(root,'layout-report.json'),JSON.stringify(report,null,2));await browser.close();
 }
 console.log(JSON.stringify({states:report.states.length,layoutChecksPassed:report.layoutChecksPassed,pageErrors:report.pageErrors}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
