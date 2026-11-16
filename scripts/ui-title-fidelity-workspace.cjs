const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawn,spawnSync}=require('node:child_process');
const {chromium}=require('C:/Users/DELL/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core');
const root=path.resolve('evidence/validation/title-fidelity'),workspace=path.join(root,'desktop-workspace'),original=path.resolve('evidence/validation/pip-desktop-workspace'),read=file=>JSON.parse(fs.readFileSync(file)),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const state=()=>read(path.join(workspace,'studio.json'));
async function until(fn){for(let i=0;i<100;i++){if(await fn())return;await sleep(100);}throw new Error('等待真实窗口或保存超时');}
async function connect(){return chromium.connectOverCDP('http://127.0.0.1:9333');}
async function menu(page,name){await page.getByRole('button',{name:'菜单',exact:true}).click();await page.getByRole('navigation',{name:'主菜单'}).getByRole('button',{name,exact:true}).click();}
async function notice(page){const b=page.getByRole('button',{name:'关闭提示',exact:true});if(await b.count())await b.click();}
async function font(page,label){await menu(page,'设置');await page.locator('.settings-nav').getByRole('button',{name:'常规设置',exact:true}).click();await page.getByRole('group',{name:'界面字号',exact:true}).getByRole('button',{name:label,exact:true}).click();await notice(page);await menu(page,'新工作流');await page.locator('.steps>button').nth(4).click();}
async function launch(restore){
 fs.mkdirSync(root,{recursive:true});
 if(!restore){assert.ok(!fs.existsSync(path.join(root,'original-baseline.json')),'本批工作区已有基线，不能覆盖');fs.copyFileSync(path.join(original,'studio.json'),path.join(root,'original-baseline.json'));const copy=read('evidence/validation/edit-title/desktop-workspace/studio.json');copy.settings.fontSize='comfortable';copy.settings.view='new';copy.settings.outputDir='';copy.drafts[0].step=4;copy.drafts[0].edit.cutSilence=false;copy.drafts[0].edit.speed=1;copy.drafts[0].edit.subtitlesEnabled=false;copy.drafts[0].edit.resultId='';fs.mkdirSync(workspace,{recursive:true});fs.writeFileSync(path.join(workspace,'studio.json'),JSON.stringify(copy,null,2));}
 const baseline=read(path.join(root,'original-baseline.json'));assert.deepEqual(read(path.join(original,'studio.json')),baseline);
 const browser=await connect();try{const page=browser.contexts()[0].pages()[0],active=await page.evaluate(()=>window.studio.invoke('state'));assert.equal(active.currentId,restore?state().currentId:baseline.currentId);await page.evaluate(()=>window.studio.window('close'));}finally{await browser.close().catch(()=>{});}
 await until(async()=>{try{await fetch('http://127.0.0.1:9333/json/version');return false;}catch{return true;}});
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;const child=spawn(path.resolve('node_modules/electron/dist/electron.exe'),['.','--remote-debugging-port=9333','--studio-data-dir='+(restore?original:workspace)],{env,cwd:process.cwd(),windowsHide:true,detached:true,stdio:'ignore'});child.unref();
 await until(async()=>{try{return (await fetch('http://127.0.0.1:9333/json/version')).ok;}catch{return false;}});
 const active=await connect();try{const page=active.contexts()[0].pages()[0],pageErrors=[];page.on('pageerror',e=>pageErrors.push(e.message));await page.locator('.steps>button').first().waitFor();if(restore){await page.waitForFunction(()=>!document.querySelector('.cover-painting'));await page.waitForFunction(()=>document.querySelectorAll('.cover-template-select>img').length===15);assert.deepEqual(read(path.join(original,'studio.json')),baseline);await page.screenshot({path:path.join(root,'restored-original.png')});}const report={checkedAt:new Date().toISOString(),pid:child.pid,workspace:restore?original:workspace,originalJsonUnchanged:true,packagedExeStarted:false,pageErrors};assert.deepEqual(pageErrors,[]);fs.writeFileSync(path.join(root,restore?'restore-report.json':'launch-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));}finally{await active.close();}
}

const action=process.argv[2];(action==='restore'?launch(true):launch(false)).catch(error=>{console.error(error);process.exitCode=1;});
