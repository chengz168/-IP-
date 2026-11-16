const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const {chromium}=require('C:/Users/DELL/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core');
const directory=path.resolve('evidence/validation/indextts-h3-chain');
async function main(){
 const browser=await chromium.connectOverCDP('http://127.0.0.1:9343'),page=browser.contexts()[0].pages()[0],pageErrors=[];page.on('pageerror',error=>pageErrors.push(error.message));
 const launchFile=fs.existsSync(path.join(directory,'relaunch.json'))?'relaunch.json':'launch.json',launch=JSON.parse(fs.readFileSync(path.join(directory,launchFile),'utf8'));
 const handle=Number(spawnSync('python',['scripts/desktop-handle.py','--pid',String(launch.pid)],{encoding:'utf8'}).stdout.trim());assert(handle);
 assert.equal(spawnSync('python',['-c','import ctypes,sys;ctypes.windll.user32.ShowWindow(int(sys.argv[1]),9)',String(handle)]).status,0);
 const state=()=>page.evaluate(()=>window.studio.invoke('state')),read=()=>page.getByLabel('视频预览',{exact:true}).evaluate(node=>({src:node.currentSrc,time:node.currentTime,duration:node.duration,ended:node.ended,paused:node.paused,error:node.error?.message||''}));
 try{
  const before=await state(),draft=before.drafts.find(draft=>draft.id===before.currentId),assetId=draft.video.assetId;assert(assetId);
  const player=page.getByLabel('视频预览',{exact:true});await player.waitFor();await player.scrollIntoViewIfNeeded();await page.waitForFunction(()=>document.querySelector('video[controls]')?.readyState>=2);await player.focus();await player.press('Space');
  await page.waitForFunction(()=>document.querySelector('video[controls]')?.currentTime>.2);const playing=await read();assert(!playing.paused&&!playing.error);
  await page.waitForFunction(()=>document.querySelector('video[controls]')?.ended,null,{timeout:30000});const ended=await read();assert(ended.ended&&!ended.error);await page.screenshot({path:path.join(directory,'playback-ended.png')});
  await page.reload();await page.locator('.video-config').waitFor();await page.waitForFunction(()=>document.querySelector('video[controls]')?.readyState>=2);const after=await state();assert.equal(after.drafts.find(draft=>draft.id===after.currentId).video.assetId,assetId);assert.equal(after.runs.length,before.runs.length);assert.deepEqual(pageErrors,[]);
  fs.writeFileSync(path.join(directory,'playback.json'),JSON.stringify({at:new Date().toISOString(),assetId,playing,ended,refreshed:await read(),fullNativePlaybackToEnded:true,bindingAfterReload:true,pageErrors,audioAudited:false,continuousLipSyncReviewed:false,qualityAccepted:false},null,2));await page.screenshot({path:path.join(directory,'generated-product.png')});console.log(JSON.stringify({assetId,fullPlayback:true,refreshBinding:true,pageErrors}));
 }catch(error){fs.writeFileSync(path.join(directory,'playback-failure.json'),JSON.stringify({at:new Date().toISOString(),error:error.stack,pageErrors},null,2));throw error;}finally{await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
