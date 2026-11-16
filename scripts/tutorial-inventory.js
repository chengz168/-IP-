async page => {
  // 用目录中已经核对过的链接定位各教程，再记录页面实际提供的媒体信息。
  const sections = [
    ['preflight', '使用前必看'],
    ['new', '新版使用教程（新版改版后，只看这一个教程就够了）'],
    ['extract', '1. 如何提取文案'],
    ['rewrite', '2. 如何改写内容'],
    ['voice', '3. 如何克隆声音'],
    ['avatar', '4. 如何生成数字人'],
    ['edit', '5. 如何剪辑视频'],
    ['cover', '6. 如何生成封面和标题'],
    ['publish', '7. 如何自动发布视频'],
    ['mix', '8. 素材混剪模块使用']
  ];
  const inventory=[];
  await page.setViewportSize({width:1920,height:1080});
  await page.addStyleTag({content:'xg-start {visibility:hidden!important}'});
  for(const [key,name] of sections) {
    const link = page.getByRole('link',{name,exact:true});
    const anchor = await link.getAttribute('href');
    await link.click();
    await page.waitForTimeout(500);
    const media = await page.evaluate(anchor=>{
      const heading = document.getElementById(anchor.slice(1)) || document.querySelector('[data-block-id="'+anchor.slice(1)+'"]');
      const videos=Array.from(document.querySelectorAll('video'));
      const top=heading?.getBoundingClientRect().top ?? 0;
      return videos.map((v,index)=>({index,top:v.getBoundingClientRect().top,src:v.currentSrc,duration:v.duration,title:v.closest('xgplayer')?.textContent})).filter(v=>v.top>=top-20).sort((a,b)=>a.top-b.top)[0];
    },anchor);
    if(!media){inventory.push({key,name,error:'未找到对应视频'});continue;}
    const video=page.locator('video').nth(media.index);
    await video.evaluate(async v=>{v.muted=true;await v.play();await new Promise(r=>setTimeout(r,350));v.pause();});
    const times=key==='new'?[60,150,300,450,600,750,900,1050]:Array.from({length:Math.ceil(media.duration/20)},(_,i)=>i*20);
    for(const time of times){
      await video.evaluate((v,t)=>new Promise(resolve=>{v.addEventListener('seeked',resolve,{once:true});v.currentTime=Math.min(t+0.2,v.duration-0.2);setTimeout(resolve,7000);}),time);
      await video.screenshot({path:'D:/我的智能体/超级IP智能体/evidence/tutorial/desktop-video-samples/'+key+'-'+String(time).padStart(4,'0')+'.png'});
    }
    inventory.push({key,name,...media,times});
  }
  return inventory;
}
