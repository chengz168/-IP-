const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const {chromium}=require('C:/Users/DELL/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core');
const root=path.resolve('evidence/validation/alignment'),workspace=path.resolve('evidence/validation/pip-desktop-workspace'),file=path.join(workspace,'studio.json'),baseline=JSON.parse(fs.readFileSync('evidence/validation/workflow-jobs/original-desktop-baseline.json'));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function main(){assert.deepEqual(JSON.parse(fs.readFileSync(file)),baseline);
 // 只关闭当前已知隔离工作区窗口；原任务不经保存接口重写。
 const browser=await chromium.connectOverCDP('http://127.0.0.1:9333'),page=browser.contexts()[0].pages()[0],state=await page.evaluate(()=>window.studio.invoke('state')),fixture=JSON.parse(fs.readFileSync('evidence/validation/workflow-jobs/desktop-fixture.json'));assert.equal(state.currentId,fixture.id);
 await page.evaluate(()=>window.studio.window('close'));await browser.close().catch(()=>{});
 for(let i=0;i<50;i++){try{await fetch('http://127.0.0.1:9333/json/version');await sleep(100);}catch{break;}}
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 const child=spawn(path.resolve('node_modules/electron/dist/electron.exe'),['.','--remote-debugging-port=9333','--studio-data-dir='+workspace],{cwd:process.cwd(),env,detached:true,stdio:'ignore',windowsHide:true});child.unref();let connected;
 for(let i=0;i<100;i++){try{await fetch('http://127.0.0.1:9333/json/version');connected=true;break;}catch{await sleep(100);}}assert.ok(connected,'源码窗口未就绪');
 const restored=await chromium.connectOverCDP('http://127.0.0.1:9333');try{const active=restored.contexts()[0].pages()[0];await active.locator('.steps>button').first().waitFor();if(await active.locator('.cover-templates').count())await active.waitForFunction(()=>{const images=[...document.querySelectorAll('.cover-template-select>img')];return images.length===15&&images.every(i=>i.complete&&i.naturalWidth);},null,{timeout:60000});const current=await active.evaluate(()=>window.studio.invoke('state'));assert.equal(current.currentId,baseline.currentId);assert.deepEqual(JSON.parse(fs.readFileSync(file)),baseline);await active.screenshot({path:path.join(root,'original-workspace-restored.png')});const report={checkedAt:new Date().toISOString(),workspace,pid:child.pid,currentId:current.currentId,completeBusinessJsonUnchanged:true,sourceElectron:true,packagedExeStarted:false};fs.writeFileSync(path.join(root,'restore-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));}finally{await restored.close();}}
 main().catch(error=>{console.error(error);process.exitCode=1;});
