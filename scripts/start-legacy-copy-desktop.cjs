const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const {createDraft}=require('../server/store.cjs'),fixtures=require('./copy-quality-fixtures.cjs');
const {chromium}=require('C:/Users/DELL/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core');
const root=path.resolve('evidence/validation/legacy-copy'),workspace=path.join(root,'desktop-workspace'),original=path.resolve('evidence/validation/pip-desktop-workspace'),sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 assert(!fs.existsSync(workspace),'不覆盖已有验收工作区');
 const bytes=fs.readFileSync(path.join(original,'studio.json')),baseline=JSON.parse(bytes);fs.writeFileSync(path.join(root,'original-baseline.json'),bytes);
 const data=structuredClone(baseline),d=createDraft();Object.assign(d,{title:'旧工作流文案一致性验收（虚构材料）',step:1,sourceText:fixtures.rewrites[1].text,wordLimit:'107',rewrite:'保留的手工稿',finalText:'保留的最终稿',confirmed:true});data.drafts=[d];data.currentId=d.id;data.runs=[];delete data.workflowJobs;data.settings.view='old';data.settings.fontSize='comfortable';data.settings.provider.model='qwen3.8:27b';data.settings.outputDir=path.join(workspace,'outputs');data.prompts.push({id:'validation-title',type:'title',name:'验收专用标题模板',content:'只写标题，不供改写。'});
 const b=await chromium.connectOverCDP('http://127.0.0.1:9333'),p=b.contexts()[0].pages()[0],state=await p.evaluate(()=>window.studio.invoke('state'));assert.equal(state.currentId,baseline.currentId);assert(!state.runs.some(r=>r.status==='running'));await p.evaluate(()=>window.studio.window('close'));await b.close().catch(()=>{});
 for(let i=0;i<120;i++){try{await fetch('http://127.0.0.1:9333/json/version');await sleep(100);}catch{break;}}
 fs.mkdirSync(workspace);fs.writeFileSync(path.join(workspace,'studio.json'),JSON.stringify(data,null,2));const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.STUDIO_DEV_URL;
 const child=spawn(path.resolve('node_modules/electron/dist/electron.exe'),['.','--remote-debugging-port=9333','--studio-data-dir='+workspace],{cwd:process.cwd(),env,detached:true,stdio:'ignore',windowsHide:true});child.unref();
 const report={checkedAt:new Date().toISOString(),pid:child.pid,workspace,original,draftId:d.id,model:data.settings.provider.model,packagedExeStarted:false};fs.writeFileSync(path.join(root,'launch-report.json'),JSON.stringify(report,null,2));for(let i=0;i<150;i++){try{await fetch('http://127.0.0.1:9333/json/version');console.log(JSON.stringify(report));return;}catch{await sleep(100);}}throw Error('源码桌面未就绪');
})().catch(error=>{console.error(error);process.exitCode=1;});
