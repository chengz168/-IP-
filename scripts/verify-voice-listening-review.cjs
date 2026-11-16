// 只验证试听页行为；自动填写的表单用于检查导出，不是用户听感。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),http=require('node:http');
const {chromium}=require('C:/Users/DELL/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core');
const root=path.resolve('evidence/validation/voice-listening-review-20261115');
async function main(){
 const reportFile=path.join(root,'page-verification.json');assert(!fs.existsSync(reportFile),'已有本轮页面验证，不覆盖');
 const report=JSON.parse(fs.readFileSync(path.join(root,'preparation.json'),'utf8')),html=fs.readFileSync(report.html);
 const server=http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html;charset=utf-8'});res.end(html)});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
 try{
  browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1100,height:860}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));await page.goto('http://127.0.0.1:'+server.address().port);
  assert.equal(await page.locator('article').count(),3);assert(await page.locator('#reveal').isDisabled());assert(await page.locator('#export').isDisabled());
  assert.equal(await page.locator('.source:visible').count(),0);
  const initial=await page.locator('body').ariaSnapshot();assert(!initial.includes('IndexTTS')&&!initial.includes('VoiceDesign'));
  await page.locator('audio').first().evaluate(async audio=>{await audio.play();audio.currentTime=Math.max(0,audio.duration-.2)});
  await page.waitForFunction(()=>document.querySelector('audio').ended,null,{timeout:4000});assert(await page.locator('select').first().isDisabled());
  const playback=[];
  for(let index=0;index<3;index++){
   const audio=page.locator('audio').nth(index);await audio.evaluate(async audio=>{audio.currentTime=0;audio.muted=false;await audio.play()});
   await page.waitForFunction(i=>document.querySelectorAll('audio')[i].ended,index,{timeout:20000});
   assert(await page.locator('select').nth(index).isEnabled());
   playback.push(await audio.evaluate(audio=>({ended:audio.ended,duration:audio.duration,error:audio.error?.message||null,muted:audio.muted})));
  }
  await page.locator('audio').nth(0).evaluate(audio=>{audio.currentTime=0;return audio.play()});
  await page.locator('audio').nth(1).evaluate(audio=>{audio.currentTime=0;return audio.play()});
  assert(await page.locator('audio').nth(0).evaluate(audio=>audio.paused));await page.locator('audio').nth(1).evaluate(audio=>audio.pause());
  for(let index=0;index<3;index++){await page.locator('select').nth(index).selectOption('3');await page.locator('textarea').nth(index).fill('自动化表单校验，不是人工听感');}
  assert(await page.locator('#reveal').isEnabled());
  const downloading=page.waitForEvent('download');await page.locator('#export').click();const download=await downloading;
  const file=path.join(root,'automation-form-export-not-human-review.json');await download.saveAs(file);const exported=JSON.parse(fs.readFileSync(file,'utf8'));
  assert.equal(exported.revealedBeforeExport,false);assert.equal(exported.qualityAutomaticallyAccepted,false);assert.equal(Object.keys(exported.reviews).length,3);
  await page.locator('#reveal').click();assert.equal(await page.locator('.source:visible').count(),3);
  await page.locator('#reset').click();assert(await page.locator('#reveal').isDisabled());assert.equal(await page.locator('.source:visible').count(),0);
  const layouts=[];
  for(const viewport of [{width:1100,height:860},{width:390,height:844}]){
   await page.setViewportSize(viewport);
   const geometry=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,cards:[...document.querySelectorAll('article')].map(node=>({left:node.getBoundingClientRect().left,right:node.getBoundingClientRect().right}))}));
   assert(geometry.scrollWidth<=geometry.width);assert(geometry.cards.every(c=>c.left>=0&&c.right<=geometry.width));layouts.push({...viewport,geometry});
   const screenshot=path.resolve('output/playwright/voice-listening-'+viewport.width+'.png');fs.mkdirSync(path.dirname(screenshot),{recursive:true});await page.screenshot({path:screenshot,fullPage:true});
  }
  assert.deepEqual(errors,[]);assert(playback.every(p=>p.ended&&!p.error&&!p.muted));
  const result={at:new Date().toISOString(),browser:'本机Chrome无头模式',sourceHiddenInitially:true,skipToEndRejected:true,fullNativePlayback:playback,onlyOnePlayerAtATime:true,exportCheckedWithAutomationInputs:true,automationScoresAreNotHumanReviews:true,resetClearedScores:true,layouts,pageErrors:errors,humanListeningAccepted:false,naturalnessAccepted:false,characterMatchAccepted:false};
  fs.writeFileSync(reportFile,JSON.stringify(result,null,2),{flag:'wx'});console.log(JSON.stringify(result));
 }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(error);process.exitCode=1});
