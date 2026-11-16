async page => {
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const menu=async name=>{await page.getByRole('button',{name:'菜单',exact:true}).click();await page.getByRole('button',{name,exact:true}).click();};
  await menu('设置');await page.getByRole('button',{name:'模型设置',exact:true}).click();
  await page.getByRole('combobox',{name:'语音接入',exact:true}).selectOption('windows');
  await page.getByRole('button',{name:'读取本机系统音色',exact:true}).click();
  await page.getByRole('combobox',{name:'系统音色',exact:true}).selectOption('Microsoft Huihui Desktop');
  await page.getByRole('button',{name:'保存设置',exact:true}).click();
  await menu('新工作流');await page.locator('.steps>button').nth(1).click();
  await page.getByRole('button',{name:'确认使用',exact:true}).click();
  await page.locator('.steps>button').nth(2).click();
  await page.getByRole('button',{name:'生成声音',exact:true}).click();
  await page.waitForFunction(async()=>{const s=await window.studio.invoke('state');const d=s.drafts.find(d=>d.id===s.currentId);return !!d.voice.audioId;},{},{timeout:60000});
  const audio=page.locator('audio').first();await audio.evaluate(async a=>{a.muted=true;await a.play();});await page.waitForTimeout(1200);await audio.evaluate(a=>a.pause());
  const playback=await audio.evaluate(a=>({duration:a.duration,currentTime:a.currentTime,error:a.error?.message||''}));
  if(playback.currentTime<=0||playback.error||errors.length)throw new Error('系统朗读桌面播放失败');
  await page.screenshot({path:'evidence/implementation/desktop-system-speech.png'});
  const report={checkedAt:new Date().toISOString(),runtime:'Electron',voice:'Microsoft Huihui Desktop',playback,pageErrors:errors,scope:'通过界面生成与静音播放真实系统朗读；音质和声音克隆未验收'};
  await page.evaluate(report=>window.studio.invoke('importFile',{name:'系统朗读桌面验证.json',base64:btoa(unescape(encodeURIComponent(JSON.stringify(report,null,2))))}),report);
}
