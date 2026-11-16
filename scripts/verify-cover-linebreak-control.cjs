// 用已有画布文字编辑功能排版同一标题，不暗改自动模板折行算法。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('C:/Users/DELL/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core');
const {digest}=require('../integrations/musetalk-local/input.cjs');
const {spawnSync}=require('node:child_process');
const root=path.resolve('evidence/validation/caption-cover-readability-20261115'),workspace=path.resolve('evidence/validation/musetalk-integration-20261115/workspace/studio.json');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8')),state=()=>read(workspace),load=name=>read(path.join(root,name));
const write=(name,value)=>fs.writeFileSync(path.join(root,name),JSON.stringify(value,null,2),{flag:'wx'});
async function main(){
 const resume=process.argv[2]==='resume',revision=process.argv[3]||'original';assert(/^[a-z0-9-]+$/.test(revision));assert(resume||!fs.existsSync(path.join(root,'manual-cover-intent.json')),'已有手工封面排版意图，不重复操作');assert(!fs.existsSync(path.join(root,'manual-cover.json')),'已有收据');
 const prepared=load('prepared.json'),before=state(),original=load('baseline.json');assert(!before.runs.some(r=>['running','queued','unknown'].includes(r.status)));
 const browser=await chromium.connectOverCDP('http://127.0.0.1:9351');let restoreBounds;
 try{
  const page=browser.contexts()[0].pages()[0],call=(action,payload={})=>page.evaluate(({action,payload})=>window.studio.invoke(action,payload),{action,payload});page.setDefaultTimeout(15000);
  await call('selectDraft',{id:prepared.draftId});await page.reload();await page.locator('.steps>button').nth(5).click({noWaitAfter:true});await page.getByLabel('封面编辑画布',{exact:true}).waitFor();
  if(!resume){
  write('manual-cover-intent.json',{at:new Date().toISOString(),draftId:prepared.draftId,returnDraftId:before.currentId,originalCover:state().drafts.find(d=>d.id===prepared.draftId).cover,change:'仅主标题加入手工换行，路边灯亮，\\n出来走走'});
  await page.getByRole('tab',{name:'文本图层',exact:true}).click({noWaitAfter:true});await page.getByRole('button',{name:'选择文字图层1',exact:true}).click({noWaitAfter:true});
  const stack=page.getByLabel('封面画布操作区',{exact:true});await stack.focus();await stack.press('Enter');await page.getByLabel('画布文字编辑',{exact:true}).fill('路边灯亮，\n出来走走');await page.getByLabel('画布文字编辑',{exact:true}).press('Control+Enter');
  await page.waitForFunction(()=>!document.querySelector('.cover-error')&&!document.querySelector('.cover-rendering'));
  const start=Date.now();while(Date.now()-start<10000&&state().drafts.find(d=>d.id===prepared.draftId).cover.scene.layers[0].text!=='路边灯亮，\n出来走走')await new Promise(r=>setTimeout(r,200));
  assert.equal(state().drafts.find(d=>d.id===prepared.draftId).cover.scene.layers[0].text,'路边灯亮，\n出来走走');
  await page.getByRole('button',{name:'生成封面',exact:true}).click({noWaitAfter:true});
  }
  let asset;await page.waitForFunction(()=>!document.querySelector('.cover-error'));
  for(let i=0;i<100;i++){const d=state().drafts.find(d=>d.id===prepared.draftId);if(d.cover.assetId){asset=state().assets.find(a=>a.id===d.cover.assetId);break;}await new Promise(r=>setTimeout(r,200));}assert(asset,'原封面生成尚未完成，不能重复点击');
  assert(asset.coverSignature.includes('\\n'));const target=path.join(root,'cover-manual-linebreak.jpg');if(resume)assert.equal(digest(target),digest(asset.path));else fs.copyFileSync(asset.path,target,fs.constants.COPYFILE_EXCL);
  const checks=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
  const launch=read('evidence/validation/local-full-workflow-20261115/desktop-relaunch-caption-cover.json');process.kill(launch.pid,0);
  const located=spawnSync('python',['scripts/desktop-handle.py','--pid',String(launch.pid)],{encoding:'utf8',windowsHide:true});assert.equal(located.status,0,located.stderr);const handle=Number(located.stdout.trim());assert(handle);
  const bounds=spawnSync('python',['-c','import ctypes,json; from ctypes import wintypes; u=ctypes.windll.user32; u.SetProcessDPIAware(); r=wintypes.RECT(); u.GetWindowRect('+handle+',ctypes.byref(r)); print(json.dumps([r.right-r.left,r.bottom-r.top]))'],{encoding:'utf8',windowsHide:true});assert.equal(bounds.status,0,bounds.stderr);const originalSize=JSON.parse(bounds.stdout);
  const resize=(width,height)=>{const r=spawnSync('python',['scripts/resize-desktop.py','--handle',String(handle),'--width',String(width),'--height',String(height)],{encoding:'utf8',windowsHide:true});assert.equal(r.status,0,r.stderr);};restoreBounds=()=>resize(...originalSize);
  for(const [width,height]of [[1400,1000],[1100,760]]){
   resize(width,height);await page.waitForFunction(w=>innerWidth===w,width);await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
   const geometry=await page.locator('.cover-editor-full').evaluate(el=>{const rect=node=>{const r=node.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}},area=rect(el),body=el.querySelector('.cover-option-body'),canvas=rect(el.querySelector('canvas')),issues=[];
    if(el.scrollWidth>el.clientWidth+1||body.scrollWidth>body.clientWidth+1)issues.push('封面控件横向溢出');
    const buttons=[];for(const button of document.querySelectorAll('.cover-bottom>button,.footer-actions>button')){const r=rect(button),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);buttons.push({text:button.innerText,disabled:button.disabled,rect:r,hit:hit?.outerHTML.slice(0,180),same:button.contains(hit)});if(r.y<0||r.bottom>innerHeight||!button.contains(hit))issues.push('底部按钮遮挡');}
    return{viewport:{width:innerWidth,height:innerHeight},area,canvas,buttons,issues};});checks.push(geometry);
   const session=await page.context().newCDPSession(page);try{const shot=await session.send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false});const shotFile=path.join(root,'manual-cover-'+width+'-'+revision+'.png');fs.writeFileSync(shotFile,Buffer.from(shot.data,'base64'),{flag:'wx'});}finally{await session.detach();}
   if(geometry.issues.length)write('geometry-failed-'+Date.now()+'.json',geometry);assert.deepEqual(geometry.issues,[]);
  }
  restoreBounds();restoreBounds=null;
  await page.reload();await page.getByLabel('封面编辑画布',{exact:true}).waitFor();assert.equal(state().drafts.find(d=>d.id===prepared.draftId).cover.assetId,asset.id);
  const after=state();for(const d of original.drafts)assert.deepEqual(after.drafts.find(x=>x.id===d.id),d);for(const key of ['settings','voices','publishRecords'])assert.deepEqual(after[key],original[key]);assert(original.protectedFiles.every(p=>digest(p.file)===p.sha256));
  const returnId=load('manual-cover-intent.json').returnDraftId;await call('selectDraft',{id:returnId});await page.reload();await page.locator('.app main').waitFor();
  write('manual-cover.json',{at:new Date().toISOString(),revision,draftId:prepared.draftId,file:target,sha256:digest(target),asset,actualTextLayerEditor:true,manualLinebreakOnly:true,autoTitleAlgorithmChanged:false,actualGenerateCoverButton:true,checks,refreshBinding:true,restoredDraftId:returnId,originalDraftsUnchanged:true,settingsUnchanged:true,protectedFilesUnchanged:original.protectedFiles.length,pageErrors:errors,referencePixelParityAccepted:false});console.log(JSON.stringify({file:target,checks,restored:returnId}));
 }finally{restoreBounds?.();await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
