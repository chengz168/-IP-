async page => {
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setViewportSize({width:1400,height:1000});
  await page.getByRole('textbox',{name:'任务名称',exact:true}).fill('本地媒体验证 · 收纳盒');
  await page.getByRole('textbox',{name:'原文案',exact:true}).fill('把零散小物归整好，桌面更清爽。按使用习惯分类收纳，拿取也更方便。');
  await page.waitForTimeout(800);
  await page.getByRole('button',{name:'菜单',exact:true}).click();
  await page.getByRole('button',{name:'设置',exact:true}).click();
  await page.getByRole('textbox').filter({hasText:'不匹配'}).count();
  await page.getByLabel('FFmpeg路径').fill('F:\\Software\\轻语IP智能体\\aigc-human\\resources\\ffmpeg\\bin\\ffmpeg.exe');
  await page.getByLabel('FFprobe路径').fill('F:\\Software\\轻语IP智能体\\aigc-human\\resources\\ffmpeg\\bin\\ffprobe.exe');
  await page.getByRole('button',{name:'保存设置',exact:true}).click();
  await page.getByRole('button',{name:'检查媒体工具',exact:true}).click();
  await page.getByRole('dialog').waitFor();
  await page.screenshot({path:'evidence/implementation/settings-media.png'});
  await page.getByRole('button',{name:'知道了',exact:true}).click();
  await page.getByRole('button',{name:'菜单',exact:true}).click();
  await page.getByRole('button',{name:'新工作流',exact:true}).click();
  for(let i=1;i<7;i++){
    await page.locator('.steps>button').nth(i).click();
    await page.screenshot({path:'evidence/implementation/step-'+(i+1)+'.png'});
  }
  await page.locator('.steps>button').nth(4).click();
  await page.getByRole('button',{name:'修改',exact:true}).click();
  const chooser=page.waitForEvent('filechooser');
  await page.getByRole('button',{name:'导入本地文件',exact:true}).click();
  await (await chooser).setFiles('D:\\我的智能体\\视频测试素材\\收纳盒商品推广视频_19s.mp4');
  await page.getByRole('dialog').waitFor({state:'hidden'});
  await page.getByRole('button',{name:'字幕 已开启',exact:true}).click();
  await page.getByRole('button',{name:'导入 SRT',exact:true}).click();
  const srtChooser=page.waitForEvent('filechooser');
  await page.getByRole('button',{name:'导入本地文件',exact:true}).click();
  await (await srtChooser).setFiles('D:\\我的智能体\\超级IP智能体\\evidence\\validation\\验收字幕.srt');
  await page.getByRole('button',{name:'保存字幕',exact:true}).click();
  await page.getByRole('checkbox',{name:'启用标题',exact:true}).check();
  await page.locator('.edit-nav>button').nth(1).click();
  await page.getByLabel('主标题',{exact:true}).fill('桌面收纳，让小物各归其位');
  await page.getByRole('button',{name:'剪辑视频',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('.operation-status'),{},{timeout:120000});
  const result=await page.locator('.step-status').innerText();
  if(!result.includes('已生成'))throw new Error('剪辑未完成：'+result+' / '+await page.locator('.toast').innerText().catch(()=>''));
  const video=page.locator('.edit-preview video');
  await video.evaluate(async v=>{v.muted=true;await v.play();});
  await page.waitForTimeout(1000);await video.evaluate(v=>v.pause());
  await page.screenshot({path:'evidence/implementation/05-rendered.png'});
  console.log(JSON.stringify({pageErrors:errors,renderStatus:result,video:await video.evaluate(v=>({duration:v.duration,width:v.videoWidth,height:v.videoHeight,currentTime:v.currentTime,error:v.error?.message||''}))}));
}
