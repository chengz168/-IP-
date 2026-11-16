async page => {
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
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
