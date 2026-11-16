const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const {createDraft}=require('../server/store.cjs');
const {chromium}=require('C:/Users/DELL/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core');
const root=path.resolve('evidence/validation/prompt-routing'),original=path.resolve('evidence/validation/pip-desktop-workspace'),workspace=path.join(root,'desktop-workspace'),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
 fs.mkdirSync(root,{recursive:true});assert(!fs.existsSync(workspace),'不覆盖已有验收工作区');
 const baseline=JSON.parse(fs.readFileSync(path.join(original,'studio.json'),'utf8'));fs.writeFileSync(path.join(root,'original-baseline.json'),JSON.stringify(baseline,null,2));
 const b=await chromium.connectOverCDP('http://127.0.0.1:9333'),p=b.contexts()[0].pages()[0];assert.equal((await p.evaluate(()=>window.studio.invoke('state'))).currentId,baseline.currentId);await p.evaluate(()=>window.studio.window('close'));await b.close().catch(()=>{});
 for(let i=0;i<120;i++){try{await fetch('http://127.0.0.1:9333/json/version');await sleep(100);}catch{break;}}
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(original,'studio.json'),'utf8')),baseline);
 const data=structuredClone(baseline),draft=createDraft(),previous=JSON.parse(fs.readFileSync('evidence/validation/rewrite-menu/functional-report.json','utf8')).model;
 draft.title='提示词来源与真实文案质量验收';draft.step=1;draft.sourceText=previous.input;draft.wordLimit=String(draft.sourceText.length);draft.template='reference-copy-v840';
 data.drafts.unshift(draft);data.currentId=draft.id;data.runs=[];delete data.workflowJobs;data.settings.outputDir=path.join(workspace,'outputs');data.settings.view='new';
 fs.mkdirSync(workspace,{recursive:true});fs.writeFileSync(path.join(workspace,'studio.json'),JSON.stringify(data,null,2));
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 const child=spawn(path.resolve('node_modules/electron/dist/electron.exe'),['.','--remote-debugging-port=9333','--studio-data-dir='+workspace],{cwd:process.cwd(),env,detached:true,stdio:'ignore',windowsHide:true});child.unref();
 fs.writeFileSync(path.join(root,'launch-report.json'),JSON.stringify({checkedAt:new Date().toISOString(),pid:child.pid,workspace,original,draftId:draft.id,sourceCharacters:draft.sourceText.length,previousModel:previous.model},null,2));
 for(let i=0;i<150;i++){try{await fetch('http://127.0.0.1:9333/json/version');console.log('隔离源码桌面已启动 PID='+child.pid);return;}catch{await sleep(100);}}throw Error('桌面未就绪');
})().catch(e=>{console.error(e);process.exitCode=1;});
