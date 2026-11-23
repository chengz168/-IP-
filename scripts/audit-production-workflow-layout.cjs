const fs=require('node:fs'),path=require('node:path');

// 仅切换页面与展开面板，不点击生成、导入、删除或平台发布按钮。
module.exports=async function auditProductionWorkflowLayout(page,{directory,width,height}={}){
 if(!path.isAbsolute(directory))throw Error('布局证据目录必须为绝对路径');
 fs.mkdirSync(directory,{recursive:true});
 const pages=[],pageErrors=[];
 const errorHandler=error=>pageErrors.push(error.message);page.on('pageerror',errorHandler);
 async function capture(name){
  await page.evaluate(async()=>{await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
  const result=await page.evaluate(()=>{
   const shown=element=>element.getClientRects().length&&getComputedStyle(element).visibility!=='hidden';
   const box=element=>{const r=element.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
   const issues=[],panels=[];
   const selectors=['.stage-body','.story-studio','.story-toolbar','.product-studio','.creative-presets-body','.reference-analysis','.settings-body','.modal-body','.workflow-footer','.page-navigation'];
   for(const selector of selectors)for(const element of [...document.querySelectorAll(selector)].filter(shown)){
    const bounds=box(element),overflow=element.scrollWidth-element.clientWidth;
    panels.push({selector,...bounds,clientWidth:element.clientWidth,scrollWidth:element.scrollWidth,clientHeight:element.clientHeight,scrollHeight:element.scrollHeight,overflowY:getComputedStyle(element).overflowY});
    if(overflow>2)issues.push({kind:'horizontal-overflow',selector,overflow});
   }
   for(const button of [...document.querySelectorAll('button,summary')].filter(shown)){
    const style=getComputedStyle(button),bounds=box(button);
    // 有明确省略号的资源名称可缩略，完整操作文字不能被边界裁掉。
    if(style.textOverflow!=='ellipsis'&&button.clientWidth&&button.scrollWidth-button.clientWidth>2)issues.push({kind:'action-text-overflow',text:button.textContent.trim().slice(0,90),overflow:button.scrollWidth-button.clientWidth});
    if(button.closest('.workflow-footer,.page-navigation')&&(bounds.x<0||bounds.right>innerWidth+1||bounds.y<0||bounds.bottom>innerHeight+1))issues.push({kind:'navigation-outside-window',text:button.textContent.trim(),...bounds});
   }
   for(const dialog of [...document.querySelectorAll('[role=dialog]')].filter(shown)){const bounds=box(dialog);if(bounds.x<0||bounds.right>innerWidth+1||bounds.y<0||bounds.bottom>innerHeight+1)issues.push({kind:'dialog-outside-window',...bounds});}
   if(document.documentElement.scrollWidth>innerWidth+1)issues.push({kind:'window-horizontal-overflow',overflow:document.documentElement.scrollWidth-innerWidth});
   return{window:{width:innerWidth,height:innerHeight},panels,issues};
  });
  const file=path.join(directory,name+'.png');await page.screenshot({path:file});pages.push({name,file,...result});
  fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify({at:new Date().toISOString(),expectedWindow:{width,height},pages,pageErrors,scope:'真实界面导航、展开状态、横向溢出与操作边界；不代表全业务生成或原版像素一致'},null,2));
 }
 async function menu(name){await page.getByRole('button',{name:'菜单',exact:true}).click();await page.getByRole('navigation',{name:'主菜单'}).getByRole('button',{name,exact:true}).click();}
 async function expandPresets(name){const preset=page.locator('.creative-presets').first();if(await preset.count()){await preset.locator(':scope>summary').click();await capture(name);await preset.locator(':scope>summary').click();}}
 try{
  await menu('新工作流');await page.locator('.steps>button').nth(0).click();
  for(const [label,name]of[['提取文案','01-extract'],['视频拆解','02-reference'],['商品宣传','03-product'],['IP大脑','04-brain'],['爆款选题','05-topic'],['营销文案','06-marketing']]){
   await page.locator('.main-tabs').getByRole('button',{name:label,exact:true}).click();await capture(name);await expandPresets(name+'-presets');
  }
  for(const [index,name]of[[1,'07-rewrite'],[2,'08-voice'],[3,'09-avatar']]){await page.locator('.steps>button').nth(index).click();await capture(name);}
  for(const [label,name]of[['多镜头口播','10-avatar-multi'],['非口播创作','11-story'],['商品宣传','12-product-video']]){
   await page.getByRole('tablist',{name:'视频创作方式'}).getByRole('tab',{name:label,exact:true}).click();await capture(name);
   if(label==='非口播创作'){
    for(const [tab,suffix]of[['资产图片','assets'],['镜头视频','videos'],['分集分镜','episodes']]){await page.getByRole('tablist',{name:'非口播制作阶段'}).getByRole('tab',{name:tab,exact:true}).click();await capture(name+'-'+suffix);}
    await expandPresets(name+'-presets');
   }
  }
  await page.locator('.steps>button').nth(4).click();
  for(const [label,name]of[['音视频参数','13-edit'],['标题','14-title'],['字幕','15-subtitles'],['个人名片','16-namecard'],['背景音乐','17-bgm'],['音效','18-sfx'],['画中画混剪','19-pip']]){await page.locator('.edit-nav-select').filter({hasText:label}).click();await capture(name);}
  for(const [index,name]of[[5,'20-cover'],[6,'21-publish']]){await page.locator('.steps>button').nth(index).click();await capture(name);}
  for(const [label,name]of[['旧工作流','22-legacy'],['声音管理','23-voices'],['形象管理','24-avatars'],['素材管理','25-materials'],['账号管理','26-accounts'],['任务中心','27-tasks'],['设置','28-settings']]){await menu(label);await capture(name);}
  for(const [label,name]of[['模型设置','29-models'],['提示词管理','30-prompts'],['数据设置','31-data'],['软件更新','32-update']]){await page.locator('.settings-nav').getByRole('button',{name:label,exact:true}).click();await capture(name);}
  await menu('帮助');await capture('33-help');
  await page.getByRole('button',{name:'返回设置',exact:true}).click();await capture('34-return-settings');
 }finally{page.off('pageerror',errorHandler);}
 return{pages:pages.length,pageErrors,issues:pages.flatMap(item=>item.issues.map(issue=>({page:item.name,...issue}))),directory};
};
