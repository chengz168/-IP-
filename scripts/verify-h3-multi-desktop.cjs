const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('C:/Users/DELL/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core');
const root=path.resolve('evidence/validation/h3-multi-generation'),inputs=JSON.parse(fs.readFileSync(path.join(root,'inputs.json'),'utf8'));

async function main(){
 const mode=process.argv[2]||'configure',browser=await chromium.connectOverCDP('http://127.0.0.1:9340'),page=browser.contexts()[0].pages()[0],errors=[];
 page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(15000);
 const state=()=>page.evaluate(()=>window.studio.invoke('state')),current=async()=>{const data=await state();assert.equal(data.currentId,inputs.draftId);return data.drafts.find(item=>item.id===data.currentId);};
 const save=(name,value)=>fs.writeFileSync(path.join(root,name+'.json'),JSON.stringify(value,null,2));
 const capture=async name=>{await page.evaluate(async()=>{await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});await page.screenshot({path:path.join(root,name+'.png')});};
 try{
  await page.locator('.video-config').waitFor();
  if(mode==='configure'){
   assert.equal((await state()).runs.length,0);assert.equal((await current()).video.mode,'single');
   await page.getByRole('button',{name:'多镜头',exact:true}).click();await page.getByRole('button',{name:'编辑镜头',exact:true}).click();
   const dialog=page.getByRole('dialog',{name:'配置多镜头',exact:true});await dialog.waitFor();await page.getByRole('button',{name:'添加镜头',exact:true}).click();
   await page.getByRole('spinbutton',{name:'镜头1时长',exact:true}).fill('3');await page.getByRole('button',{name:'取消',exact:true}).click();await dialog.waitFor({state:'detached'});
   assert.equal((await current()).video.shots.length,1);assert.equal((await current()).video.shots[0].duration,10);
   await page.getByRole('button',{name:'编辑镜头',exact:true}).click();await page.getByRole('button',{name:'添加镜头',exact:true}).click();
   await page.getByRole('combobox',{name:'镜头2形象',exact:true}).click();await page.getByRole('option',{name:inputs.avatars[1].name,exact:true}).click();
   await page.getByRole('button',{name:'上移镜头2',exact:true}).click();assert.equal(await page.getByRole('combobox',{name:'镜头1形象',exact:true}).getAttribute('data-value'),inputs.avatars[1].id);
   await page.getByRole('button',{name:'下移镜头1',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.shot-distribute')?.disabled);
   await page.getByRole('button',{name:'按音频平均分配',exact:true}).click();const durations=await page.locator('.shot-duration input').evaluateAll(list=>list.map(input=>Number(input.value)));
   assert(Math.abs(durations.reduce((a,b)=>a+b,0)-inputs.audio.duration)<=.051);await capture('configured-shots');
   await page.getByRole('button',{name:'确定',exact:true}).click();await dialog.waitFor({state:'detached'});await page.reload();await page.locator('.video-config').waitFor();
   const draft=await current();assert.deepEqual(draft.video.shots,inputs.avatars.map((avatar,i)=>({avatarId:avatar.id,duration:durations[i]})));assert.equal((await state()).runs.length,0);assert.deepEqual(errors,[]);
   save('desktop-configuration',{at:new Date().toISOString(),draftId:draft.id,shots:draft.video.shots,cancelRollback:true,avatarSelection:true,reorderAndRestore:true,realAudioDistribution:true,persistedAfterReload:true,pageErrors:errors,modelSubmissions:0});await capture('configured-persisted');
  }else if(mode==='submit'||mode==='record'){
   const preflight=JSON.parse(fs.readFileSync(path.join(root,'preflight-report.json'),'utf8'));assert(preflight.allSamplesCoveredExactlyOnce&&preflight.shots.length===2);
   if(mode==='submit'){
    assert.equal((await state()).runs.length,0);const callsFile=path.join(root,'http-calls.json'),calls=fs.existsSync(callsFile)?JSON.parse(fs.readFileSync(callsFile,'utf8')):[];
    assert(!calls.some(call=>call.method==='POST'&&call.url==='/prompt'),'已有模型提交，禁止重复点击生成');
    await page.getByRole('button',{name:'生成视频',exact:true}).click();
   }
   // 在Node侧等待IPC实际状态，避免页面轮询把跨上下文Promise当作已就绪。
   let run;const deadline=Date.now()+60000;
   while(Date.now()<deadline){run=(await state()).runs.find(item=>item.type==='avatar');if(run?.remote?.segments?.some(part=>part.remoteId))break;await page.waitForTimeout(200);}
   assert(run?.remote?.segments?.some(part=>part.remoteId),'尚未收到已保存的模型任务ID');
   save('desktop-submission',{at:new Date().toISOString(),runId:run.id,planId:run.remote.plan.id,segments:run.remote.segments.map(part=>({index:part.index,status:part.status,remoteId:part.remoteId})),submittedThroughRealGenerateButton:true,receiptOnly:mode==='record',pageErrors:errors,qualityAccepted:false});await capture('generation-submitted');
  }else throw Error('未知操作，未执行任何生成');
  console.log(JSON.stringify({mode,pageErrors:errors,success:true}));
 }catch(error){save('desktop-'+mode+'-failure',{at:new Date().toISOString(),error:error.stack,pageErrors:errors});await capture('desktop-'+mode+'-failure').catch(()=>{});throw error;}
 finally{await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
