const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const {chromium}=require('C:/Users/DELL/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core');
const directory=path.resolve('evidence/validation/h3-progress'),mode=process.argv[2]||'record';
const write=(name,value)=>fs.writeFileSync(path.join(directory,name),JSON.stringify(value,null,2));
async function main(){
 const browser=await chromium.connectOverCDP('http://127.0.0.1:9344'),page=browser.contexts()[0].pages()[0],pageErrors=[];page.on('pageerror',error=>pageErrors.push(error.message));
 const call=(action,payload)=>page.evaluate(({action,payload})=>window.studio.invoke(action,payload),{action,payload});
 try{
  const state=await call('state'),inputs=JSON.parse(fs.readFileSync(path.join(directory,'inputs.json'),'utf8'));assert.equal(state.currentId,inputs.draftId);
  if(mode==='submit'){
   if(fs.existsSync(path.join(directory,'submission.json'))||state.runs.length)throw Error('已有任务，禁止重复提交');
   const queue=await(await fetch('http://127.0.0.1:8188/queue')).json();assert.equal(queue.queue_running.length+queue.queue_pending.length,0);
   write('submission.json',{at:new Date().toISOString(),intentRecorded:true,clicked:false});
   await page.locator('.video-config').waitFor();await page.getByRole('button',{name:'生成视频',exact:true}).click();
   await page.waitForFunction(async()=>(await window.studio.invoke('state')).runs.some(run=>run.type==='avatar'));
   const after=await call('state');write('submission.json',{at:new Date().toISOString(),clicked:true,run:after.runs[0],pageErrors});
   console.log(JSON.stringify({clicked:true,id:after.runs[0].id}));return;
  }
  if(mode==='layout'){
   const file=fs.existsSync(path.join(directory,'relaunch.json'))?'relaunch.json':'launch.json',launch=JSON.parse(fs.readFileSync(path.join(directory,file),'utf8'));
   const handle=Number(spawnSync('python',['scripts/desktop-handle.py','--pid',String(launch.pid)],{encoding:'utf8'}).stdout.trim());assert(handle);
   assert.equal(spawnSync('python',['-c','import ctypes,sys;ctypes.windll.user32.ShowWindow(int(sys.argv[1]),9)',String(handle)]).status,0);
   const resize=(width,height)=>{const result=spawnSync('python',['scripts/resize-desktop.py','--handle',String(handle),'--width',String(width),'--height',String(height)],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);};
   const results=[];
   try{
    for(const [width,height]of [[1400,1000],[1100,760]]){
     resize(width,height);await page.waitForFunction(w=>innerWidth===w,width);
     for(const fontSize of ['compact','standard','comfortable','large']){
      await call('saveAppearance',{fontSize});await page.waitForFunction(s=>document.querySelector('.app').dataset.size===s,fontSize);
      await page.waitForFunction(()=>document.querySelector('.operation-activity')?.textContent?.length>0);
      await page.evaluate(async()=>{await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
      const checked=await page.evaluate(()=>{
       const bar=document.querySelector('.operation-status'),button=bar.querySelector('button'),activity=bar.querySelector('.operation-activity'),issues=[];
       const br=bar.getBoundingClientRect(),sr=button.getBoundingClientRect(),ar=activity.getBoundingClientRect();
       if(br.left<0||br.right>innerWidth+1||br.bottom>innerHeight+1)issues.push('反馈条超出视口');
       if(bar.scrollWidth>bar.clientWidth+2||activity.scrollWidth>activity.clientWidth+2)issues.push('文字横向溢出');
       if(sr.left<0||sr.right>innerWidth||sr.bottom>innerHeight)issues.push('停止按钮超出视口');
       if(sr.left<ar.right&&sr.right>ar.left&&sr.top<ar.bottom&&sr.bottom>ar.top)issues.push('阶段文字与停止按钮重叠');
       return {width:innerWidth,height:innerHeight,fontSize:document.querySelector('.app').dataset.size,text:bar.textContent,bar:br.toJSON(),button:sr.toJSON(),activity:ar.toJSON(),issues};
      });results.push(checked);assert.deepEqual(checked.issues,[]);await page.screenshot({path:path.join(directory,`layout-${width}-${fontSize}.png`)});
     }
    }
   }finally{await call('saveAppearance',{fontSize:state.settings.fontSize});resize(1400,1000);write('layout-report.json',{at:new Date().toISOString(),states:results,pageErrors,referenceParityAccepted:false});}
   console.log(JSON.stringify({layoutStates:results.length,pageErrors}));return;
  }
  const run=state.runs.find(r=>r.type==='avatar');
  const report={at:new Date().toISOString(),run,operationText:await page.locator('.operation-status').textContent().catch(()=>''),pageErrors};write('live-status.json',report);
  const history=run?.logs?.filter(row=>row.activity).map(row=>row.activity)||[];write('activity-events.json',history);
  console.log(JSON.stringify({id:run?.id,status:run?.status,promptId:run?.remoteId,activity:run?.activity,error:run?.error,events:history.length,operation:report.operationText}));
 }finally{await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
