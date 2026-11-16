const fs=require('fs'),path=require('path'),assert=require('assert/strict'),{spawn}=require('child_process');
const {createDraft}=require('../server/store.cjs');
const {chromium}=require('C:/Users/DELL/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core');
const root=path.resolve('evidence/validation/copy-studio'),original=path.resolve('evidence/validation/pip-desktop-workspace'),workspace=path.join(root,'desktop-workspace'),sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 fs.mkdirSync(root,{recursive:true});assert.ok(!fs.existsSync(workspace),'隔离目录已经存在，不覆盖验收记录');
 const baseline=JSON.parse(fs.readFileSync(path.join(original,'studio.json'),'utf8'));fs.writeFileSync(path.join(root,'original-baseline.json'),JSON.stringify(baseline,null,2));
 const b=await chromium.connectOverCDP('http://127.0.0.1:9333'),p=b.contexts()[0].pages()[0];const current=await p.evaluate(()=>window.studio.invoke('state'));assert.equal(current.currentId,baseline.currentId);await p.evaluate(()=>window.studio.window('close'));await b.close().catch(()=>{});
 for(let i=0;i<120;i++){try{await fetch('http://127.0.0.1:9333/json/version');await sleep(100);}catch{break;}}
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(original,'studio.json'),'utf8')),baseline);
 const data=structuredClone(baseline),draft=createDraft();draft.title='选题与营销真实模型验收';draft.tab='topic';draft.sourceText='验收前保留的手工原文';Object.assign(draft.topic,{industry:'桌面收纳',persona:'知识科普型',audience:'在家办公的人',bio:'分享可直接操作的桌面整理建议，不编造亲身案例。'});Object.assign(draft.marketing,{name:'桌面分格收纳盒',audience:'希望分类放置文具的人',selling:'分格放置文具和小件物品。',persona:'介绍整理方法，不编造使用经历。',offer:''});data.drafts.unshift(draft);data.currentId=draft.id;data.runs=[];delete data.workflowJobs;data.settings.outputDir=path.join(workspace,'outputs');data.settings.view='new';fs.mkdirSync(workspace,{recursive:true});fs.writeFileSync(path.join(workspace,'studio.json'),JSON.stringify(data,null,2));
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;const child=spawn(path.resolve('node_modules/electron/dist/electron.exe'),['.','--remote-debugging-port=9333','--studio-data-dir='+workspace],{cwd:process.cwd(),env,detached:true,stdio:'ignore',windowsHide:true});child.unref();fs.writeFileSync(path.join(root,'launch-report.json'),JSON.stringify({pid:child.pid,workspace,draftId:draft.id,original,checkedAt:new Date().toISOString()},null,2));
 for(let i=0;i<150;i++){try{await fetch('http://127.0.0.1:9333/json/version');console.log('源码隔离窗口已启动',child.pid);return;}catch{await sleep(100);}}throw Error('源码窗口未就绪');
})().catch(e=>{console.error(e);process.exitCode=1;});
