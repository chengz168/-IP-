const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('C:/Users/DELL/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core');
const directory=path.resolve('evidence/validation/indextts-h3-chain'),inputs=JSON.parse(fs.readFileSync(path.join(directory,'inputs.json'),'utf8')),mode=process.argv[2]||'record';
const write=(file,value)=>fs.writeFileSync(path.join(directory,file),JSON.stringify(value,null,2));
async function main(){
 const browser=await chromium.connectOverCDP('http://127.0.0.1:9343'),page=browser.contexts()[0].pages()[0],pageErrors=[];page.on('pageerror',error=>pageErrors.push(error.message));
 const call=(action,payload)=>page.evaluate(({action,payload})=>window.studio.invoke(action,payload),{action,payload});
 try{
  const state=await call('state');assert.equal(state.currentId,inputs.draftId);
  if(mode==='record'){
   const report={at:new Date().toISOString(),runs:state.runs,draft:state.drafts.find(draft=>draft.id===inputs.draftId),pageErrors};write('live-status.json',report);
   console.log(JSON.stringify(state.runs.map(run=>({id:run.id,status:run.status,progress:run.progress,remoteId:run.remoteId,error:run.error,output:run.output?.id}))));return;
  }
  if(mode!=='submit')throw Error('仅支持submit或只读record');
  const receiptFile=path.join(directory,'submission.json');if(fs.existsSync(receiptFile)||state.runs.length)throw Error('已有提交记录，使用record核对原任务，禁止再次提交');
  const callsFile=path.join(directory,'http-calls.json'),calls=fs.existsSync(callsFile)?JSON.parse(fs.readFileSync(callsFile,'utf8')):[];
  assert(!calls.some(call=>call.method==='POST'&&call.url==='/prompt'));
  const queue=await(await fetch('http://127.0.0.1:8188/queue')).json();assert.equal(queue.queue_running.length+queue.queue_pending.length,0);
  await page.locator('.video-config').waitFor();const receipt={at:new Date().toISOString(),draftId:inputs.draftId,audio:inputs.audio,clicked:false,pageErrors,qualityAccepted:false};write('submission.json',receipt);
  await page.getByRole('button',{name:'生成视频',exact:true}).click();receipt.clicked=true;write('submission.json',receipt);
  for(let i=0;i<100;i++){
   const run=(await call('state')).runs.find(run=>run.type==='avatar');
   if(run){receipt.runId=run.id;receipt.run=run;write('submission.json',receipt);await page.screenshot({path:path.join(directory,'generation-submitted.png')});console.log(JSON.stringify({runId:run.id,status:run.status,clicked:true}));return;}
   await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw Error('尚未查到新任务，保留提交凭据，仅允许record核查');
 }finally{await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
