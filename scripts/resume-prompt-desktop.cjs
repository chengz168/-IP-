const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const {chromium}=require('C:/Users/DELL/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core');
const root=path.resolve('evidence/validation/prompt-routing'),launchFile=path.join(root,'launch-report.json'),launch=JSON.parse(fs.readFileSync(launchFile,'utf8')),baseline=JSON.parse(fs.readFileSync(path.join(root,'original-baseline.json'),'utf8')),sleep=ms=>new Promise(r=>setTimeout(r,ms));
// 只恢复已有隔离工作区，不重新初始化或覆盖真实生成记录。
(async()=>{
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(launch.original,'studio.json'),'utf8')),baseline);
 const isolated=JSON.parse(fs.readFileSync(path.join(launch.workspace,'studio.json'),'utf8'));
 assert.equal(isolated.currentId,launch.draftId);assert.ok(!isolated.runs.some(r=>r.status==='running'));
 const b=await chromium.connectOverCDP('http://127.0.0.1:9333'),p=b.contexts()[0].pages()[0],state=await p.evaluate(()=>window.studio.invoke('state'));
 assert.equal(state.currentId,baseline.currentId);assert.ok(!state.runs.some(r=>r.status==='running'));
 await p.evaluate(()=>window.studio.window('close'));await b.close().catch(()=>{});
 for(let i=0;i<120;i++){try{await fetch('http://127.0.0.1:9333/json/version');await sleep(100);}catch{break;}}
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.STUDIO_DEV_URL;
 const child=spawn(path.resolve('node_modules/electron/dist/electron.exe'),['.','--remote-debugging-port=9333','--studio-data-dir='+launch.workspace],{cwd:process.cwd(),env,detached:true,stdio:'ignore',windowsHide:true});child.unref();
 let active;for(let i=0;i<150;i++){try{active=await chromium.connectOverCDP('http://127.0.0.1:9333');break;}catch{await sleep(100);}}assert.ok(active);
 try{const page=active.contexts()[0].pages()[0];await page.locator('.steps>button').first().waitFor();assert.equal((await page.evaluate(()=>window.studio.invoke('state'))).currentId,launch.draftId);assert.deepEqual(JSON.parse(fs.readFileSync(path.join(launch.workspace,'studio.json'),'utf8')),isolated);fs.writeFileSync(launchFile,JSON.stringify({...launch,pid:child.pid,resumedAt:new Date().toISOString(),resumedExistingWorkspace:true},null,2));console.log(JSON.stringify({pid:child.pid,retainedRuns:isolated.runs.length,originalUnchanged:true,isolatedUnchanged:true}));}finally{await active.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
