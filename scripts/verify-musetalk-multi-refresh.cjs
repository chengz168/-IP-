// 只刷新观察原任务，不重复提交；确认真实工作器存活后才记录运行中门禁。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('C:/Users/DELL/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core');
const root=path.resolve('evidence/validation/musetalk-multi-20261115');
async function main(){
 const mode=process.argv[2];assert(['baseline','fixed'].includes(mode));const target=path.join(root,'refresh-'+mode+'.json');assert(!fs.existsSync(target));
 const submission=JSON.parse(fs.readFileSync(path.join(root,'submitted.json'),'utf8')),browser=await chromium.connectOverCDP('http://127.0.0.1:9351');
 try{
  const page=browser.contexts()[0].pages()[0],call=()=>page.evaluate(()=>window.studio.invoke('state',{}));let state=await call(),run=state.runs.find(run=>run.id===submission.runId);
  assert.equal(run.status,'running');process.kill(run.local.pid,0);const before=state.runs.length;
  await page.reload();await page.locator('.video-config').waitFor();
  const controls={generateDisabled:await page.getByRole('button',{name:'生成视频',exact:true}).isDisabled(),multiDisabled:await page.getByRole('button',{name:'多镜头',exact:true}).isDisabled(),editDisabled:await page.getByRole('button',{name:'编辑镜头',exact:true}).isDisabled()};
  state=await call();run=state.runs.find(run=>run.id===submission.runId);assert.equal(run.status,'running');process.kill(run.local.pid,0);assert.equal(state.runs.length,before);
  if(mode==='fixed')assert(Object.values(controls).every(Boolean));else assert(Object.values(controls).some(value=>!value));
  fs.writeFileSync(target,JSON.stringify({at:new Date().toISOString(),runId:run.id,pid:run.local.pid,workerVerifiedLive:true,sameRunAfterRefresh:true,noNewSubmission:true,controls},null,2),{flag:'wx'});console.log(JSON.stringify({mode,...controls}));
 }finally{await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
