const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {chromium}=require('C:/Users/DELL/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core');
const directory=path.resolve('evidence/validation/render-stability-20261115'),records=[];
async function main(){
 for(const port of [9346,9347]){
  const browser=await chromium.connectOverCDP('http://127.0.0.1:'+port);
  try{
   const page=browser.contexts()[0].pages()[0],state=await page.evaluate(()=>window.studio.invoke('state'));
   const pending=state.runs.filter(run=>['running','queued','unknown'].includes(run.status));if(pending.length)throw Error('端口'+port+'存在未终结任务，不能关闭');
   records.push({port,currentId:state.currentId,runs:state.runs.map(run=>({id:run.id,type:run.type,status:run.status})),pending:[]});
   await page.screenshot({path:path.join(directory,'before-close-'+port+'.png')});
   // 通过软件已有窗口关闭动作正常退出，不强杀业务进程。
   await page.evaluate(()=>window.studio.window('close'));
  }finally{await browser.close();}
 }
 const protectedFiles=['data/studio.json','evidence/validation/reference-sample-20261115/workspace/studio.json','evidence/validation/local-link-extraction/workspace/studio.json'];
 fs.writeFileSync(path.join(directory,'before-runtime-update.json'),JSON.stringify({at:new Date().toISOString(),windows:records,protectedFiles:protectedFiles.map(file=>({file:path.resolve(file),sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}))},null,2));
 console.log(JSON.stringify({closed:records.map(record=>record.port),protectedFiles:protectedFiles.length}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
