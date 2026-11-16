const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('C:/Users/DELL/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core');
const directory=path.resolve('evidence/validation/reference-video-night-20261115');
const write=(file,data)=>fs.writeFileSync(path.join(directory,file),JSON.stringify(data,null,2));
async function main(){
 const expected=JSON.parse(fs.readFileSync(path.join(directory,'desktop-prepared.json'),'utf8'));
 const browser=await chromium.connectOverCDP('http://127.0.0.1:9349'),page=browser.contexts()[0].pages()[0],errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 const state=()=>page.evaluate(()=>window.studio.invoke('state'));
 try{
  await page.locator('.video-config').waitFor();const before=await state(),draft=before.drafts.find(draft=>draft.id===before.currentId);
  assert.equal(draft.id,expected.draftId);assert.equal(draft.video.assetId,expected.assetId);
  const player=page.getByLabel('视频预览',{exact:true});await player.waitFor();await player.scrollIntoViewIfNeeded();
  await page.waitForFunction(()=>document.querySelector('video[aria-label="视频预览"]')?.readyState>=2);
  const read=()=>player.evaluate(node=>({currentTime:node.currentTime,duration:node.duration,paused:node.paused,ended:node.ended,muted:node.muted,error:node.error?.message||'',src:node.currentSrc}));
  await player.evaluate(node=>{node.pause();node.currentTime=0;node.muted=false;});await player.focus();await player.press('Space');
  await page.waitForFunction(()=>document.querySelector('video[aria-label="视频预览"]')?.currentTime>.3);
  const playing=await read();assert(!playing.paused&&!playing.error&&!playing.muted);
  await page.waitForFunction(()=>document.querySelector('video[aria-label="视频预览"]')?.ended,null,{timeout:25000});
  const ended=await read();assert(ended.ended&&!ended.error);assert(Math.abs(ended.duration-8)<.1);
  await page.reload();await page.locator('.video-config').waitFor();await player.waitFor();
  await page.waitForFunction(()=>document.querySelector('video[aria-label="视频预览"]')?.readyState>=2);
  const after=await state();assert.equal(after.drafts.find(draft=>draft.id===expected.draftId).video.assetId,expected.assetId);assert.equal(after.runs.length,before.runs.length);
  await player.evaluate(node=>{node.pause();node.currentTime=4;});
  await page.waitForFunction(()=>{const node=document.querySelector('video[aria-label="视频预览"]');return node&&!node.seeking&&node.readyState>=3&&Math.abs(node.currentTime-4)<.02;});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  // Chromium原生播放器可能短暂保留等待图标，确认新帧实际呈现后再截图。
  await player.evaluate(node=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('未收到真实视频帧呈现回调')),5000);node.requestVideoFrameCallback(()=>{clearTimeout(timer);node.pause();resolve();});node.play().catch(error=>{clearTimeout(timer);reject(error);});}));
  await page.waitForTimeout(500);
  await page.screenshot({path:path.join(directory,'experimental-product.png')});assert.deepEqual(errors,[]);
  write('playback.json',{at:new Date().toISOString(),assetId:expected.assetId,playing,ended,refreshed:await read(),fullNativePlaybackToEnded:true,refreshBinding:true,pageErrors:errors,submittedThroughProductButton:false,experimentalAssetBoundForPlayback:true,newModelSubmissions:0,audioAudited:false,continuousLipSyncReviewed:false,qualityAccepted:false});
  console.log(JSON.stringify({assetId:expected.assetId,fullNativePlayback:true,refreshBinding:true,pageErrors:errors,qualityAccepted:false}));
 }catch(error){write('playback-error.json',{at:new Date().toISOString(),error:error.stack,pageErrors:errors});throw error;}finally{await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
