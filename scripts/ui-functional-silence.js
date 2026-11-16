async page => {
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  if(!await page.getByText('上次检测：',{exact:false}).count())await page.getByRole('button',{name:'检测气口并预估时长',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('.operation-status')&&document.querySelector('.stage-body')?.textContent.includes('上次检测：'),{},{timeout:30000});
  await page.screenshot({path:'output/playwright/desktop-silence-analysis.png'});
  await page.getByRole('button',{name:'剪辑视频',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('.operation-status')&&document.querySelector('.step-status')?.textContent.includes('剪辑结果 已生成'),{},{timeout:60000});
  const video=page.locator('.edit-preview video');
  await page.waitForFunction(()=>{const v=document.querySelector('.edit-preview video');return v&&Number.isFinite(v.duration)&&v.videoWidth>0;},{},{timeout:15000});
  await video.evaluate(async v=>{v.muted=true;await v.play();});
  await page.waitForFunction(()=>document.querySelector('.edit-preview video')?.currentTime>.2,{},{timeout:10000});
  await video.evaluate(v=>v.pause());
  const playback=await video.evaluate(v=>({duration:v.duration,currentTime:v.currentTime,width:v.videoWidth,height:v.videoHeight,error:v.error?.message||''}));
  if(Math.abs(playback.duration-3.466667)>.1||playback.error)throw new Error('剪气口桌面输出时长或播放异常');
  const state=await page.evaluate(()=>window.studio.invoke('state'));
  const draft=state.drafts.find(d=>d.id===state.currentId);
  const run=state.runs.find(r=>r.type==='render'&&r.draftId===draft.id&&r.status==='succeeded');
  if(!run?.output?.timeline||run.output.renderedCaptions.length!==2)throw new Error('缺少实际裁切时轴或字幕重映射');
  await page.screenshot({path:'output/playwright/desktop-silence-playing.png'});
  const report={checkedAt:new Date().toISOString(),runtime:'Electron',draftId:draft.id,resultId:draft.edit.resultId,sourceId:draft.edit.sourceId,playback,runId:run.id,timeline:run.output.timeline,renderedCaptions:run.output.renderedCaptions,pageErrors:errors,scope:'真实画面、系统朗读和人工静音样本，桌面点击分析与剪辑后播放；未验收全部自然气口或主观音质'};
  await page.evaluate(report=>window.studio.invoke('importFile',{name:'剪气口桌面验证.json',base64:btoa(unescape(encodeURIComponent(JSON.stringify(report,null,2))))}),report);
  if(errors.length)throw new Error(errors.join('\n'));
  return report;
}
