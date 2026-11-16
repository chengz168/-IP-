async page => {
  const src=await page.locator('video').nth(2).evaluate(v=>v.currentSrc),pending=page.waitForEvent('download',{timeout:60000});
  await page.evaluate(async src=>{const r=await fetch(src,{credentials:'include'});if(!r.ok)throw new Error('教程媒体返回HTTP '+r.status);const url=URL.createObjectURL(await r.blob()),a=document.createElement('a');a.href=url;a.download='extract.mp4';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);},src);
  const download=await pending;await download.saveAs('D:/我的智能体/超级IP智能体/evidence/tutorial/audio-study/extract.mp4');
}
