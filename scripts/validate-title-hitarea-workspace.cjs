const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
const {chromium}=require('C:/Users/DELL/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core');
const root=path.resolve('evidence/validation/title-template-hitarea'),original=path.resolve('evidence/validation/pip-desktop-workspace'),workspace=path.join(root,'desktop-workspace'),read=file=>JSON.parse(fs.readFileSync(file)),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
async function until(fn){for(let i=0;i<150;i++){if(await fn())return;await sleep(100);}throw new Error('源码窗口等待超时');}
async function main(){
 const mode=process.argv[2]||'prepare',baselineFile=path.join(root,'original-baseline.json');fs.mkdirSync(root,{recursive:true});
 let baseline;
 if(mode==='prepare'){
  assert.ok(!fs.existsSync(baselineFile),'已有基线，禁止覆盖');baseline=fs.readFileSync('evidence/validation/rewrite-anchors/workspace-before.json');
  const current=read(path.join(original,'studio.json')),expected=JSON.parse(baseline),normalized=structuredClone(current);
  // 本轮进入剪辑再返回视频页只允许任务时间戳变化，其余差异必须停止恢复。
  for(const d of normalized.drafts){const before=expected.drafts.find(x=>x.id===d.id);assert.ok(before);d.updatedAt=before.updatedAt;}
  assert.deepEqual(normalized,expected);fs.writeFileSync(baselineFile,baseline);fs.copyFileSync(path.join(original,'studio.json'),path.join(root,'navigation-autosave-before-restore.json'));
 }else baseline=fs.readFileSync(baselineFile);
 const browser=await chromium.connectOverCDP('http://127.0.0.1:9333');const page=browser.contexts()[0].pages()[0],state=await page.evaluate(()=>window.studio.invoke('state'));assert.ok(!state.runs.some(r=>['running','queued'].includes(r.status)));
 await page.evaluate(()=>window.studio.window('close'));await browser.close().catch(()=>{});
 await until(async()=>{try{await fetch('http://127.0.0.1:9333/json/version');return false;}catch{return true;}});
 if(mode==='prepare'){
  fs.writeFileSync(path.join(original,'studio.json'),baseline);const data=JSON.parse(baseline),d=data.drafts.find(d=>d.id===data.currentId),{titleDesign,selectTitleTemplate,titleTemplates}=await import('../server/title-model.mjs');
  d.step=4;Object.assign(d.edit,{titleEnabled:true,subtitlesEnabled:false,cardEnabled:false,pipEnabled:false,bgmEnabled:false,sfxEnabled:false,resultId:'',title:'标题位置测试',subtitle:'整画面拖动定位'});d.edit.titleDesign=selectTitleTemplate(d.edit,titleTemplates[0]);d.edit.titleDesign.displayMode='seconds';d.edit.titleDesign.duration=3;
  data.runs=[];data.workflowJobs=[];data.settings.view='new';data.settings.fontSize='standard';data.settings.outputDir=path.join(workspace,'outputs');fs.mkdirSync(workspace,{recursive:true});fs.writeFileSync(path.join(workspace,'studio.json'),JSON.stringify(data,null,2));
 }else{
  assert.equal(fs.readFileSync(path.join(original,'studio.json')).equals(baseline),true);
  if(mode==='same-state'){
   const data=read(path.join(workspace,'studio.json')),fixture=read('evidence/validation/edit-page-fidelity/visual-baseline.json'),d=data.drafts.find(d=>d.id===data.currentId),reference=fixture.drafts.find(d=>d.id===fixture.currentId),asset=fixture.assets.find(a=>a.id===reference.edit.sourceId);assert.ok(fs.existsSync(asset.path));
   // 仅在本批隔离清单引用已留存的只读同源文件，不修改源媒体或旧验收数据。
   if(!data.assets.some(a=>a.id===asset.id))data.assets.push(structuredClone(asset));d.edit=structuredClone(reference.edit);d.edit.resultId='';d.video.assetId=asset.id;data.settings.fontSize='comfortable';fs.writeFileSync(path.join(workspace,'studio.json'),JSON.stringify(data,null,2));
  }
 }
 const target=mode==='restore'?original:workspace,env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.STUDIO_DEV_URL;
 const child=spawn(path.resolve('node_modules/electron/dist/electron.exe'),['.','--remote-debugging-port=9333','--studio-data-dir='+target],{cwd:process.cwd(),env,windowsHide:true,detached:true,stdio:'ignore'});child.unref();
 await until(async()=>{try{return(await fetch('http://127.0.0.1:9333/json/version')).ok;}catch{return false;}});
 const active=await chromium.connectOverCDP('http://127.0.0.1:9333');await active.contexts()[0].pages()[0].locator('.steps>button').first().waitFor();await active.close();
 const report={checkedAt:new Date().toISOString(),mode,pid:child.pid,workspace:target,originalBytesUnchangedAtEnd:fs.readFileSync(path.join(original,'studio.json')).equals(baseline),originalSha256:hash(baseline),startupVerified:false,packagedExeStarted:false};assert.equal(report.originalBytesUnchangedAtEnd,true);fs.writeFileSync(path.join(root,mode+'-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
