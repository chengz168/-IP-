const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const {chromium}=require('C:/Users/DELL/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core');
const directory=path.resolve('evidence/validation/indextts-generation'),read=file=>JSON.parse(fs.readFileSync(path.join(directory,file),'utf8'));
async function main(){
 const launch=read('launch.json'),browser=await chromium.connectOverCDP('http://127.0.0.1:9342'),page=browser.contexts()[0].pages()[0];
 const call=(action,payload)=>page.evaluate(({action,payload})=>window.studio.invoke(action,payload),{action,payload});
 const before=await call('state'),report={at:new Date().toISOString(),states:[],pageErrors:[],referencePixelParityAccepted:false};
 assert(!before.runs.some(run=>['running','queued','cancelling'].includes(run.status)));
 page.on('pageerror',error=>report.pageErrors.push(error.message));
 const handle=Number(spawnSync('python',['scripts/desktop-handle.py','--pid',String(launch.pid)],{encoding:'utf8'}).stdout.trim());assert(handle);
 assert.equal(spawnSync('python',['-c','import ctypes,sys;ctypes.windll.user32.ShowWindow(int(sys.argv[1]),9)',String(handle)]).status,0);
 const resize=(width,height)=>assert.equal(spawnSync('python',['scripts/resize-desktop.py','--handle',String(handle),'--width',String(width),'--height',String(height)]).status,0);
 async function menu(name){await page.getByRole('button',{name:'菜单',exact:true}).click();await page.getByRole('navigation',{name:'主菜单'}).getByRole('button',{name,exact:true}).click();}
 async function capture(width,size,label){
  await page.evaluate(async()=>{await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
  const metrics=await page.evaluate(()=>{
   const issues=[],visible=node=>node.getClientRects().length&&getComputedStyle(node).visibility!=='hidden';
   for(const node of [...document.querySelectorAll('.voice-studio,.voice-copy,.voice-config,.audio-result,.voice-advanced-grid,.voice-upload-modal,.voice-upload-grid,.voice-upload-form,.voice-upload-source,.voice-sample-notice')].filter(visible)){
    if(node.scrollWidth>node.clientWidth+2)issues.push(node.className+'横向溢出');
   }
   const modal=document.querySelector('.voice-upload-modal');
   if(modal){
    const rect=modal.getBoundingClientRect();if(rect.left<0||rect.right>innerWidth||rect.top<0||rect.bottom>innerHeight)issues.push('上传弹窗超出视口');
    for(const selector of ['.voice-sample-save','header>.icon-button']){const node=modal.querySelector(selector),r=node.getBoundingClientRect();if(!node.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)))issues.push(selector+'不可点击');}
   }
   const choice=document.querySelector('.voice-choice-row');if(choice){const rects=[...choice.children].map(node=>node.getBoundingClientRect());if(Math.abs(rects[0].top-rects[1].top)>1||Math.abs(rects[0].height-rects[1].height)>1)issues.push('声音选择与试听按钮未对齐');}
   if(document.documentElement.scrollWidth>innerWidth)issues.push('窗口横向溢出');
   return {width:innerWidth,height:innerHeight,fontSize:document.querySelector('.app').dataset.size,issues,notice:document.querySelector('.voice-sample-notice')?.textContent||''};
  });
  report.states.push({size,label,...metrics});fs.writeFileSync(path.join(directory,'layout-report.json'),JSON.stringify(report,null,2));
  await page.screenshot({path:path.join(directory,'layout-'+width+'-'+size+'-'+label+'.png')});assert.deepEqual(metrics.issues,[]);
  if(label==='upload')assert(metrics.notice.includes('无需为每个声音单独训练'));
 }
 try{
  for(const [width,height]of [[1400,1000],[1100,760]]){
   resize(width,height);await page.waitForFunction(width=>innerWidth===width,width);
   for(const [size,label]of Object.entries({compact:'紧凑',standard:'标准',comfortable:'舒适',large:'大'})){
    await menu('设置');await page.getByRole('button',{name:'常规设置',exact:true}).click();
    await page.getByRole('group',{name:'界面字号',exact:true}).getByRole('button',{name:label,exact:true}).click();await page.waitForFunction(size=>document.querySelector('.app').dataset.size===size,size);
    await menu('新工作流');await page.locator('.steps>button').nth(2).click();await page.locator('.voice-config').waitFor();
    const toggle=page.getByRole('button',{name:'高级设置',exact:true});if(await toggle.getAttribute('aria-expanded')!=='true')await toggle.click();
    await page.locator('.stage-2').evaluate(node=>node.scrollTop=0);await capture(width,size,'advanced');
    await page.getByRole('button',{name:'上传声音',exact:true}).click();await page.getByRole('dialog',{name:'上传声音',exact:true}).waitFor();await capture(width,size,'upload');
    await page.getByRole('button',{name:'关闭弹窗',exact:true}).click();
   }
  }
  assert.deepEqual(report.pageErrors,[]);report.layoutChecksPassed=true;
 }catch(error){report.error=error.stack;throw error;}
 finally{
  const modal=page.getByRole('dialog',{name:'上传声音',exact:true});if(await modal.count())await page.getByRole('button',{name:'关闭弹窗',exact:true}).click();
  await call('saveAppearance',{fontSize:before.settings.fontSize});await page.reload();resize(1400,1000);
  const after=await call('state');assert.deepEqual(after.drafts,before.drafts);assert.deepEqual(after.runs,before.runs);assert.deepEqual(after.settings.provider,before.settings.provider);
  report.noNewInference=true;report.draftsAndProviderPreserved=true;fs.writeFileSync(path.join(directory,'layout-report.json'),JSON.stringify(report,null,2));await browser.close();
 }
 console.log(JSON.stringify({states:report.states.length,layoutChecksPassed:report.layoutChecksPassed,pageErrors:report.pageErrors}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
