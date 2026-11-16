const fs=require('fs'),path=require('path'),assert=require('assert/strict'),crypto=require('crypto'),{spawn}=require('child_process');
const {Store,createDraft}=require('../server/store.cjs');
const {chromium}=require('C:/Users/DELL/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core');
const root=path.resolve('evidence/validation/video-shots'),original=path.resolve('evidence/validation/pip-desktop-workspace'),workspace=path.join(root,'desktop-workspace'),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
 assert(!fs.existsSync(workspace),'不覆盖已有隔离验收');fs.mkdirSync(root,{recursive:true});const baseline=JSON.parse(fs.readFileSync(path.join(original,'studio.json'),'utf8'));
 fs.writeFileSync(path.join(root,'original-baseline.json'),JSON.stringify(baseline,null,2));const browser=await chromium.connectOverCDP('http://127.0.0.1:9333'),page=browser.contexts()[0].pages()[0],current=await page.evaluate(()=>window.studio.invoke('state'));
 assert.equal(current.currentId,baseline.currentId);assert(!current.runs.some(run=>run.status==='running'));await page.evaluate(()=>window.studio.window('close'));await browser.close().catch(()=>{});
 for(let i=0;i<120;i++){try{await fetch('http://127.0.0.1:9333/json/version');await sleep(100);}catch{break;}}
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(original,'studio.json'),'utf8')),baseline);
 const data=structuredClone(baseline);data.runs=[];data.workflowJobs=[];data.settings.view='new';data.settings.outputDir=path.join(workspace,'outputs');fs.mkdirSync(workspace,{recursive:true});fs.writeFileSync(path.join(workspace,'studio.json'),JSON.stringify(data,null,2));
 const store=new Store(workspace),video=store.addAsset('D:/我的智能体/视频测试素材/收纳盒商品推广视频_19s.mp4',{name:'镜头界面验收视频.mp4'}),audio=store.addAsset(path.resolve('evidence/validation/local-speech-workspace/assets/dc44ba3f-af4b-4b8b-90e3-2d51473bdef8.wav'),{name:'已有真实系统配音.wav'});
 const avatars=[{id:crypto.randomUUID(),name:'验收形象一',assetId:video.id},{id:crypto.randomUUID(),name:'验收形象二',assetId:video.id}];store.data.avatars.push(...avatars);const draft=createDraft();draft.title='多镜头交互与布局验收';draft.step=3;draft.video.avatarId=avatars[0].id;store.data.drafts.unshift(draft);store.data.currentId=draft.id;store.save();
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.STUDIO_DEV_URL;
 const viteLog=fs.openSync(path.join(root,'vite.log'),'a');const vite=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5187','--strictPort'],{cwd:process.cwd(),env,detached:true,stdio:['ignore',viteLog,viteLog],windowsHide:true});vite.unref();
 for(let i=0;i<100;i++){try{const response=await fetch('http://127.0.0.1:5187');if(response.ok)break;}catch{}await sleep(100);}
 env.STUDIO_DEV_URL='http://127.0.0.1:5187';const child=spawn(path.resolve('node_modules/electron/dist/electron.exe'),['.','--remote-debugging-port=9333','--studio-data-dir='+workspace],{cwd:process.cwd(),env,detached:true,stdio:'ignore',windowsHide:true});child.unref();
 const report={checkedAt:new Date().toISOString(),pid:child.pid,vitePid:vite.pid,original,workspace,draftId:draft.id,videoId:video.id,audioId:audio.id,avatars,fixtureNote:'两项形象资源引用同一真实商品视频，仅验收配置，不作为真人口型生成证据'};fs.writeFileSync(path.join(root,'launch-report.json'),JSON.stringify(report,null,2));
 for(let i=0;i<150;i++){try{await fetch('http://127.0.0.1:9333/json/version');console.log(JSON.stringify(report));return;}catch{await sleep(100);}}throw Error('隔离源码窗口未启动');
})().catch(error=>{console.error(error);process.exitCode=1;});
