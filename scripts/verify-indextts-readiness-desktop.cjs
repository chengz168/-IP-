const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const {chromium}=require('C:/Users/DELL/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core');
const directory=path.resolve('evidence/validation/indextts-readiness'),launch=JSON.parse(fs.readFileSync(path.join(directory,'launch.json'),'utf8'));
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const write=(file,value)=>fs.writeFileSync(path.join(directory,file),JSON.stringify(value,null,2));

async function main(){
 const browser=await chromium.connectOverCDP('http://127.0.0.1:9341'),page=browser.contexts()[0].pages()[0];
 const report={at:new Date().toISOString(),states:[],pageErrors:[],inferencePerformed:false,qualityAccepted:false,referenceParityAccepted:false};
 page.on('pageerror',error=>report.pageErrors.push(error.message));
 const call=(action,payload)=>page.evaluate(({action,payload})=>window.studio.invoke(action,payload),{action,payload});
 const before=await call('state'),inspection=require('../server/local-indextts.cjs').inspectEnvironment(before.settings.provider);write('environment.json',inspection);
 const handle=Number(spawnSync('python',['scripts/desktop-handle.py','--pid',String(launch.pid)],{encoding:'utf8'}).stdout.trim());assert(handle);
 assert.equal(spawnSync('python',['-c','import ctypes,sys;ctypes.windll.user32.ShowWindow(int(sys.argv[1]),9)',String(handle)]).status,0);
 const resize=(w,h)=>assert.equal(spawnSync('python',['scripts/resize-desktop.py','--handle',String(handle),'--width',String(w),'--height',String(h)],{encoding:'utf8'}).status,0);
 try{
  await page.locator('.top-menu>button').click();await page.locator('.top-menu nav').getByRole('button',{name:'设置',exact:true}).click();
  await page.getByRole('button',{name:'模型设置',exact:true}).click();
  const check=page.getByRole('button',{name:'检查本地声音环境',exact:true});await check.scrollIntoViewIfNeeded();await check.click();
  const dialog=page.getByRole('dialog',{name:'本地声音环境尚未就绪',exact:true});await dialog.waitFor();
  report.message=await dialog.locator('.dialog-message').innerText();
  for(const name of inspection.missingModels)assert(report.message.includes(name),'真实弹窗应包含：'+name);
  assert(report.message.includes('尚未执行声音推理'));assert(report.message.includes('Torch / CUDA：尚未检查'));
  await dialog.getByRole('button',{name:'知道了',exact:true}).click();
  for(const [width,height]of [[1400,1000],[1100,760]]){
   resize(width,height);await page.waitForFunction(width=>innerWidth===width,width);
   for(const size of ['compact','standard','comfortable','large']){
    // 空闲页面不轮询状态，使用真实字号按钮触发页面刷新。
    await page.getByRole('button',{name:'常规设置',exact:true}).click();
    await page.getByRole('group',{name:'界面字号',exact:true}).getByRole('button',{name:{compact:'紧凑',standard:'标准',comfortable:'舒适',large:'大'}[size],exact:true}).click();
    await page.waitForFunction(size=>document.querySelector('.app').dataset.size===size,size);
    await page.getByRole('button',{name:'模型设置',exact:true}).click();await check.scrollIntoViewIfNeeded();await check.click();await dialog.waitFor();
    await page.evaluate(async()=>{await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
    const state=await dialog.evaluate(node=>{
     const body=node.querySelector('.modal-body'),footer=node.querySelector('footer'),rect=node.getBoundingClientRect(),issues=[];
     if(rect.left<0||rect.right>innerWidth||rect.top<0||rect.bottom>innerHeight)issues.push('弹窗超出视口');
     if(body.scrollWidth>body.clientWidth+2)issues.push('检查正文横向溢出');
     if(footer.getBoundingClientRect().bottom>innerHeight)issues.push('关闭按钮不可见');
     body.scrollTop=body.scrollHeight;
     return {width:innerWidth,height:innerHeight,fontSize:document.querySelector('.app').dataset.size,bodyScrollHeight:body.scrollHeight,bodyClientHeight:body.clientHeight,issues};
    });report.states.push(state);assert.deepEqual(state.issues,[]);
    await page.screenshot({path:path.join(directory,'dialog-'+width+'-'+size+'.png')});
    await dialog.getByRole('button',{name:'知道了',exact:true}).click();
   }
  }
  const h3=page.getByText('使用已有 H3 权重，支持单形象、长片分段和多镜头生成。',{exact:false});await h3.scrollIntoViewIfNeeded();
  assert((await h3.innerText()).includes('连续口型、听感和参考效果仍待验收'));
  await page.screenshot({path:path.join(directory,'h3-capability.png')});
  await page.reload();await page.locator('.app').waitFor();const after=await call('state');
  assert.deepEqual(after.settings.provider,before.settings.provider);assert.deepEqual(after.drafts,before.drafts);assert.deepEqual(after.runs,before.runs);
  report.providerPreservedAfterReload=true;report.noRunsCreated=true;report.buttonPassed=true;report.layoutChecksPassed=true;
  assert.deepEqual(report.pageErrors,[]);
 }catch(error){report.error=error.stack;throw error;}
 finally{
  await call('saveAppearance',{fontSize:before.settings.fontSize});await page.reload();resize(1400,1000);
  report.protectedFiles=launch.protectedFiles.map(item=>({...item,unchanged:hash(item.file)===item.sha256}));
  write('desktop-report.json',report);await browser.close();assert(report.protectedFiles.every(item=>item.unchanged));
 }
 console.log(JSON.stringify({states:report.states.length,buttonPassed:report.buttonPassed,layoutChecksPassed:report.layoutChecksPassed,protectedFilesUnchanged:true}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
