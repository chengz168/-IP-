const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('C:/Users/DELL/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core');
const directory=path.resolve('evidence/validation/reference-sample-20261115'),mode=process.argv[2];
const write=(name,data)=>fs.writeFileSync(path.join(directory,name),JSON.stringify(data,null,2));
async function main(){
 const browser=await chromium.connectOverCDP('http://127.0.0.1:9347'),page=browser.contexts()[0].pages()[0],errors=[];page.on('pageerror',error=>errors.push(error.message));
 const state=()=>page.evaluate(()=>window.studio.invoke('state'));
 try{
  await page.locator('.shared-edit-preview').waitFor();
  if(mode==='render'){
   const before=await state();assert(!before.runs.some(run=>run.type==='render'&&['running','queued','unknown','succeeded'].includes(run.status)),'已有剪辑运行或产物，禁止重复点击');
   await page.screenshot({path:path.join(directory,'editor-before-render.png')});
   await page.getByRole('button',{name:'剪辑视频',exact:true}).click();
   const deadline=Date.now()+90000;let run;
   while(Date.now()<deadline){run=(await state()).runs.find(run=>run.type==='render');if(run&&run.status!=='running')break;await new Promise(resolve=>setTimeout(resolve,300));}
   assert.equal(run?.status,'succeeded',run?.error);await page.getByLabel('剪辑成片视频',{exact:true}).waitFor();
   write('render.json',{at:new Date().toISOString(),run,submittedThroughProductButton:true,pageErrors:errors});await page.screenshot({path:path.join(directory,'rendered-product.png')});console.log(JSON.stringify({runId:run.id,outputId:run.output.id,pageErrors:errors}));return;
  }
  if(mode==='playback'){
   const before=await state(),draft=before.drafts.find(item=>item.id===before.currentId),assetId=draft.edit.resultId;assert(assetId);
   const video=page.getByLabel('剪辑成片视频',{exact:true});await video.waitFor();await video.scrollIntoViewIfNeeded();
   await page.waitForFunction(()=>document.querySelector('video[aria-label="剪辑成片视频"]')?.readyState>=2);
   await video.evaluate(node=>{node.currentTime=0;node.muted=false;});await video.focus();await video.press('Space');
   await page.waitForFunction(()=>document.querySelector('video[aria-label="剪辑成片视频"]')?.currentTime>.3);
   const read=()=>video.evaluate(node=>({time:node.currentTime,duration:node.duration,ended:node.ended,paused:node.paused,muted:node.muted,error:node.error?.message||''}));
   const playing=await read();assert(!playing.paused&&!playing.error&&!playing.muted);
   await page.waitForFunction(()=>document.querySelector('video[aria-label="剪辑成片视频"]')?.ended,null,{timeout:20000});const ended=await read();assert(ended.ended&&!ended.error);
   await page.reload();await page.locator('.shared-edit-preview').waitFor();await video.waitFor();const after=await state();assert.equal(after.drafts.find(item=>item.id===after.currentId).edit.resultId,assetId);assert.equal(after.runs.length,before.runs.length);
   await video.evaluate(node=>{node.currentTime=.7;node.pause();});await page.screenshot({path:path.join(directory,'final-product.png')});assert.deepEqual(errors,[]);
   write('playback.json',{at:new Date().toISOString(),assetId,playing,ended,fullNativePlaybackToEnded:true,refreshBinding:true,pageErrors:errors,continuousLipSyncReviewed:false,qualityAccepted:false});console.log(JSON.stringify({assetId,fullNativePlayback:true,refreshBinding:true,pageErrors:errors}));return;
  }
  throw Error('必须选择render或playback');
 }finally{await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
