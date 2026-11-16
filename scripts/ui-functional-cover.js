async page => {
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.getByRole('button',{name:'生成封面视频',exact:true}).click();
  await page.getByRole('status').filter({hasText:'已生成首帧封面视频'}).waitFor({timeout:60000});
  await page.locator('.steps>button').nth(6).click();
  const video=page.locator('.publish-columns video');
  await video.waitFor();
  await page.waitForFunction(()=>{const v=document.querySelector('.publish-columns video');return v&&Number.isFinite(v.duration)&&v.videoWidth>0;},{},{timeout:15000});
  await video.evaluate(async v=>{v.muted=true;await v.play();});
  await page.waitForFunction(()=>document.querySelector('.publish-columns video')?.currentTime>.25,{},{timeout:10000});
  await video.evaluate(v=>v.pause());
  const playback=await video.evaluate(v=>({duration:v.duration,width:v.videoWidth,height:v.videoHeight,currentTime:v.currentTime,error:v.error?.message||''}));
  if(Math.abs(playback.duration-19.157007)>.12||playback.error)throw new Error('首帧桌面播放器时长或解码错误');
  await page.screenshot({path:'output/playwright/desktop-cover-video-playing.png'});
  const state=await page.evaluate(()=>window.studio.invoke('state'));
  const draft=state.drafts.find(d=>d.id===state.currentId);
  const run=state.runs.find(r=>r.type==='cover-video'&&r.status==='succeeded');
  const report={checkedAt:new Date().toISOString(),runtime:'Electron',draftId:draft.id,coverId:draft.cover.assetId,resultId:draft.publish.videoId,sourceId:draft.edit.sourceId,playback,run,pageErrors:errors,scope:'真实点击生成封面视频并播放；仍待专项解码核对首帧和音轨'};
  await page.evaluate(report=>window.studio.invoke('importFile',{name:'首帧桌面验证.json',base64:btoa(unescape(encodeURIComponent(JSON.stringify(report,null,2))))}),report);
  if(errors.length)throw new Error(errors.join('\n'));
  return report;
}
