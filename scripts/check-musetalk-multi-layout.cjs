// 多尺寸检查现有镜头编辑器与新说明；直接捕获渲染表面，不争夺前台窗口。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const {chromium}=require('C:/Users/DELL/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core');
const root=path.resolve('evidence/validation/musetalk-multi-20261115');
function python(args){const r=spawnSync('python',args,{encoding:'utf8',windowsHide:true});assert.equal(r.status,0,r.stderr);return r.stdout.trim();}
async function main(){
 const file=path.join(root,'layouts.json');assert(!fs.existsSync(file),'已有布局记录');
 const launch=JSON.parse(fs.readFileSync(path.join(root,'desktop-relaunch.json'),'utf8')),handle=Number(python(['scripts/desktop-handle.py','--pid',String(launch.pid)]));assert(handle);
 const browser=await chromium.connectOverCDP('http://127.0.0.1:9351'),page=browser.contexts()[0].pages()[0],cdp=await page.context().newCDPSession(page),layouts=[],images=[],errors=[];
 page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));const call=(action,payload={})=>page.evaluate(({action,payload})=>window.studio.invoke(action,payload),{action,payload});
 const prior=(await call('state')).settings.fontSize;
 try{
  for(const [width,height]of [[1400,1000],[1100,760]])for(const fontSize of ['compact','standard','comfortable','large']){
   python(['scripts/resize-desktop.py','--handle',String(handle),'--width',String(width),'--height',String(height)]);await call('saveAppearance',{fontSize});await page.reload();await page.locator('.video-config').waitFor();
   const geometry=await page.locator('.video-columns').evaluate(node=>{
    const issues=[],cards=[...node.children].map(el=>el.getBoundingClientRect().toJSON()),config=node.querySelector('.video-config'),button=config.querySelector('button.primary'),r=button.getBoundingClientRect(),b=config.getBoundingClientRect();
    if(config.scrollWidth>config.clientWidth+2)issues.push('视频卡片横向溢出');if(Math.abs(cards[0].top-cards[1].top)>1||Math.abs(cards[0].bottom-cards[1].bottom)>1)issues.push('两列顶部或底部未对齐');
    if(r.left<b.left||r.right>b.right||r.bottom>b.bottom+1)issues.push('生成按钮超出卡片');
    const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);if(!button.contains(hit))issues.push('生成按钮被遮挡');
    return {cards,button:r.toJSON(),issues};
   });assert.deepEqual(geometry.issues,[]);
   await page.getByRole('button',{name:'编辑镜头',exact:true}).click();const dialog=page.getByRole('dialog',{name:'配置多镜头',exact:true});await dialog.waitFor();
   const editor=await dialog.evaluate(node=>{
    const issues=[],box=node.getBoundingClientRect(),rows=[...node.querySelectorAll('.shot-row')].map(row=>({box:row.getBoundingClientRect().toJSON(),select:row.querySelector('[role=combobox]').getBoundingClientRect().toJSON(),input:row.querySelector('input').getBoundingClientRect().toJSON()})),footer=node.querySelector('footer')||node.querySelector('.modal-footer');
    if(node.scrollWidth>node.clientWidth+2)issues.push('镜头弹窗横向溢出');if(box.left<0||box.right>innerWidth+1||box.top<0||box.bottom>innerHeight+1)issues.push('镜头弹窗越界');
    if(rows.length!==2)issues.push('镜头配置行丢失');if(Math.abs(rows[0].select.left-rows[1].select.left)>1||Math.abs(rows[0].input.left-rows[1].input.left)>1)issues.push('镜头输入未对齐');if(rows[1].box.top-rows[0].box.bottom<8)issues.push('镜头行间距不足');
    for(const button of node.querySelectorAll('button')){if(button.disabled)continue;const r=button.getBoundingClientRect();if(r.width&&r.height){const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);if(!button.contains(hit))issues.push('按钮被遮挡：'+(button.getAttribute('aria-label')||button.textContent));}}
    return {box:box.toJSON(),rows,footer:footer?.getBoundingClientRect().toJSON(),issues};
   });assert.deepEqual(editor.issues,[]);
   if((width===1400&&fontSize==='comfortable')||(width===1100&&fontSize==='large')){
    let timer;const capture=await Promise.race([cdp.send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('渲染表面截图超时')),8000);})]).finally(()=>clearTimeout(timer));
    const image=path.join(root,'layout-'+width+'-'+fontSize+'.png');fs.writeFileSync(image,Buffer.from(capture.data,'base64'),{flag:'wx'});images.push(image);
   }
   await dialog.getByRole('button',{name:'取消',exact:true}).click();layouts.push({width,height,fontSize,geometry,editor});
  }
  assert.deepEqual(errors,[]);fs.writeFileSync(file,JSON.stringify({at:new Date().toISOString(),states:layouts.length,layouts,images,pageErrors:errors,pixelParityAccepted:false,visualInspected:false},null,2),{flag:'wx'});console.log(JSON.stringify({states:layouts.length,images,pageErrors:errors}));
 }catch(error){fs.writeFileSync(path.join(root,'layout-error-'+Date.now()+'.json'),JSON.stringify({error:error.stack,layouts,pageErrors:errors},null,2),{flag:'wx'});throw error;}
 finally{python(['scripts/resize-desktop.py','--handle',String(handle),'--width','1400','--height','1000']);await call('saveAppearance',{fontSize:prior});await page.reload();await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
