// 只关闭本批隔离验收窗口，同时核对进程退出和保护文件，避免影响正式软件。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('C:/Users/DELL/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core');
const {digest}=require('../integrations/musetalk-local/input.cjs');
const root=path.resolve(__dirname,'../evidence/validation/caption-phrases-C-20261116');
const read=name=>JSON.parse(fs.readFileSync(path.join(root,name),'utf8'));
function alive(pid){try{process.kill(pid,0);return true}catch(error){if(error.code==='ESRCH')return false;throw error}}
async function main(){
 const launch=read('launch.json'),prepared=read('prepared.json');
 assert.equal(launch.port,9372);assert.equal(launch.workspace,prepared.workspace);
 assert(!fs.existsSync(path.join(root,'closed.json')),'保留已完成的关闭回执');
 assert(alive(launch.pid),'本批主进程已退出，需核对既有状态');
 const browser=await chromium.connectOverCDP('http://127.0.0.1:'+launch.port);
 let closeConnectionError=null;
 try{
  const pages=browser.contexts().flatMap(context=>context.pages());
  assert.equal(pages.length,1,'隔离窗口页面数变化，停止关闭');
  const page=pages[0];
  const state=await page.evaluate(()=>window.studio.invoke('state',{}));
  assert.equal(state.currentId,prepared.draftId);
  assert.equal(state.drafts.length,1);
  assert.equal(state.runs.filter(run=>['running','queued'].includes(run.status)).length,0);
  try{await page.evaluate(()=>window.studio.window('close'))}catch(error){
   closeConnectionError=String(error);
   if(!/closed|disconnected|destroyed/i.test(closeConnectionError))throw error;
  }
 }finally{await browser.close().catch(()=>{})}
 for(let attempt=0;attempt<40&&alive(launch.pid);attempt++)await new Promise(resolve=>setTimeout(resolve,250));
 assert(!alive(launch.pid),'CDP断开不能代替主进程退出');
 const protections=read('baseline.json').protectedFiles.map(file=>({...file,actual:digest(file.file)}));
 assert(protections.every(file=>file.sha256===file.actual));
 const result={at:new Date().toISOString(),pid:launch.pid,port:launch.port,closedThroughOwnWindow:true,processExited:true,closeConnectionError,protectedFiles:protections,protectedFilesUnchanged:true,otherWindowsClosed:false,newModelSubmissions:0};
 fs.writeFileSync(path.join(root,'closed.json'),JSON.stringify(result,null,2),{flag:'wx'});
 console.log(JSON.stringify({pid:launch.pid,processExited:true,protectedFiles:protections.length}));
}
main().catch(error=>{console.error(error);process.exitCode=1});
