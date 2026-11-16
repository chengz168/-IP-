async page => {
  const audio=page.locator('audio').first();await audio.evaluate(a=>a.load());
  await page.waitForFunction(()=>{const a=document.querySelector('audio');return a&&Number.isFinite(a.duration)&&a.duration>0;},{},{timeout:15000});
  await audio.evaluate(async a=>{a.muted=true;a.currentTime=5;await a.play();});await page.waitForTimeout(1200);await audio.evaluate(a=>a.pause());
  const playback=await audio.evaluate(a=>({duration:a.duration,currentTime:a.currentTime,error:a.error?.message||''}));
  if(playback.error||playback.currentTime<6)throw new Error('系统朗读定位或播放失败');
  await page.screenshot({path:'evidence/implementation/desktop-system-speech.png'});
  const report={checkedAt:new Date().toISOString(),runtime:'Electron',voice:'Microsoft Huihui Desktop',playback,seekVerified:true,scope:'通过界面生成后验证WAV有限时长、跳转5秒与静音播放；主观音质及克隆未验收'};
  await page.evaluate(report=>window.studio.invoke('importFile',{name:'系统朗读时长修复验证.json',base64:btoa(unescape(encodeURIComponent(JSON.stringify(report,null,2))))}),report);
}
