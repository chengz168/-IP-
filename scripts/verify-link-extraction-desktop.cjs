const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const {chromium}=require('C:/Users/DELL/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core');
const directory=path.resolve('evidence/validation/local-link-extraction'),mode=process.argv[2]||'generate';
const write=(name,value)=>fs.writeFileSync(path.join(directory,name),JSON.stringify(value,null,2));
async function main(){
 const browser=await chromium.connectOverCDP('http://127.0.0.1:9346'),page=browser.contexts()[0].pages()[0],pageErrors=[];page.on('pageerror',e=>pageErrors.push(e.message));
 const call=(action,payload)=>page.evaluate(({action,payload})=>window.studio.invoke(action,payload),{action,payload});
 const menu=async label=>{await page.getByRole('button',{name:'菜单',exact:true}).click();await page.getByRole('button',{name:label,exact:true}).click();};
 const runIds=async()=>new Set((await call('state')).runs.map(run=>run.id));
 const waitDone=async before=>{await page.waitForFunction(async ids=>{const run=(await window.studio.invoke('state')).runs.find(run=>!ids.includes(run.id));return run&&!['running','queued'].includes(run.status);},[...before],{timeout:120000,polling:500});await page.waitForFunction(()=>!document.querySelector('.operation-status'),null,{timeout:10000});};
 try{
  const state=await call('state');
  if(mode==='generate'||mode==='continue-new'){
   if(mode==='generate')assert.equal(state.runs.length,0,'已有运行，不重复生成');
   if(mode==='continue-new'){await menu('新工作流');await page.getByRole('button',{name:'开始新任务',exact:true}).click();await page.getByRole('textbox',{name:'视频链接',exact:true}).fill('分享音轨 http://127.0.0.1:18196/normal.wav。复制打开');}
   await menu('设置');await page.getByRole('button',{name:'模型设置',exact:true}).click();await page.getByRole('button',{name:'保存并检查链接解析器',exact:true}).click();await page.getByRole('heading',{name:'本地链接解析器可用',exact:true}).waitFor();assert((await page.locator('.dialog-message').textContent()).includes('2026.10.26'));await page.getByRole('button',{name:'知道了',exact:true}).click();
   await menu('新工作流');const before=await runIds();await page.getByRole('button',{name:'提取文案',exact:true}).last().click();await waitDone(before);
   const after=await call('state'),run=after.runs[0];assert.equal(run.status,'succeeded',run.error);assert(run.output.linkSource);assert.equal(run.output.linkSource.version,'2026.10.26');assert(run.output.engine==='faster-whisper'&&run.output.local===true);assert(run.output.text.includes('今天'));
   await page.waitForFunction(text=>document.querySelector('textarea[aria-label="原文案"]')?.value===text,run.output.text);
   await page.waitForFunction(async text=>(await window.studio.invoke('state')).drafts[0].sourceText===text,run.output.text,{timeout:10000});await page.reload();await page.waitForFunction(text=>document.querySelector('textarea[aria-label="原文案"]')?.value===text,run.output.text);
   write('new-workflow.json',{at:new Date().toISOString(),run,realYtDlp:true,realLocalAsr:true,fixtureMediaHttp:true,publicPlatformVerified:false,refreshRetainsText:true,pageErrors});await page.screenshot({path:path.join(directory,'new-workflow-result.png')});console.log(JSON.stringify({runId:run.id,status:run.status,text:run.output.text,sourceAssetId:run.output.sourceAssetId,pageErrors}));return;
  }
  if(mode==='legacy'){
   await menu('旧工作流');await page.locator('.legacy-card-body input[placeholder="输入视频分享链接"]').fill('旧版分享 http://127.0.0.1:18196/normal.wav。');const before=await runIds();await page.getByRole('button',{name:'提取文案',exact:true}).last().click();await waitDone(before);
   const after=await call('state'),run=after.runs[0];assert.equal(run.status,'succeeded',run.error);assert(run.output.local);await page.waitForFunction(async text=>(await window.studio.invoke('state')).drafts[0].sourceText===text,run.output.text,{timeout:10000});
   write('legacy-workflow.json',{at:new Date().toISOString(),run,realYtDlp:true,realLocalAsr:true,fixtureMediaHttp:true,publicPlatformVerified:false,pageErrors});await page.screenshot({path:path.join(directory,'legacy-workflow-result.png')});console.log(JSON.stringify({runId:run.id,status:run.status,text:run.output.text,pageErrors}));return;
  }
  if(mode==='faults'){
   await menu('新工作流');const input=page.getByRole('textbox',{name:'视频链接',exact:true}),text=page.getByRole('textbox',{name:'原文案',exact:true});
   const before=(await call('state')).runs.length,assetCount=(await call('state')).assets.filter(a=>a.origin==='local-link-extract').length;await input.fill('没有有效网址');await page.getByRole('button',{name:'提取文案',exact:true}).last().click();await page.getByRole('status').filter({hasText:'没有识别到HTTP'}).waitFor();assert.equal((await call('state')).runs.length,before);
   await input.fill('http://127.0.0.1:18196/slow.wav');const beforeCancel=await runIds();await page.getByRole('button',{name:'提取文案',exact:true}).last().click();await page.waitForFunction(async()=>(await window.studio.invoke('state')).runs[0]?.status==='running');
   await page.getByRole('button',{name:'停止识别',exact:true}).click();await waitDone(beforeCancel);const cancelled=(await call('state')).runs[0];assert.equal(cancelled.status,'cancelled');assert.equal(cancelled.output,undefined);
   await input.fill('http://127.0.0.1:18196/delayed.wav');const beforeChanged=await runIds();await page.getByRole('button',{name:'提取文案',exact:true}).last().click();await page.waitForFunction(async()=>(await window.studio.invoke('state')).runs[0]?.status==='running');await text.fill('识别期间的新手写内容，必须保留。');await waitDone(beforeChanged);const changed=(await call('state')).runs[0];assert.equal(changed.status,'succeeded',changed.error);assert.equal(await text.inputValue(),'识别期间的新手写内容，必须保留。');
   const assets=(await call('state')).assets.filter(a=>a.origin==='local-link-extract');assert.equal(assets.length,assetCount+1);assert.equal(fs.readdirSync(path.join(directory,'workspace/outputs')).filter(x=>x.startsWith('.link-input-')).length,0);
   write('faults.json',{at:new Date().toISOString(),invalidInputNoRun:true,cancelled,lateResultRetainedInRun:changed.id,editedTextPreserved:true,downloadAssets:assets.map(a=>a.id),pageErrors});console.log(JSON.stringify({invalidInputNoRun:true,cancelled:cancelled.status,editedTextPreserved:true,pageErrors}));return;
  }
  if(mode==='layout'){
   await menu('设置');await page.getByRole('button',{name:'模型设置',exact:true}).click();
   const launch=JSON.parse(fs.readFileSync(path.join(directory,fs.existsSync(path.join(directory,'relaunch.json'))?'relaunch.json':'launch.json'),'utf8')),handle=Number(spawnSync('python',['scripts/desktop-handle.py','--pid',String(launch.pid)],{encoding:'utf8'}).stdout.trim());assert(handle);assert.equal(spawnSync('python',['-c','import ctypes,sys;ctypes.windll.user32.ShowWindow(int(sys.argv[1]),9)',String(handle)]).status,0);
   const states=[];
   try{for(const [width,height]of [[1400,1000],[1100,760]]){assert.equal(spawnSync('python',['scripts/resize-desktop.py','--handle',String(handle),'--width',String(width),'--height',String(height)]).status,0);await page.waitForFunction(w=>innerWidth===w,width);for(const fontSize of ['compact','standard','comfortable','large']){await call('saveAppearance',{fontSize});await page.waitForFunction(s=>document.querySelector('.app').dataset.size===s,fontSize);await page.getByRole('button',{name:'保存并检查链接解析器',exact:true}).scrollIntoViewIfNeeded();await page.evaluate(async()=>{await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});const result=await page.locator('.link-extract-settings').evaluate(node=>{const issues=[];for(const field of node.querySelectorAll('input,select,button')){const r=field.getBoundingClientRect();if(r.left<0||r.right>innerWidth+1)issues.push('控件横向越界');if(field.scrollWidth>field.clientWidth+2&&field.tagName!=='INPUT')issues.push('控件文字溢出');}if(node.scrollWidth>node.clientWidth+2)issues.push('设置区域横向溢出');return {width:innerWidth,height:innerHeight,fontSize:document.querySelector('.app').dataset.size,issues};});states.push(result);assert.deepEqual(result.issues,[]);await page.screenshot({path:path.join(directory,`settings-${width}-${fontSize}.png`)});}}}finally{await call('saveAppearance',{fontSize:state.settings.fontSize});write('layout.json',{at:new Date().toISOString(),states,pageErrors});}
   console.log(JSON.stringify({states:states.length,pageErrors}));return;
  }
  throw Error('未知验收模式');
 }finally{await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
