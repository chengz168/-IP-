// 检查新对照页的真实媒体加载、播放互斥和窄屏布局，不填写人工质量结论。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url');
const {chromium}=require('C:/Users/DELL/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core');
const root=path.resolve('evidence/validation/voice-C-character-20261116');
async function main(){
 const receipt=path.join(root,'page-verification.json');assert(!fs.existsSync(receipt),'已有页面检查，不覆盖');
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1100,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(pathToFileURL(path.join(root,'C音色人物合成对照.html')).href);
  await page.waitForFunction(()=>[...document.querySelectorAll('video,audio')].every(n=>n.readyState>=1));
  const metadata=await page.locator('video,audio').evaluateAll(nodes=>nodes.map(n=>({tag:n.tagName,src:n.currentSrc,duration:n.duration,error:n.error?.message||null})));
  assert.equal(metadata.length,3);assert(metadata.every(n=>!n.error&&n.duration>6&&n.duration<7));
  await page.locator('video').first().evaluate(n=>n.play());await page.waitForFunction(()=>document.querySelector('video').currentTime>.1);
  await page.locator('video').nth(1).evaluate(n=>n.play());await page.waitForFunction(()=>document.querySelectorAll('video')[1].currentTime>.1);assert(await page.locator('video').first().evaluate(n=>n.paused));
  await page.locator('audio').evaluate(n=>n.play());assert(await page.locator('video').nth(1).evaluate(n=>n.paused));await page.locator('audio').evaluate(n=>n.pause());
  const layouts=[];for(const width of [1100,390]){
   await page.setViewportSize({width,height:1000});const geometry=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,cards:[...document.querySelectorAll('article')].map(n=>{const r=n.getBoundingClientRect();return{left:r.left,right:r.right}})}));assert(geometry.scrollWidth<=width);assert(geometry.cards.every(r=>r.left>=0&&r.right<=width));
   await page.screenshot({path:path.join(root,'review-page-'+width+'.png'),fullPage:true});layouts.push(geometry);
  }
  assert.deepEqual(errors,[]);fs.writeFileSync(receipt,JSON.stringify({at:new Date().toISOString(),browser:'本机Chrome无头模式',metadata,actualPlaybackStarted:true,onlyOnePlayerAtATime:true,layouts,pageErrors:errors,humanListeningAccepted:false,characterMatchAccepted:false},null,2),{flag:'wx'});
  console.log(JSON.stringify({receipt,mediaLoaded:3,onlyOnePlayerAtATime:true,layouts:layouts.map(l=>({width:l.width,scrollWidth:l.scrollWidth})),pageErrors:errors}));
 }finally{await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
