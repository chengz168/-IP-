const fs=require('fs'),path=require('path'),assert=require('assert/strict'),{spawn}=require('child_process');
const {chromium}=require('C:/Users/DELL/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core');
const root=path.resolve(process.env.STUDIO_VALIDATION_ROOT||'evidence/validation/dropdown-select'),original=path.resolve('evidence/validation/pip-desktop-workspace'),workspace=path.join(root,'desktop-workspace'),sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 fs.mkdirSync(root,{recursive:true});assert.ok(!fs.existsSync(workspace),'已有验收目录，不覆盖');
 const baseline=JSON.parse(fs.readFileSync(path.join(original,'studio.json'),'utf8'));fs.writeFileSync(path.join(root,'original-baseline.json'),JSON.stringify(baseline,null,2));
 const b=await chromium.connectOverCDP('http://127.0.0.1:9333'),p=b.contexts()[0].pages()[0],current=await p.evaluate(()=>window.studio.invoke('state'));
 assert.equal(current.currentId,baseline.currentId);assert.ok(!current.runs.some(run=>run.status==='running'));await p.evaluate(()=>window.studio.window('close'));await b.close().catch(()=>{});
 for(let i=0;i<120;i++){try{await fetch('http://127.0.0.1:9333/json/version');await sleep(100);}catch{break;}}
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(original,'studio.json'),'utf8')),baseline);
 // 复用上批真实模型生成的候选，只验证菜单操作，不触发新的模型调用。
 const data=structuredClone(baseline),copy=JSON.parse(fs.readFileSync('evidence/validation/copy-studio/desktop-workspace/studio.json','utf8')),draft=structuredClone(copy.drafts.find(d=>d.id===copy.currentId));
 draft.title='创作菜单交互与布局验收';draft.step=0;draft.tab='topic';data.drafts.unshift(draft);data.currentId=draft.id;data.runs=[];data.workflowJobs=[];data.settings.outputDir=path.join(workspace,'outputs');data.settings.view='new';
 fs.mkdirSync(workspace,{recursive:true});fs.writeFileSync(path.join(workspace,'studio.json'),JSON.stringify(data,null,2));
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;const child=spawn(path.resolve('node_modules/electron/dist/electron.exe'),['.','--remote-debugging-port=9333','--studio-data-dir='+workspace],{cwd:process.cwd(),env,detached:true,stdio:'ignore',windowsHide:true});child.unref();
 fs.writeFileSync(path.join(root,'launch-report.json'),JSON.stringify({pid:child.pid,workspace,draftId:draft.id,original,checkedAt:new Date().toISOString(),reusedExistingModelCandidates:true},null,2));
 for(let i=0;i<150;i++){try{await fetch('http://127.0.0.1:9333/json/version');console.log('隔离源码窗口已启动',child.pid);return;}catch{await sleep(100);}}throw Error('窗口未就绪');
})().catch(error=>{console.error(error);process.exitCode=1;});
