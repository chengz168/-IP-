// 仅重开沿用数据的源码窗口，确认没有活跃任务后才关闭，不重新播种。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const {chromium}=require('C:/Users/DELL/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core');
const root=path.resolve('evidence/validation/musetalk-multi-20261115'),workspace=path.resolve('evidence/validation/musetalk-integration-20261115/workspace');
async function main(){
 const record=path.join(root,'desktop-relaunch.json');assert(!fs.existsSync(record),'已有本轮重开记录，不重复启动');
 const browser=await chromium.connectOverCDP('http://127.0.0.1:9351'),page=browser.contexts()[0].pages()[0],state=await page.evaluate(()=>window.studio.invoke('state',{}));
 assert(!state.runs.some(run=>['running','queued','unknown'].includes(run.status)));
 const before=JSON.parse(fs.readFileSync(path.join(workspace,'studio.json'),'utf8'));
 fs.writeFileSync(path.join(root,'before-restart.json'),JSON.stringify({currentId:before.currentId,drafts:before.drafts},null,2),{flag:'wx'});
 const session=await browser.newBrowserCDPSession();await session.send('Browser.close').catch(()=>{});await browser.close().catch(()=>{});
 const wait=async predicate=>{for(let i=0;i<150;i++){if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,100));}throw Error('源码窗口观察超时，先检查原PID，不自动重启');};
 await wait(async()=>{try{await fetch('http://127.0.0.1:9351/json/version');return false;}catch{return true;}});
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.STUDIO_DEV_URL;
 const child=spawn(require('electron'),[path.resolve('scripts/start-musetalk-integration-desktop.cjs'),'--remote-debugging-port=9351','--studio-data-dir='+workspace],{cwd:process.cwd(),env,windowsHide:true,detached:true,stdio:'ignore'});child.unref();
 const receipt={at:new Date().toISOString(),pid:child.pid,port:9351,workspace,sourceElectron:true,reseeded:false,currentId:before.currentId};fs.writeFileSync(record,JSON.stringify(receipt,null,2),{flag:'wx'});
 await wait(async()=>{try{return(await fetch('http://127.0.0.1:9351/json/version')).ok;}catch{return false;}});
 const current=await chromium.connectOverCDP('http://127.0.0.1:9351');try{await current.contexts()[0].pages()[0].locator('.app main').waitFor({timeout:15000});}finally{await current.close();}
 const after=JSON.parse(fs.readFileSync(path.join(workspace,'studio.json'),'utf8'));assert.deepEqual(after.drafts,before.drafts);assert.equal(after.currentId,before.currentId);console.log(JSON.stringify(receipt));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
