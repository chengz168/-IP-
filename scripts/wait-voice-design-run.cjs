// 仅观察原任务；超时保留任务ID，绝不自动重新提交。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('C:/Users/DELL/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core');
async function main(){
 const root=path.resolve('evidence/validation/voice-design-20261115'),kind=process.argv[2],submission=JSON.parse(fs.readFileSync(path.join(root,'qwen-'+kind+'-submission.json'),'utf8'));
 const browser=await chromium.connectOverCDP('http://127.0.0.1:9351'),page=browser.contexts()[0].pages()[0],observations=[];let prior='';
 try{
  const started=Date.now();while(Date.now()-started<16*60*1000){
   const run=await page.evaluate(async id=>(await window.studio.invoke('state',{})).runs.find(run=>run.id===id),submission.runId);assert(run);
   let worker;try{worker=JSON.parse(fs.readFileSync(path.join(run.local.directory,'result.json'),'utf8'));}catch{}
   const status={runId:run.id,status:run.status,worker:worker?.status,modelLoaded:worker?.modelLoaded,inferenceStarted:worker?.inferenceStarted,error:run.error||worker?.error};
   if(JSON.stringify(status)!==prior){prior=JSON.stringify(status);observations.push({at:new Date().toISOString(),...status});console.log(prior);fs.writeFileSync(path.join(root,'qwen-'+kind+'-observations.json'),JSON.stringify(observations,null,2));}
   if(!['queued','running'].includes(run.status)){assert.equal(run.status,'succeeded',run.error);return;}
   await new Promise(resolve=>setTimeout(resolve,1000));
  }throw Error('原任务尚未结束，请继续查询原ID，不可重交');
 }finally{await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
