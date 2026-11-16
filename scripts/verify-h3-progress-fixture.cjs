const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const {chromium}=require('C:/Users/DELL/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core');
const directory=path.resolve('evidence/validation/h3-progress-ui-fixture');
async function main(){
 const browser=await chromium.connectOverCDP('http://127.0.0.1:9345'),page=browser.contexts()[0].pages()[0],report={at:new Date().toISOString(),fixture:true,realModelGeneration:false,states:[],pageErrors:[]};page.on('pageerror',error=>report.pageErrors.push(error.message));
 const call=(action,payload)=>page.evaluate(({action,payload})=>window.studio.invoke(action,payload),{action,payload});
 const launch=JSON.parse(fs.readFileSync(path.join(directory,'launch.json'),'utf8'));
 const handle=Number(spawnSync('python',['scripts/desktop-handle.py','--pid',String(launch.pid)],{encoding:'utf8'}).stdout.trim());assert(handle);
 const resize=(w,h)=>{assert.equal(spawnSync('python',['scripts/resize-desktop.py','--handle',String(handle),'--width',String(w),'--height',String(h)],{encoding:'utf8'}).status,0);};
 try{
  const initial=await call('state');assert.equal(initial.runs.length,0,'已有夹具运行时不得重复提交');
  await page.getByRole('button',{name:'生成视频',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.operation-activity')?.textContent==='采样 3/8');
  const before=(await call('state')).runs[0];assert.equal(before.status,'running');
  await page.reload();await page.waitForFunction(()=>document.querySelector('.operation-activity')?.textContent==='采样 3/8');
  await fetch('http://127.0.0.1:18194/qa/progress');await page.waitForFunction(()=>document.querySelector('.operation-activity')?.textContent==='采样 4/8');
  const after=(await call('state')).runs[0];assert.equal(after.id,before.id);assert.equal(after.remoteId,before.remoteId);assert.equal(after.status,'running');report.refreshDuringRun=true;report.pollContinuesAfterReload=true;
  await page.screenshot({path:path.join(directory,'refreshed-sampling.png')});
  await page.getByRole('button',{name:'菜单',exact:true}).click();await page.getByRole('button',{name:'任务中心',exact:true}).click();await page.getByRole('button',{name:'执行记录',exact:true}).click();
  assert((await page.locator('.execution-task-table').textContent()).includes('采样 4/8'));await page.getByRole('button',{name:'详情',exact:true}).click();await page.getByRole('heading',{name:'执行详情',exact:true}).waitFor();
  assert((await page.locator('.run-details').textContent()).includes('采样 4/8'));assert(!(await page.locator('.run-details').textContent()).includes('12%'));
  assert.equal(spawnSync('python',['-c','import ctypes,sys;ctypes.windll.user32.ShowWindow(int(sys.argv[1]),9)',String(handle)]).status,0);
  for(const [width,height]of [[1400,1000],[1100,760]]){
   resize(width,height);await page.waitForFunction(w=>innerWidth===w,width);
   for(const fontSize of ['compact','standard','comfortable','large']){
    await call('saveAppearance',{fontSize});await page.waitForFunction(s=>document.querySelector('.app').dataset.size===s,fontSize);
    await page.evaluate(async()=>{await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
    const state=await page.evaluate(()=>{
     const issues=[],modal=document.querySelector('.modal'),details=document.querySelector('.run-details'),bar=document.querySelector('.operation-status'),button=bar.querySelector('button');
     for(const [name,node]of [['弹窗',modal],['执行详情',details],['反馈条',bar]]){const r=node.getBoundingClientRect();if(r.left<0||r.right>innerWidth+1||r.bottom>innerHeight+1)issues.push(name+'超出视口');if(node.scrollWidth>node.clientWidth+2)issues.push(name+'横向溢出');}
     const rect=button.getBoundingClientRect();if(rect.left<0||rect.right>innerWidth||rect.bottom>innerHeight)issues.push('停止按钮越界');
     const dd=[...details.querySelectorAll('dd')];if(dd.some(n=>n.scrollWidth>n.clientWidth+2))issues.push('详情值横向溢出');
     return {width:innerWidth,height:innerHeight,fontSize:document.querySelector('.app').dataset.size,details:details.textContent,issues};
    });report.states.push(state);assert.deepEqual(state.issues,[]);await page.screenshot({path:path.join(directory,`detail-${width}-${fontSize}.png`)});
   }
  }
  await page.getByRole('button',{name:'关闭',exact:true}).click();
  await fetch('http://127.0.0.1:18194/qa/drop');await page.waitForFunction(()=>document.querySelector('.operation-activity')?.textContent.includes('连接中断'));
  assert.equal((await call('state')).runs[0].status,'running');report.disconnectKeepsOriginalRun=true;
  await page.getByRole('button',{name:'停止处理',exact:true}).click();await page.waitForFunction(async()=>(await window.studio.invoke('state')).runs[0].status!=='running');
  const final=(await call('state')).runs[0];assert.equal(final.status,'unknown');assert.equal(final.remoteId,before.remoteId);assert.equal(final.output,undefined);
  const calls=JSON.parse(fs.readFileSync(path.join(directory,'http-calls.json'),'utf8'));assert.equal(calls.filter(row=>row.method==='POST'&&row.url==='/prompt').length,1);
  report.cancelPreservesOriginalId=true;report.observerNeverCompletesRun=true;report.promptPosts=1;report.finalRun=final;assert.deepEqual(report.pageErrors,[]);report.passed=true;
 }catch(error){report.error=error.stack;throw error;}
 finally{fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify(report,null,2));await browser.close();}
 console.log(JSON.stringify({passed:report.passed,fixture:true,realModelGeneration:false,layoutStates:report.states.length,pageErrors:report.pageErrors}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
