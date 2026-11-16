const path=require('node:path');
const {chromium}=require('C:/Users/DELL/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core');
(async()=>{
 const browser=await chromium.connectOverCDP('http://127.0.0.1:9348');
 try{
  const page=browser.contexts()[0].pages()[0];
  const state=await page.evaluate(()=>window.studio.invoke('state'));if(state.runs.some(run=>['running','queued','unknown'].includes(run.status)))throw Error('存在活动任务，不能关闭');
  const video=page.getByLabel('剪辑成片视频',{exact:true});
  // 等待真实视频帧送达再暂停，避免把加载指示器截为验收画面。
  await video.evaluate(async node=>{await node.play();await new Promise(resolve=>node.requestVideoFrameCallback(resolve));node.pause();});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await page.screenshot({path:path.resolve('evidence/validation/render-stability-20261115/desktop-stable.png')});
  await page.evaluate(()=>window.studio.window('close'));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
