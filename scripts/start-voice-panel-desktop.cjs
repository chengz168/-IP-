const fs=require('fs'),path=require('path'),assert=require('assert/strict'),crypto=require('crypto'),{spawn}=require('child_process');
const {Store,createDraft}=require('../server/store.cjs');
const {chromium}=require('C:/Users/DELL/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core');
const root=path.resolve('evidence/validation/voice-panel'),original=path.resolve('evidence/validation/pip-desktop-workspace'),workspace=path.join(root,'desktop-workspace'),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
 assert(!fs.existsSync(workspace),'不覆盖已有隔离验收');fs.mkdirSync(root,{recursive:true});const baseline=JSON.parse(fs.readFileSync(path.join(original,'studio.json'),'utf8'));
 fs.writeFileSync(path.join(root,'original-baseline.json'),JSON.stringify(baseline,null,2));const browser=await chromium.connectOverCDP('http://127.0.0.1:9333'),page=browser.contexts()[0].pages()[0],current=await page.evaluate(()=>window.studio.invoke('state'));
 assert.equal(current.currentId,baseline.currentId);assert(!current.runs.some(run=>run.status==='running'));await page.evaluate(()=>window.studio.window('close'));await browser.close().catch(()=>{});
 for(let i=0;i<120;i++){try{await fetch('http://127.0.0.1:9333/json/version');await sleep(100);}catch{break;}}
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(original,'studio.json'),'utf8')),baseline);
 const data=structuredClone(baseline);data.runs=[];data.workflowJobs=[];data.settings.view='new';data.settings.outputDir=path.join(workspace,'outputs');fs.mkdirSync(workspace,{recursive:true});fs.writeFileSync(path.join(workspace,'studio.json'),JSON.stringify(data,null,2));
 const store=new Store(workspace);const videoPath='D:/我的智能体/视频测试素材/收纳盒商品推广视频_19s.mp4';assert(fs.existsSync(videoPath));
 const {WindowsSpeech}=require('../server/windows-speech.cjs'),{Media}=require('../server/media.cjs');const voices=await new WindowsSpeech(store,new Media(store)).voices();assert(voices.length>0);store.data.settings.provider.ttsProtocol='windows';if(!voices.some(v=>v.name===store.data.settings.provider.systemVoice))store.data.settings.provider.systemVoice=voices.find(v=>v.culture==='zh-CN')?.name||voices[0].name;
 const draft=createDraft();draft.title='声音页真实本地能力验收';draft.step=2;draft.finalText='整理房间可以从桌面开始。把常用的小物件分类收好，留出一块干净的工作区域。睡前再花一点时间归位，第二天就能轻松找到需要的东西。';draft.confirmed=true;const other=createDraft();other.title='切任务隔离验收';other.step=2;other.finalText='另一个任务，不能被旧配音覆盖。';store.data.drafts.unshift(draft,other);store.data.currentId=draft.id;store.save();
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.STUDIO_DEV_URL;
 const viteLog=fs.openSync(path.join(root,'vite.log'),'a');const vite=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5187','--strictPort'],{cwd:process.cwd(),env,detached:true,stdio:['ignore',viteLog,viteLog],windowsHide:true});vite.unref();
 for(let i=0;i<100;i++){try{const response=await fetch('http://127.0.0.1:5187');if(response.ok)break;}catch{}await sleep(100);}
 env.STUDIO_DEV_URL='http://127.0.0.1:5187';const child=spawn(path.resolve('node_modules/electron/dist/electron.exe'),['.','--remote-debugging-port=9333','--studio-data-dir='+workspace],{cwd:process.cwd(),env,detached:true,stdio:'ignore',windowsHide:true});child.unref();
 const report={checkedAt:new Date().toISOString(),pid:child.pid,vitePid:vite.pid,original,workspace,draftId:draft.id,otherDraftId:other.id,videoPath,voices,testText:draft.finalText,globalVoice:store.data.settings.provider.systemVoice};fs.writeFileSync(path.join(root,'launch-report.json'),JSON.stringify(report,null,2));
 for(let i=0;i<150;i++){try{await fetch('http://127.0.0.1:9333/json/version');console.log(JSON.stringify(report));return;}catch{await sleep(100);}}throw Error('隔离源码窗口未启动');
})().catch(error=>{console.error(error);process.exitCode=1;});
