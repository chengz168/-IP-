// 通过现有产品API与实际界面验证账号连接；不模拟平台登录，也不上传内容。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {chromium}=require('C:/Users/DELL/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core');
const root=path.resolve('evidence/validation/local-account-connection-20261116'),screens=path.resolve('output/playwright/local-account-20261116');
const storeFile=path.resolve('evidence/validation/musetalk-integration-20261115/workspace/studio.json');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8')),hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const write=(name,data)=>fs.writeFileSync(path.join(root,name),JSON.stringify(data,null,2),{flag:'wx'});
const data=()=>read(storeFile);
const calls=[];
async function invoke(page,action,payload={}){calls.push({action,payload});fs.appendFileSync(path.join(root,'calls.jsonl'),JSON.stringify({at:new Date().toISOString(),phase:'start',action,payload})+'\n');let timer;try{const result=await Promise.race([page.evaluate(({action,payload})=>window.studio.invoke(action,payload),{action,payload}),new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('产品操作等待超时：'+action)),20000))]);fs.appendFileSync(path.join(root,'calls.jsonl'),JSON.stringify({at:new Date().toISOString(),phase:'done',action})+'\n');return result;}finally{clearTimeout(timer);}}
async function capture(page,name){const session=await page.context().newCDPSession(page);const {data:base64}=await session.send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false});const file=path.join(screens,name+'.png');fs.writeFileSync(file,Buffer.from(base64,'base64'));await session.detach();return file;}
async function main(){
 fs.mkdirSync(root,{recursive:true});fs.mkdirSync(screens,{recursive:true});
 const mode=process.argv[2];const browser=await chromium.connectOverCDP('http://127.0.0.1:9351');
 try{
  const page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().includes('/dist/index.html'));assert(page,'未找到现有源码工作台');const state=await invoke(page,'state');assert(!state.runs.some(r=>['running','queued','unknown'].includes(r.status)),'仍有未完成任务');assert(!(state.workflowJobs||[]).some(j=>['running','queued','stopping'].includes(j.status)));
  if(mode==='baseline'){
   assert.equal(state.currentId,'3057d521-b49b-4d76-be0f-5bccb63a15b0');const before=data(),protectedFiles=read('evidence/validation/musetalk-integration-20261115/prepared.json').protectedFiles.map(f=>({file:f.file,sha256:hash(f.file)}));
   write('baseline.json',{at:new Date().toISOString(),currentId:before.currentId,drafts:before.drafts,accounts:before.accounts,settings:before.settings,voices:before.voices,publishRecords:before.publishRecords,protectedFiles});console.log(JSON.stringify({baseline:true,currentId:before.currentId,accounts:before.accounts.length,protectedFiles:protectedFiles.length}));return;
  }
  if(mode==='snapshot'){
   write('runtime.json',{at:new Date().toISOString(),url:page.url(),stateAccounts:state.accounts,body:(await page.locator('body').innerText()).slice(0,4500)});console.log(JSON.stringify({url:page.url(),body:(await page.locator('body').innerText()).slice(0,2200)}));return;
  }
  if(mode==='inspect'){console.log(JSON.stringify({accounts:state.accounts,pages:browser.contexts().flatMap(c=>c.pages()).map(p=>({url:p.url()}))}));return;}
  if(mode==='exercise'){
   assert(!fs.existsSync(path.join(root,'exercise.json')),'已有实际操作收据，不重复操作');
   const baseline=read(path.join(root,'baseline.json')),saved=fs.existsSync(path.join(root,'exercise-progress.json'))?read(path.join(root,'exercise-progress.json')):null;if(!saved)assert.deepEqual(data().accounts,baseline.accounts);
   await page.getByRole('button',{name:/菜单/}).click();await page.getByRole('button',{name:'账号管理',exact:true}).click();await page.getByRole('heading',{name:'账号管理',exact:true}).waitFor();
   const accountIds=saved?.accountIds||[],observations=saved?.observations||{},artifacts=saved?.artifacts||[];const progress={accountIds,observations,artifacts};
   const checkpoint=()=>fs.writeFileSync(path.join(root,'exercise-progress.json'),JSON.stringify(progress,null,2));
   for(let i=0;i<2;i++){
    if(accountIds[i])continue;
    await page.getByRole('button',{name:'添加账号',exact:true}).click();const modal=page.getByRole('dialog',{name:'添加账号',exact:true});await modal.waitFor();await modal.getByRole('textbox',{name:'账号名称',exact:true}).fill('连接验证'+(i+1));await modal.getByRole('textbox',{name:'显示名称',exact:true}).fill('隔离检查'+(i+1));if(i===0)artifacts.push(await capture(page,'account-add-modal'));await modal.getByRole('button',{name:'添加',exact:true}).click();await modal.waitFor({state:'hidden'});
    const account=(await invoke(page,'state')).accounts.find(a=>a.name==='连接验证'+(i+1));assert(account);accountIds.push(account.id);checkpoint();
    const card=page.locator('.resource-card').filter({has:page.getByRole('heading',{name:'隔离检查'+(i+1),exact:true})});await card.getByRole('button',{name:'登录',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.status-busy'));
    let result;for(let n=0;n<60;n++){try{result=await invoke(page,'checkAccountConnection',{accountId:account.id});break;}catch(error){if(!/正在检查/.test(error.message))throw error;await new Promise(r=>setTimeout(r,500));}}
    assert(result,'登录窗口打开后检查超时');assert.notEqual(result.connection.status,'connected','没有用户登录，不能标记已连接');observations[account.id]=result.connection;
    const pages=browser.contexts().flatMap(c=>c.pages()).filter(p=>p.url().startsWith('https://creator.douyin.com/'));const platformPage=pages.at(-1);assert(platformPage,'平台真实页面没有加载');await platformPage.waitForLoadState('domcontentloaded');
    observations[account.id].url=platformPage.url();observations[account.id].visibleText=(await platformPage.locator('body').innerText()).slice(0,3000);observations[account.id].preloadExposed=await platformPage.evaluate(()=>typeof window.studio!=='undefined');assert.equal(observations[account.id].preloadExposed,false);
    artifacts.push(await capture(platformPage,'platform-login-'+(i+1)));checkpoint();
   }
   for(const id of accountIds){const account=(await invoke(page,'state')).accounts.find(a=>a.id===id);if(account.platform!=='抖音')await invoke(page,'saveResource',{type:'account',item:{...account,platform:'抖音'}});await invoke(page,'openAccountLogin',{accountId:id});}
   const pagesBefore=browser.contexts().flatMap(c=>c.pages()).filter(p=>p.url().startsWith('https://creator.douyin.com/')).length;await invoke(page,'openAccountLogin',{accountId:accountIds[0]});const pagesAfter=browser.contexts().flatMap(c=>c.pages()).filter(p=>p.url().startsWith('https://creator.douyin.com/')).length;assert.equal(pagesAfter,pagesBefore);
   // 用非敏感探针验证会话隔离，只设置并删除验证键，不读取平台既有存储。
   const platformPages=browser.contexts().flatMap(c=>c.pages()).filter(p=>p.url().startsWith('https://creator.douyin.com/'));assert.equal(platformPages.length,2);const marker='studio_validation_'+crypto.randomUUID();await platformPages[0].evaluate(key=>localStorage.setItem(key,'isolation-test'),marker);const isolated=await platformPages[1].evaluate(key=>localStorage.getItem(key),marker);await platformPages[0].evaluate(key=>localStorage.removeItem(key),marker);assert.equal(isolated,null);
   await invoke(page,'closeAccountLogin',{accountId:accountIds[0]});await assert.rejects(invoke(page,'checkAccountConnection',{accountId:accountIds[0]}),/先打开|窗口已关闭/);assert.notEqual((await invoke(page,'state')).accounts.find(a=>a.id===accountIds[0]).connection.status,'connected');
   await invoke(page,'openAccountLogin',{accountId:accountIds[0]});assert.notEqual((await invoke(page,'checkAccountConnection',{accountId:accountIds[0]})).connection.status,'connected');
   for(const id of accountIds)await invoke(page,'closeAccountLogin',{accountId:id});
   const edited=(await invoke(page,'state')).accounts.find(a=>a.id===accountIds[1]);await invoke(page,'saveResource',{type:'account',item:{...edited,platform:'快手',status:'connected',connection:{status:'connected'}}});await assert.rejects(invoke(page,'openAccountLogin',{accountId:edited.id}),/尚未接入/);assert.equal((await invoke(page,'state')).accounts.find(a=>a.id===edited.id).connection.status,'unconnected');
   await page.reload();await page.getByRole('button',{name:/菜单/}).waitFor();await page.getByRole('button',{name:/菜单/}).click();await page.getByRole('button',{name:'账号管理',exact:true}).click();await page.getByRole('heading',{name:'账号管理',exact:true}).waitFor();artifacts.push(await capture(page,'accounts-after-reload'));assert((await invoke(page,'state')).accounts.filter(a=>accountIds.includes(a.id)).every(a=>a.connection.status!=='connected'));
   write('exercise.json',{at:new Date().toISOString(),...progress,realPlatformPages:true,actualFormButtons:true,duplicateWindowPrevented:true,nonSensitiveStorageIsolation:true,closeAndReopen:true,reloadNoFalseLogin:true,platformChangeInvalidated:true,loggedInVerified:false,uploadExecuted:false,calls});console.log(JSON.stringify({accountIds,observations,artifacts}));return;
  }
  if(mode==='layout'){
   assert(!fs.existsSync(path.join(root,'layout.json')),'已有布局验收，不重复');
   const launch=read('evidence/validation/local-full-workflow-20261115/desktop-relaunch-account-lifecycle.json');assert(Number.isSafeInteger(launch.pid));const handle=Number(execFileSync('powershell.exe',['-NoProfile','-Command',`[Console]::Write((Get-Process -Id ${launch.pid}).MainWindowHandle)`],{encoding:'utf8',windowsHide:true}).trim());assert(handle>0);
   const resize=async(width,height)=>{execFileSync('python',['scripts/resize-desktop.py','--handle',String(handle),'--width',String(width),'--height',String(height)],{windowsHide:true});await page.waitForFunction(({width,height})=>innerWidth===width&&innerHeight===height,{width,height});};
   const geometry=async(selector)=>page.locator(selector).evaluateAll(nodes=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,buttons:nodes.filter(n=>!n.disabled).map(n=>{const r=n.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return{text:(n.innerText||n.getAttribute('aria-label')||'').trim(),left:r.left,right:r.right,top:r.top,bottom:r.bottom,hitsSelf:hit===n||n.contains(hit)};})}));
   // 小窗口页面本来有内容滚动区，逐个真实滚动到按钮后再检查命中，不要求长表单同时可见。
   const reachable=async(selector)=>{const nodes=page.locator(selector),buttons=[];for(let i=0;i<await nodes.count();i++){const node=nodes.nth(i);if(await node.isDisabled())continue;await node.scrollIntoViewIfNeeded();buttons.push(await node.evaluate(n=>{const r=n.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return{text:(n.innerText||n.getAttribute('aria-label')||'').trim(),left:r.left,right:r.right,top:r.top,bottom:r.bottom,hitsSelf:hit===n||n.contains(hit)};}));}return{width:await page.evaluate(()=>innerWidth),scrollWidth:await page.evaluate(()=>document.documentElement.scrollWidth),sequentialScrollChecked:true,buttons};};
   const layouts=[],artifacts=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.getByRole('button',{name:/菜单/}).click();await page.getByRole('button',{name:'账号管理',exact:true}).click();
   for(const [width,height]of [[1400,1000],[1100,760]]){
    await resize(width,height);await page.getByRole('heading',{name:'账号管理',exact:true}).waitFor();let measured=await geometry('.accounts-page button');artifacts.push(await capture(page,'accounts-'+width));assert(measured.scrollWidth<=width);assert(measured.buttons.every(b=>b.hitsSelf),JSON.stringify(measured));layouts.push({kind:'accounts',...measured});
    await page.getByRole('button',{name:'添加账号',exact:true}).click();const modal=page.getByRole('dialog',{name:'添加账号',exact:true});await modal.waitFor();measured=await geometry('.modal button');artifacts.push(await capture(page,'account-modal-'+width));assert(measured.buttons.every(b=>b.hitsSelf),JSON.stringify(measured));layouts.push({kind:'account-modal',...measured});await modal.getByRole('button',{name:'取消',exact:true}).click();
   }
   const draftMarker=path.join(root,'test-draft.json'),generated=read('evidence/validation/voice-C-character-20261116/generated.json');let d;if(fs.existsSync(draftMarker)){const marker=read(draftMarker);d=(await invoke(page,'state')).drafts.find(v=>v.id===marker.id);assert(d,'隔离草稿已不存在，请先核对后恢复');await invoke(page,'selectDraft',{id:d.id});}else{d=await invoke(page,'newDraft');write('test-draft.json',{id:d.id});}d.step=6;d.title='账号与发布检查隔离验证';d.publish.videoId=generated.outputs.render.id;d.publish.coverId=generated.outputs.cover.id;d.publish.title='夜晚给自己留几分钟';await invoke(page,'saveDraft',d);await page.reload();await page.getByRole('button',{name:'立即发布',exact:true}).waitFor();
   for(const [width,height]of [[1400,1000],[1100,760]]){
    await resize(width,height);artifacts.push(await capture(page,'publish-top-'+width));const measured=await reachable('.publish-columns button');artifacts.push(await capture(page,'publish-scrolled-'+width));assert(measured.scrollWidth<=width);assert(measured.buttons.every(b=>b.hitsSelf),JSON.stringify(measured));assert(await page.locator('.publish-accounts input[type="checkbox"]').evaluateAll(nodes=>nodes.length===2&&nodes.every(n=>n.disabled)));layouts.push({kind:'publish',...measured});
   }
   await page.getByRole('button',{name:'立即发布',exact:true}).click();await page.getByText('请先选择发布账号',{exact:true}).waitFor();artifacts.push(await capture(page,'publish-no-account-rejected'));assert.equal(data().publishRecords.length,read(path.join(root,'baseline.json')).publishRecords.length);
   const current=(await invoke(page,'state')).drafts.find(v=>v.id===d.id),testAccount=read(path.join(root,'exercise-progress.json')).accountIds[0];current.publish.accountIds=[testAccount];await invoke(page,'saveDraft',current);await assert.rejects(invoke(page,'preparePublish',{id:d.id}),/先打开|窗口已关闭/);
   await resize(1400,1000);assert.deepEqual(errors,[]);write('layout.json',{at:new Date().toISOString(),layouts,artifacts,pageErrors:errors,actualPublishButton:true,noAccountRejected:true,unconnectedAccountRejected:true,unconnectedAccountsDisabled:true,successfulAuthenticatedPreflightVerified:false,pixelParityAccepted:false,calls});console.log(JSON.stringify({states:layouts.length,artifacts,pageErrors:errors}));return;
  }
  if(mode==='cleanup'){
   const baseline=read(path.join(root,'baseline.json')),progress=read(path.join(root,'exercise-progress.json'));
   for(const name of ['test-draft.json','test-draft-extra.json'])if(fs.existsSync(path.join(root,name))){const test=read(path.join(root,name));if((await invoke(page,'state')).drafts.some(d=>d.id===test.id))await invoke(page,'deleteDraft',{id:test.id});}
   for(const id of progress.accountIds){const current=await invoke(page,'state');if(current.accounts.some(a=>a.id===id)){await invoke(page,'closeAccountLogin',{accountId:id});await invoke(page,'deleteResource',{type:'account',id});}}
   await invoke(page,'selectDraft',{id:baseline.currentId});await page.reload();await page.locator('.app main').waitFor();const after=data();for(const key of ['currentId','drafts','accounts','settings','voices','publishRecords'])assert.deepEqual(after[key],baseline[key],key+'发生变化');assert(baseline.protectedFiles.every(f=>hash(f.file)===f.sha256));
   write('cleanup.json',{at:new Date().toISOString(),originalDraftRestored:true,originalDraftsUnchanged:true,accountsUnchanged:true,settingsUnchanged:true,voicesUnchanged:true,publishRecordsUnchanged:true,protectedFilesUnchanged:true,noUnsettledRuns:true,deletedTestAccountIds:progress.accountIds,calls});console.log(JSON.stringify({restored:true,protectedFiles:baseline.protectedFiles.length}));return;
  }
  throw Error('未知检查阶段');
 }finally{await browser.close();}
}
main().catch(error=>{fs.mkdirSync(root,{recursive:true});fs.appendFileSync(path.join(root,'errors.jsonl'),JSON.stringify({at:new Date().toISOString(),mode:process.argv[2],error:error.stack,calls})+'\n');console.error(error);process.exitCode=1;});
