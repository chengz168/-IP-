const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('C:/Users/DELL/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core');
const directory=path.resolve('evidence/validation/indextts-generation'),inputs=JSON.parse(fs.readFileSync(path.join(directory,'inputs.json'),'utf8')),mode=process.argv[2];
const write=(name,value)=>fs.writeFileSync(path.join(directory,name),JSON.stringify(value,null,2));
const audioPolicy='vocoder-before-limit-peak-0.95-v2';

async function main(){
 const b=await chromium.connectOverCDP('http://127.0.0.1:9342'),p=b.contexts()[0].pages()[0];
 const call=(action,payload)=>p.evaluate(({action,payload})=>window.studio.invoke(action,payload),{action,payload});
 try{
  const state=await call('state'),runs=state.runs.filter(run=>run.draftId===inputs.draftId&&run.type==='speech');
  if(mode==='record'){
   write('live-status.json',{at:new Date().toISOString(),runs,draft:state.drafts.find(item=>item.id===inputs.draftId),assets:state.assets.filter(item=>item.origin==='local-indextts')});
   console.log(JSON.stringify(runs.map(run=>({id:run.id,status:run.status,progress:run.progress,error:run.error,output:run.output}))));return;
  }
  if(!['submit-normal','submit-happy','submit-fast'].includes(mode))throw Error('请显式选择submit-normal、submit-happy、submit-fast或只读record');
  const happy=mode==='submit-happy',fast=mode==='submit-fast',receiptFile=path.join(directory,mode+'.json');
  if(fs.existsSync(receiptFile))throw Error('已有该次提交凭据，请使用record查看原任务，禁止重复提交');
  const candidates=runs.filter(run=>run.parameters?.input?.audioPolicy===audioPolicy);
  if(candidates.length!==(fast?2:happy?1:0)||!runs.every(run=>run.status==='succeeded'))throw Error('当前任务状态不满足本次新策略提交条件');
  const check=await call('checkLocalSpeech');write('environment-before-'+mode+'.json',check);
  if(!check.ready)throw Error('本地声音环境尚未就绪，未点击生成');
  const queue=await (await fetch('http://127.0.0.1:8188/queue')).json();
  if(queue.queue_running.length||queue.queue_pending.length)throw Error('ComfyUI有活动任务，未清理缓存或提交新声音');
  const freed=await fetch('http://127.0.0.1:8188/free',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({unload_models:true,free_memory:true})});assert.equal(freed.status,200);
  await p.locator('.voice-config').waitFor();
  {
   const toggle=p.getByRole('button',{name:'高级设置',exact:true});if(await toggle.getAttribute('aria-expanded')!=='true')await toggle.click();
   await p.getByRole('combobox',{name:'情绪类型',exact:true}).click();await p.getByRole('option',{name:happy?'高兴':'正常',exact:true}).click();
   if(happy)await p.getByRole('spinbutton',{name:'情绪强度',exact:true}).fill('0.7');
   const speed=p.getByRole('slider',{name:'声音语速',exact:true});await speed.focus();await speed.press('Home');for(let i=0;i<(fast?14:10);i++)await speed.press('ArrowRight');
  }
  const beforeIds=new Set(runs.map(run=>run.id));
  const receipt={at:new Date().toISOString(),mode,audioPolicy,draftId:inputs.draftId,reference:inputs.reference,environment:check,baselineRuns:runs.filter(run=>!candidates.includes(run)).map(run=>run.id),comfyCache:{queueEmpty:true,responseStatus:freed.status},clicked:false};
  write(mode+'.json',receipt);
  await p.getByRole('button',{name:'生成声音',exact:true}).click();receipt.clicked=true;write(mode+'.json',receipt);
  for(let i=0;i<100;i++){
   const current=await call('state'),run=current.runs.find(run=>run.type==='speech'&&run.draftId===inputs.draftId&&!beforeIds.has(run.id));
   if(run){receipt.run=run;write(mode+'.json',receipt);await p.screenshot({path:path.join(directory,mode+'.png')});console.log(JSON.stringify({runId:run.id,status:run.status,input:run.parameters?.input}));return;}
   await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw Error('点击后未及时读取到run，请只读record核查，不要重按生成');
 }finally{await b.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
