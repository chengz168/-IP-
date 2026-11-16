const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('C:/Users/DELL/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core');
async function main(){
 const directory=path.resolve('evidence/validation/musetalk-sample-20261115'),file=path.join(directory,'trial-1/review/comparison.mp4'),resultFile=path.join(directory,'playback.json');
 if(fs.existsSync(resultFile))throw Error('已有播放验证，不能覆盖');
 const videoBytes=fs.readFileSync(file),server=http.createServer((req,res)=>{
  if(req.url==='/video.mp4'){res.writeHead(200,{'Content-Type':'video/mp4','Content-Length':videoBytes.length});res.end(videoBytes);return;}
  res.writeHead(200,{'Content-Type':'text/html;charset=utf-8'});
  res.end('<!doctype html><meta charset="utf-8"><title>示例二口型三路对照</title><style>body{margin:0;padding:24px;background:#15161b;color:#eee;font:16px system-ui}h1{font-size:22px}p{color:#b9bcc6}video{width:100%;max-width:1100px;background:#000}button{display:block;margin:16px 0;padding:10px 18px}</style><h1>示例二－夜间：原形象 / 原版成片 / 本地 MuseTalk 候选</h1><p>此页仅用于本地视频播放验收，画面质量与连续口型尚待审核。音轨复用原片。</p><video controls muted preload="auto" src="/video.mp4"></video><button>播放对照视频</button><script>const video=document.querySelector("video");window.frameCount=0;window.playError=null;function observed(){window.frameCount++;video.requestVideoFrameCallback(observed)}video.requestVideoFrameCallback(observed);document.querySelector("button").onclick=()=>video.play().catch(e=>window.playError=e.message);</script>');
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
 try{
  browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1200,height:900}});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const snapshot=await page.locator('body').ariaSnapshot();fs.writeFileSync(path.join(directory,'playback-snapshot.txt'),snapshot);
  await page.getByRole('button',{name:'播放对照视频',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('video').currentTime>=2&&window.frameCount>2,null,{timeout:20000});
  const screenshot=path.resolve('output/playwright/musetalk-night-20261115.png');fs.mkdirSync(path.dirname(screenshot),{recursive:true});await page.screenshot({path:screenshot});
  await page.waitForFunction(()=>document.querySelector('video').ended,null,{timeout:20000});
  const playback=await page.evaluate(()=>{const v=document.querySelector('video');return {ended:v.ended,duration:v.duration,currentTime:v.currentTime,width:v.videoWidth,height:v.videoHeight,muted:v.muted,observedVideoFrameCallbacks:window.frameCount,error:window.playError||v.error?.message||null,quality:v.getVideoPlaybackQuality().toJSON?.()||{totalVideoFrames:v.getVideoPlaybackQuality().totalVideoFrames,droppedVideoFrames:v.getVideoPlaybackQuality().droppedVideoFrames}};});
  if(!playback.ended||playback.error||errors.length||Math.abs(playback.duration-8)>.05||playback.observedVideoFrameCallbacks<30)throw Error('实际播放未通过：'+JSON.stringify({playback,errors}));
  const report={at:new Date().toISOString(),browser:'本机Chrome无头模式',playback,errors,screenshot,nativeVideoPlaybackVerified:true,listeningAccepted:false,continuousLipSyncAccepted:false,qualityAccepted:false,productGenerationButtonIntegrated:false};fs.writeFileSync(resultFile,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
 }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
