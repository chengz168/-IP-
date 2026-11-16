async page => {
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const before=await page.evaluate(()=>window.studio.invoke('state'));
  if(!before.drafts.some(d=>d.title==='本地媒体验证 · 收纳盒'))throw new Error('桌面未恢复已保存任务');
  const menu=async name=>{await page.getByRole('button',{name:'菜单',exact:true}).click();await page.getByRole('button',{name,exact:true}).click();};
  for(let i=0;i<7;i++){await page.locator('.steps>button').nth(i).click();await page.screenshot({path:'evidence/implementation/desktop-step-'+(i+1)+'.png'});}
  const video=page.locator('.publish-columns video');
  await video.evaluate(async v=>{v.muted=true;await v.play();});await page.waitForTimeout(1500);await video.evaluate(v=>v.pause());
  const playback=await video.evaluate(v=>({duration:v.duration,width:v.videoWidth,height:v.videoHeight,currentTime:v.currentTime,error:v.error?.message||''}));
  if(playback.currentTime<=0||playback.error)throw new Error('桌面媒体播放失败');
  const originalDraftId=before.currentId;
  await menu('声音管理');await page.screenshot({path:'evidence/implementation/desktop-voices.png'});
  await menu('形象管理');await page.screenshot({path:'evidence/implementation/desktop-avatars.png'});
  await menu('素材管理');await page.screenshot({path:'evidence/implementation/desktop-assets.png'});
  await menu('任务中心');await page.getByRole('button',{name:'执行记录',exact:true}).click();await page.screenshot({path:'evidence/implementation/desktop-tasks.png'});
  await menu('设置');for(const name of ['模型设置','提示词管理','数据设置','软件更新']){await page.locator('.settings-nav').getByRole('button',{name,exact:true}).click();}
  await menu('旧工作流');await page.locator('.legacy-grid').waitFor();await page.screenshot({path:'evidence/implementation/desktop-legacy.png'});
  const after=await page.evaluate(()=>window.studio.invoke('state'));if(after.currentId!==originalDraftId||after.runs.length!==before.runs.length)throw new Error('切换视图意外新增任务或执行');
  await menu('新工作流');await page.locator('.steps>button').nth(5).click();
  const report={runtime:'Electron',pageErrors:errors,restoredDraftId:originalDraftId,viewSwitchPreservedTask:true,noDuplicateRuns:true,playback,keyConfigured:after.keyConfigured,runCount:after.runs.length};
  await page.evaluate(async report=>{await window.studio.invoke('importFile',{name:'桌面验证结果.json',base64:btoa(unescape(encodeURIComponent(JSON.stringify(report,null,2))))});},report);
  if(errors.length)throw new Error(errors.join('\n'));
}
