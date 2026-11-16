const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const {chromium}=require('C:/Users/DELL/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core');
const directory=path.resolve('evidence/validation/musetalk-integration-20261115');
async function main(){
 const launch=JSON.parse(fs.readFileSync(path.join(directory,'launch.json'),'utf8')),browser=await chromium.connectOverCDP('http://127.0.0.1:9351'),page=browser.contexts()[0].pages()[0],layouts=[],errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 const call=(action,payload={})=>page.evaluate(({action,payload})=>window.studio.invoke(action,payload),{action,payload});
 const handle=Number(spawnSync('python',['scripts/desktop-handle.py','--pid',String(launch.pid)],{encoding:'utf8',windowsHide:true}).stdout.trim());assert(handle);
 const menu=async label=>{await page.locator('.top-menu>button').click();await page.getByRole('navigation',{name:'主菜单',exact:true}).getByRole('button',{name:label,exact:true}).click();};
 try{
  for(const [width,height]of [[1400,1000],[1100,760]]){
   const resize=spawnSync('python',['scripts/resize-desktop.py','--handle',String(handle),'--width',String(width),'--height',String(height)],{encoding:'utf8',windowsHide:true});assert.equal(resize.status,0,resize.stderr);await page.waitForFunction(w=>innerWidth===w,width);
   for(const font of ['compact','standard','comfortable','large']){
    await call('saveAppearance',{fontSize:font});await page.reload();await page.locator('.video-config').waitFor();
    const video=await page.locator('.video-config').evaluate(node=>{const issues=[],b=node.getBoundingClientRect(),fields=[...node.querySelectorAll('.video-config-fields>.video-field')].map(e=>e.getBoundingClientRect().toJSON()),button=node.querySelector('button.primary'),r=button.getBoundingClientRect();if(node.scrollWidth>node.clientWidth+2)issues.push('视频卡片横向溢出');for(let i=1;i<fields.length;i++){if(fields[i].top-fields[i-1].bottom<8)issues.push('字段间距不足');if(Math.abs(fields[i].left-fields[i-1].left)>1)issues.push('字段左侧未对齐');}if(r.left<b.left||r.right>b.right)issues.push('生成按钮越界');return {fields,card:b.toJSON(),button:r.toJSON(),issues};});assert.deepEqual(video.issues,[]);await page.screenshot({path:path.join(directory,`layout-video-${width}-${font}.png`)});
    await menu('设置');await page.getByRole('button',{name:'模型设置',exact:true}).click();await page.getByRole('textbox',{name:'本地口型环境路径',exact:true}).scrollIntoViewIfNeeded();
    const settings=await page.getByRole('textbox',{name:'本地口型环境路径',exact:true}).evaluate(input=>{const section=input.closest('.settings-form-section'),label=input.closest('label'),button=[...section.querySelectorAll('button')].find(n=>n.textContent==='检查本地口型环境'),select=section.querySelector('select'),b=section.getBoundingClientRect(),r=input.getBoundingClientRect(),l=label.getBoundingClientRect(),s=select.getBoundingClientRect(),c=button.getBoundingClientRect(),issues=[];if(section.scrollWidth>section.clientWidth+2)issues.push('本地设置区横向溢出');if(Math.abs(r.left-s.left)>1||Math.abs(r.right-s.right)>1)issues.push('目录与方式输入框未对齐');if(r.left<b.left||r.right>b.right)issues.push('目录输入越界');if(c.top-l.bottom<6)issues.push('检查按钮间距不足');if(button.scrollWidth>button.clientWidth+2)issues.push('检查按钮文字溢出');return {input:r.toJSON(),select:s.toJSON(),label:l.toJSON(),checkButton:c.toJSON(),issues};});assert.deepEqual(settings.issues,[]);await page.screenshot({path:path.join(directory,`layout-settings-${width}-${font}.png`)});
    layouts.push({width,height,font,video,settings});await menu('新工作流');
   }
  }
  await call('saveAppearance',{fontSize:'comfortable'});spawnSync('python',['scripts/resize-desktop.py','--handle',String(handle),'--width','1400','--height','1000'],{windowsHide:true});await page.reload();await page.locator('.video-config').waitFor();await page.screenshot({path:path.join(directory,'layout-final.png')});assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(directory,'layouts.json'),JSON.stringify({at:new Date().toISOString(),layouts,pageErrors:errors,states:layouts.length,qualityAccepted:false,referenceParityAccepted:false},null,2));console.log(JSON.stringify({states:layouts.length,pageErrors:errors}));
 }catch(error){fs.writeFileSync(path.join(directory,'layout-error-'+Date.now()+'.json'),JSON.stringify({error:error.stack,layouts,pageErrors:errors},null,2));await page.screenshot({path:path.join(directory,'layout-failure.png')});throw error;}
 finally{await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
