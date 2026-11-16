const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
const {chromium}=require('C:/Users/DELL/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core');
const root=path.resolve('evidence/validation/title-ant-controls'),original=path.resolve('evidence/validation/pip-desktop-workspace'),isolated=path.join(root,'desktop-workspace'),baselineFile=path.join(root,'original-baseline.json');
const read=file=>JSON.parse(fs.readFileSync(file)),pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<150;i++){if(await fn())return;await pause(100);}throw new Error('源码窗口等待超时');}
async function main(){
 const mode=process.argv[2];assert.ok(['prepare','restore'].includes(mode));const baseline=fs.readFileSync(baselineFile);assert.equal(fs.readFileSync(path.join(original,'studio.json')).equals(baseline),true);
 const browser=await chromium.connectOverCDP('http://127.0.0.1:9333'),page=browser.contexts()[0].pages()[0],state=await page.evaluate(()=>window.studio.invoke('state'));assert.ok(!state.runs.some(r=>['running','queued'].includes(r.status)));
 await page.evaluate(()=>window.studio.window('close'));await browser.close().catch(()=>{});await until(async()=>{try{await fetch('http://127.0.0.1:9333/json/version');return false;}catch{return true;}});
 if(mode==='prepare'){
  assert.ok(!fs.existsSync(path.join(isolated,'studio.json')),'已有隔离数据，禁止覆盖');
  const data=JSON.parse(baseline),fixture=read('evidence/validation/edit-page-fidelity/visual-baseline.json'),reference=fixture.drafts.find(d=>d.id===fixture.currentId),draft=data.drafts.find(d=>d.id===data.currentId),asset=fixture.assets.find(a=>a.id===reference.edit.sourceId);assert.ok(fs.existsSync(asset.path));
  // 隔离清单只引用已保存的同源媒体，不写旧验收目录和原厂数据。
  if(!data.assets.some(a=>a.id===asset.id))data.assets.push(structuredClone(asset));draft.step=4;draft.edit=structuredClone(reference.edit);draft.edit.resultId='';draft.video.assetId=asset.id;data.runs=[];data.workflowJobs=[];data.settings.view='new';data.settings.fontSize='comfortable';data.settings.outputDir=path.join(isolated,'outputs');fs.mkdirSync(isolated,{recursive:true});fs.writeFileSync(path.join(isolated,'studio.json'),JSON.stringify(data,null,2));
 }
 const target=mode==='restore'?original:isolated,env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.STUDIO_DEV_URL;
 const child=spawn(path.resolve('node_modules/electron/dist/electron.exe'),['.','--remote-debugging-port=9333','--studio-data-dir='+target],{cwd:process.cwd(),env,windowsHide:true,detached:true,stdio:'ignore'});child.unref();await until(async()=>{try{return(await fetch('http://127.0.0.1:9333/json/version')).ok;}catch{return false;}});
 const active=await chromium.connectOverCDP('http://127.0.0.1:9333'),activePage=active.contexts()[0].pages()[0];await activePage.locator('.steps>button').first().waitFor();const current=await activePage.evaluate(()=>window.studio.invoke('state')),draft=current.drafts.find(d=>d.id===current.currentId);await active.close();
 const report={checkedAt:new Date().toISOString(),mode,pid:child.pid,workspace:target,originalBytesUnchanged:fs.readFileSync(path.join(original,'studio.json')).equals(baseline),originalSha256:crypto.createHash('sha256').update(baseline).digest('hex'),currentId:draft.id,step:draft.step,activeRuns:current.runs.filter(r=>['running','queued'].includes(r.status)).length,settingsMatch:mode==='restore'?JSON.stringify(current.settings)===JSON.stringify(JSON.parse(baseline).settings):null,startupVerified:false,packagedExeStarted:false};assert.equal(report.originalBytesUnchanged,true);fs.writeFileSync(path.join(root,mode+'-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
