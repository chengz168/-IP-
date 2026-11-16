const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('C:/Users/DELL/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core');
const root=path.resolve('evidence/validation/prompt-routing'),launch=JSON.parse(fs.readFileSync(path.join(root,'launch-report.json'),'utf8')),read=()=>JSON.parse(fs.readFileSync(path.join(launch.workspace,'studio.json'),'utf8')),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
 const variant=process.env.STUDIO_PROMPT_VARIANT||'',reportName=variant?'model-'+variant+'-report.json':'model-report.json';
 assert(!fs.existsSync(path.join(root,reportName)),'已验证的模型请求不重复执行');
 const b=await chromium.connectOverCDP('http://127.0.0.1:9333'),p=b.contexts()[0].pages()[0],report={checkedAt:new Date().toISOString(),pageErrors:[],qualityAccepted:false};p.on('pageerror',error=>report.pageErrors.push(error.message));
 try{
  assert(p.url().startsWith('file:'));const before=read(),d=before.drafts.find(d=>d.id===launch.draftId);assert.equal(d.template,'reference-copy-v840');assert.equal(d.wordLimit,String(d.sourceText.length));
  const priorIds=new Set(before.runs.map(r=>r.id));await p.getByRole('button',{name:'改写文案',exact:true}).click();const started=Date.now();let run;
  while(Date.now()-started<180000){run=read().runs.find(r=>r.type==='rewrite'&&!priorIds.has(r.id));if(run&&['failed','cancelled','succeeded'].includes(run.status))break;await sleep(200);}
  assert(run&&run.status==='succeeded',run?.error||'改写尚未完成');
  await p.waitForFunction(()=>!document.querySelector('.operation-status'));await p.waitForTimeout(350);await p.screenshot({path:path.join(root,variant?'real-reference-rewrite-'+variant+'.png':'real-reference-rewrite.png')});
  const {referencePrompts}=await import('../server/reference-prompts.mjs');assert.equal(run.output.request.messages[0].content,referencePrompts[0].content);assert.equal(run.output.request.model,run.parameters.input.generation.model);assert.equal(run.output.stale,false);
  report.rewrite={runId:run.id,source:run.snapshot.sourceText,target:Number(run.snapshot.wordLimit),text:run.output.text,quality:run.output.quality,request:run.output.request,usage:run.output.usage,elapsedMs:Date.parse(run.endedAt)-Date.parse(run.createdAt),model:run.output.request.model};
  const state=read(),after=state.drafts.find(d=>d.id===launch.draftId);if(run.output.quality.status==='rejected')assert.equal(after.rewrite,d.rewrite);else assert.equal(after.rewrite,run.output.text);assert.equal(after.confirmed,false);assert.deepEqual(report.pageErrors,[]);
  report.acceptedRequestAndPersistence=true;fs.writeFileSync(path.join(root,reportName),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }finally{await b.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
