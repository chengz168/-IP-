// 只重开本批隔离源码窗口，沿用已有数据，禁止重新播种或重复提交任务。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const {chromium}=require('C:/Users/DELL/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core');
const directory=path.resolve('evidence/validation/voice-design-20261115'),base=path.resolve('evidence/validation/musetalk-integration-20261115'),workspace=path.join(base,'workspace');
async function main(){
 const record=path.join(directory,'desktop-relaunch.json');assert(!fs.existsSync(record),'已有重开记录，请核实实际进程后继续');
 const browser=await chromium.connectOverCDP('http://127.0.0.1:9351'),page=browser.contexts()[0].pages()[0],state=await page.evaluate(()=>window.studio.invoke('state',{}));
 assert(!state.runs.some(run=>['running','queued','unknown'].includes(run.status)),'尚有未结束任务');
 const closed=await browser.newBrowserCDPSession();await closed.send('Browser.close').catch(()=>{});await browser.close().catch(()=>{});
 const until=async predicate=>{for(let i=0;i<150;i++){if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,100));}throw Error('等待隔离源码桌面就绪超时');};
 await until(async()=>{try{await fetch('http://127.0.0.1:9351/json/version');return false;}catch{return true;}});
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.STUDIO_DEV_URL;
 const child=spawn(require('electron'),[path.resolve('scripts/start-musetalk-integration-desktop.cjs'),'--remote-debugging-port=9351','--studio-data-dir='+workspace],{cwd:process.cwd(),env,windowsHide:true,detached:true,stdio:'ignore'});child.unref();
 const launch={at:new Date().toISOString(),pid:child.pid,port:9351,workspace,currentId:state.currentId,sourceElectron:true,reseeded:false};fs.writeFileSync(record,JSON.stringify(launch,null,2));
 await until(async()=>{try{return(await fetch('http://127.0.0.1:9351/json/version')).ok;}catch{return false;}});console.log(JSON.stringify(launch));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
