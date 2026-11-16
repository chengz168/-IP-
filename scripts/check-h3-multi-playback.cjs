const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('C:/Users/DELL/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core');
const root=path.resolve('evidence/validation/h3-multi-generation');

async function main(){
 const browser=await chromium.connectOverCDP('http://127.0.0.1:9340'),page=browser.contexts()[0].pages()[0],errors=[];page.on('pageerror',error=>errors.push(error.message));
 const state=()=>page.evaluate(()=>window.studio.invoke('state'));const read=()=>page.getByLabel('视频预览',{exact:true}).evaluate(video=>({src:video.currentSrc,time:video.currentTime,duration:video.duration,ended:video.ended,error:video.error?.message||'',paused:video.paused,muted:video.muted,volume:video.volume}));
 try{
  const before=await state(),draft=before.drafts.find(item=>item.id===before.currentId);assert(draft.video.assetId);
  const player=page.getByLabel('视频预览',{exact:true});await player.waitFor();await player.scrollIntoViewIfNeeded();await player.focus();await page.keyboard.press('Space');
  await page.waitForFunction(()=>document.querySelector('video[controls]')?.currentTime>0.2);const started=await read();assert(!started.paused&&!started.error);
  await page.waitForFunction(()=>document.querySelector('video[controls]')?.ended,null,{timeout:20000});const ended=await read();assert(ended.ended&&!ended.error);await page.screenshot({path:path.join(root,'playback-ended.png')});
  await page.reload();await page.locator('.video-config').waitFor();const after=await state(),current=after.drafts.find(item=>item.id===after.currentId);assert.equal(current.video.assetId,draft.video.assetId);assert.equal(after.runs.length,before.runs.length);
  await page.waitForFunction(()=>document.querySelector('video[controls]')?.readyState>=2);const refreshed=await read();assert(refreshed.src.includes(draft.video.assetId));assert.deepEqual(errors,[]);
  const report={at:new Date().toISOString(),assetId:draft.video.assetId,started,ended,refreshed,fullNativePlaybackToEnded:true,assetBindingSurvivesReload:true,pageErrors:errors,audioAudited:false,continuousLipSyncReviewed:false,qualityAccepted:false};
  fs.writeFileSync(path.join(root,'playback.json'),JSON.stringify(report,null,2));await page.screenshot({path:path.join(root,'final-generated-product.png')});console.log(JSON.stringify(report));
 }finally{await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
