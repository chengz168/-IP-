async page => {
  const entries=[['preflight',0],['new',1],['extract',2],['rewrite',3],['voice',4],['avatar',5],['edit',6],['cover',7],['publish',8],['mix',9]];
  for(const [key,index] of entries){
    const src=await page.locator('video').nth(index).evaluate(v=>v.currentSrc);
    const pending=page.waitForEvent('download',{timeout:120000});
    await page.evaluate(async({src,key})=>{
      const response=await fetch(src,{credentials:'include'});if(!response.ok)throw new Error('教程媒体返回HTTP '+response.status);
      const blob=await response.blob(),url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download=key+'.mp4';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
    },{src,key});
    const download=await pending;await download.saveAs('D:/我的智能体/超级IP智能体/evidence/tutorial/audio-study/'+key+'.mp4');
  }
}
