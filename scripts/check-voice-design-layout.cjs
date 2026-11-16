const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const {chromium}=require('C:/Users/DELL/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core');
const base=path.resolve('evidence/validation/voice-design-20261115'),recovery=process.argv.includes('--candidate-recovery'),geometryOnly=process.argv.includes('--geometry-only'),root=recovery?path.join(base,'candidate-recovery'):base;
async function main(){
 const browser=await chromium.connectOverCDP('http://127.0.0.1:9351'),page=browser.contexts()[0].pages()[0],launch=JSON.parse(fs.readFileSync(path.join(base,'desktop-relaunch.json'),'utf8')),errors=[],states=[];
 page.on('pageerror',error=>errors.push(error.message));
 const cdp=recovery?await page.context().newCDPSession(page):null;
 // 原生窗口偶发停在Playwright截图等待；恢复批直接捕获已有视口，不依赖截图动画等待。
 const capture=async file=>{if(geometryOnly)return;if(!recovery)return page.screenshot({path:file});const directory=path.join(root,'cdp-captures');fs.mkdirSync(directory,{recursive:true});const result=await cdp.send('Page.captureScreenshot',{format:'png',fromSurface:false,captureBeyondViewport:false});fs.writeFileSync(path.join(directory,path.basename(file)),Buffer.from(result.data,'base64'),{flag:'wx'});};
 const handle=Number(spawnSync('python',['scripts/desktop-handle.py','--pid',String(launch.pid)],{encoding:'utf8',windowsHide:true}).stdout.trim());assert(handle);
 const resize=(width,height)=>{const result=spawnSync('python',['scripts/resize-desktop.py','--handle',String(handle),'--width',String(width),'--height',String(height)],{encoding:'utf8',windowsHide:true});assert.equal(result.status,0,result.stderr);};
 const menu=async name=>{await page.locator('.top-menu>button').click();await page.getByRole('navigation',{name:'主菜单',exact:true}).getByRole('button',{name,exact:true}).click();};
 try{
  if(await page.getByRole('dialog',{name:'设计新音色',exact:true}).count())await page.getByRole('button',{name:'关闭',exact:true}).click();
  for(const [width,height] of [[1400,1000],[1100,760]]){
   resize(width,height);await page.waitForFunction(width=>innerWidth===width,width);
   for(const fontSize of ['compact','standard','comfortable','large']){
    await page.evaluate(fontSize=>window.studio.invoke('saveAppearance',{fontSize}),fontSize);await page.reload();await page.locator('.app main').waitFor();await menu('声音管理');
    const entry=page.getByRole('button',{name:'设计新音色',exact:true});await entry.scrollIntoViewIfNeeded();
    const header=await entry.evaluate(node=>{const panel=node.parentElement,r=panel.getBoundingClientRect(),button=node.getBoundingClientRect(),text=panel.querySelector('h3').parentElement.getBoundingClientRect();return {button:button.toJSON(),panel:r.toJSON(),gap:button.left-text.right,inside:button.right<=r.right&&button.left>=r.left};});assert(header.inside&&header.gap>=8);
    await entry.click();await page.getByRole('dialog',{name:'设计新音色',exact:true}).waitFor();
    const modal=await page.locator('.voice-design-modal').evaluate(node=>{
     const r=node.getBoundingClientRect(),issues=[],body=node.querySelector('.modal-body'),inputs=[...node.querySelectorAll('.voice-design-fields input,.voice-design-fields textarea')].map(node=>node.getBoundingClientRect().toJSON()),buttons=[...node.querySelectorAll('footer button')];
     if(r.left<0||r.right>innerWidth||r.top<0||r.bottom>innerHeight)issues.push('弹窗越界');if(body.scrollWidth>body.clientWidth+2)issues.push('正文横向溢出');
     for(const b of inputs){if(Math.abs(b.left-inputs[0].left)>1||Math.abs(b.right-inputs[0].right)>1)issues.push('输入框未对齐');}
     for(const button of buttons){const b=button.getBoundingClientRect(),center=document.elementFromPoint(b.left+b.width/2,b.top+b.height/2);if(!button.contains(center))issues.push('页脚按钮被遮挡');}
     const labels=[...node.querySelectorAll('.voice-design-fields label')].map(node=>node.getBoundingClientRect().toJSON());for(let i=1;i<labels.length;i++)if(labels[i].top-labels[i-1].bottom<8)issues.push('字段间距不足');
     return {rect:r.toJSON(),inputs,issues};
    });assert.deepEqual(modal.issues,[]);await capture(path.join(root,`voice-design-layout-${width}-${fontSize}.png`));
    await page.getByRole('button',{name:'温暖从容',exact:true}).click();assert((await page.locator('#design-voice-description').inputValue()).includes('温暖圆润'));
    await page.getByRole('button',{name:'保存到声音库',exact:true}).isDisabled().then(value=>assert(value));
    let candidateRecovery;
    if(recovery){
     const restore=page.getByRole('button',{name:'恢复这份试听的输入',exact:true});if(geometryOnly)await restore.evaluate(node=>node.scrollIntoView({block:'center',behavior:'instant'}));else await restore.scrollIntoViewIfNeeded();
     candidateRecovery=await restore.evaluate(node=>{const r=node.getBoundingClientRect(),center=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return {rect:r.toJSON(),clickable:node.contains(center),width:innerWidth};});assert(candidateRecovery.clickable);
     await capture(path.join(root,`voice-design-recovery-${width}-${fontSize}.png`));await restore.click();assert(await page.getByRole('button',{name:'保存到声音库',exact:true}).isDisabled());
    }
    await page.keyboard.press('Escape');await page.getByRole('dialog',{name:'设计新音色',exact:true}).waitFor({state:'detached'});states.push({width,height,fontSize,header,modal,candidateRecovery});
   }
  }
  resize(1400,1000);await page.evaluate(()=>window.studio.invoke('saveAppearance',{fontSize:'comfortable'}));await page.reload();await page.locator('.app main').waitFor();assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(root,recovery?'layouts.json':'voice-design-layouts.json'),JSON.stringify({at:new Date().toISOString(),states,pageErrors:errors,geometryOnly,screenshotsVerified:false,pixelParityAccepted:false},null,2),recovery?{flag:'wx'}:undefined);console.log(JSON.stringify({states:states.length,pageErrors:errors,geometryOnly}));
 }catch(error){if(!recovery)await page.screenshot({path:path.join(root,'voice-design-layout-failure.png')});else{const file=path.join(root,'layout-error-'+Date.now()+'.json');fs.writeFileSync(file,JSON.stringify({at:new Date().toISOString(),error:error.stack,completedStates:states},null,2),{flag:'wx'});}throw error;}finally{await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
