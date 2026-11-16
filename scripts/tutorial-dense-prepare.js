async page => {
  await page.setViewportSize({width:1920,height:1080});
  await page.getByRole('link',{name:'新版使用教程（新版改版后，只看这一个教程就够了）',exact:true}).click();
  const video=page.locator('video').nth(1);await video.scrollIntoViewIfNeeded();
  await video.evaluate(async v=>{v.muted=true;await v.play();await new Promise(r=>setTimeout(r,400));v.pause();});
  return await page.evaluate(()=>Array.from(document.querySelectorAll('video')).map((v,i)=>({i,src:v.currentSrc,duration:v.duration,rect:{x:v.getBoundingClientRect().x,y:v.getBoundingClientRect().y,width:v.getBoundingClientRect().width,height:v.getBoundingClientRect().height}})));
}
