// 核验三版本短片实际播放、互斥与对照页布局，不自动填写质量通过。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const {chromium}=require('C:/Users/DELL/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core');
const root=path.resolve(__dirname,'../evidence/validation/musetalk-detail-20261116');
async function main(){
  const receipt=path.join(root,'review-page-verification.json');assert(!fs.existsSync(receipt),'保留既有验收');
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1100,height:960}}),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(pathToFileURL(path.join(root,'嘴周细节四秒对照.html')).href);
    await page.waitForFunction(()=>document.querySelectorAll('video').length===3&&[...document.querySelectorAll('video')].every(node=>node.readyState>=2));
    const metadata=await page.locator('video').evaluateAll(nodes=>nodes.map(node=>({source:node.currentSrc,duration:node.duration,width:node.videoWidth,height:node.videoHeight,error:node.error?.message||null})));
    assert(metadata.every(node=>!node.error&&Math.abs(node.duration-4)<.05&&node.width===1080&&node.height===1920));
    await page.locator('video').nth(0).evaluate(node=>node.play());
    await page.waitForFunction(()=>document.querySelectorAll('video')[0].currentTime>.1);
    await page.locator('video').nth(1).evaluate(node=>node.play());
    assert(await page.locator('video').nth(0).evaluate(node=>node.paused));
    await page.locator('video').nth(2).evaluate(node=>node.play());
    assert(await page.locator('video').nth(1).evaluate(node=>node.paused));
    await page.locator('#reset').click();
    await page.waitForFunction(()=>[...document.querySelectorAll('video')].every(node=>node.paused&&node.currentTime<.05&&!node.seeking));
    const playbacks=[];
    for(let index=0;index<3;index++){
      const record=await page.locator('video').nth(index).evaluate(node=>new Promise(async(resolve,reject)=>{
        const samples=[],sample=()=>samples.push({time:node.currentTime,rate:node.playbackRate,muted:node.muted,volume:node.volume});
        let seeks=0;const seeking=()=>seeks++;
        node.playbackRate=1;node.muted=false;node.volume=1;
        const timeout=setTimeout(()=>{clearInterval(timer);reject(Error('短片未完整播放结束'))},12000);
        const timer=setInterval(sample,100);
        node.addEventListener('seeking',seeking);
        node.addEventListener('ended',()=>{sample();clearTimeout(timeout);clearInterval(timer);node.removeEventListener('seeking',seeking);resolve({duration:node.duration,samples,seeks,error:node.error?.message||null,ended:node.ended})},{once:true});
        sample();try{await node.play()}catch(error){clearTimeout(timeout);clearInterval(timer);reject(error)}
      }));
      assert.equal(record.ended,true);assert.equal(record.error,null);assert.equal(record.seeks,0);
      assert(record.samples[0].time<.05&&record.samples.at(-1).time>=3.99);
      assert(record.samples.every((item,i)=>item.rate===1&&!item.muted&&item.volume>0&&(i===0||item.time-record.samples[i-1].time<1)));
      playbacks.push({index,...record});
    }
    await page.locator('#reset').click();
    await page.waitForFunction(()=>[...document.querySelectorAll('video')].every(node=>node.currentTime<.05&&!node.seeking&&node.readyState>=2));
    await page.waitForFunction(()=>document.images.length===3&&[...document.images].every(node=>node.complete&&node.naturalWidth>0));
    const layouts=[];
    for(const width of [1100,390]){
      await page.setViewportSize({width,height:960});
      const geometry=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,cards:[...document.querySelectorAll('article')].map(node=>{const r=node.getBoundingClientRect();return{left:r.left,right:r.right}})}));
      assert(geometry.scrollWidth<=width&&geometry.cards.every(card=>card.left>=0&&card.right<=width));
      await page.screenshot({path:path.join(root,'review-page-'+width+'.png'),fullPage:true});layouts.push(geometry);
    }
    assert.deepEqual(errors,[]);
    fs.writeFileSync(receipt,JSON.stringify({at:new Date().toISOString(),metadata,playbacks,playbackMutualExclusion:true,resetAllToStart:true,layouts,pageErrors:errors,humanListeningAccepted:false,continuousFlickerAccepted:false,qualityAccepted:false},null,2),{flag:'wx'});
    console.log(JSON.stringify({fullNativePlayback:playbacks.length,layouts:layouts.length,mediaErrors:0,pageErrors:errors}));
  }finally{await browser.close()}
}
main().catch(error=>{fs.appendFileSync(path.join(root,'review-page-errors.jsonl'),JSON.stringify({at:new Date().toISOString(),error:error.stack})+'\n');console.error(error);process.exitCode=1});
