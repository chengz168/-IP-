const fs=require('node:fs');
const path=require('node:path');
module.exports=async function auditLayout(page,label){
  const root=path.resolve('evidence/validation/layout-'+label);fs.mkdirSync(root,{recursive:true});const pages=[],errors=[];
  const onError=e=>errors.push(e.message);page.on('pageerror',onError);
  async function capture(name){
    await page.mouse.move(700,30);
    // 关闭本次操作提示并等待真实画布和模板，截图不能把加载占位当成最终页面。
    const notice=page.getByRole('button',{name:'关闭提示',exact:true});if(await notice.count())await notice.click();
    if(await page.locator('.cover-editor-full').count()){
      await page.waitForFunction(()=>!document.querySelector('.cover-painting'));
      if(await page.locator('.cover-templates').count())await page.waitForFunction(()=>{const images=[...document.querySelectorAll('.cover-template-select>img')];return images.length===15&&images.every(i=>i.complete&&i.naturalWidth>0);},null,{timeout:60000});
    }
    // 等待字体和媒体元数据后的两次绘制，避免把页面切换中的位置当成最终布局。
    await page.evaluate(async()=>{await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
    const metrics=await page.evaluate(()=>{
      const box=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
      const visible=e=>e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden';
      const panels=[...document.querySelectorAll('.stage-body,.management-page,.legacy-page,.edit-columns,.cover-layout,.modal-body,.pip-editor,.settings-body,.settings-nav,.brain-form,.brain-fields,.creation-form,.edit-controls')].filter(visible).map(e=>({selector:e.className,...box(e),clientWidth:e.clientWidth,scrollWidth:e.scrollWidth,clientHeight:e.clientHeight,scrollHeight:e.scrollHeight}));
      const pairs=[...document.querySelectorAll('.two-fields')].filter(visible).map(e=>[...e.children].map(c=>c.matches('label,.word-limit-control')?c.querySelector('input,select,textarea,.studio-select-trigger'):null).filter(Boolean).filter(visible).map(box)).filter(p=>p.length===2);
      const textBoxes=[...document.querySelectorAll('.rewrite-columns>.text-card>.large-text')].filter(visible).map(box);
      const issues=[];
      const voiceHeading=document.querySelector('.voice-columns>.text-card>.card-heading>h3');
      if(voiceHeading&&visible(voiceHeading)&&voiceHeading.clientHeight>parseFloat(getComputedStyle(voiceHeading).lineHeight)+1)issues.push({kind:'voice-heading-wrap',box:box(voiceHeading)});
      const canvas=document.querySelector('.cover-canvas-stack>canvas');
      if(canvas&&visible(canvas)){const r=box(canvas);if(r.height<240||r.width<135||Math.abs(r.width/r.height-9/16)>.01)issues.push({kind:'cover-canvas-unusable',box:r});}
      for(const p of panels)if(p.scrollWidth-p.clientWidth>2)issues.push({kind:'horizontal-overflow',panel:p.selector,overflow:p.scrollWidth-p.clientWidth});
      // 检查控件文字本身，避免只有外框未溢出、里面的按钮文字却已经裁掉。
      for(const button of [...document.querySelectorAll('button')].filter(visible)){
        if(button.clientWidth&&button.scrollWidth-button.clientWidth>2)issues.push({kind:'button-content-overflow',text:button.textContent.trim().slice(0,60),overflow:button.scrollWidth-button.clientWidth});
        const bounds=box(button),walker=document.createTreeWalker(button,NodeFilter.SHOW_TEXT);let node;
        while(node=walker.nextNode())if(node.textContent.trim()){
          let owner=node.parentElement,ellipsis=false;while(owner&&owner!==button){const style=getComputedStyle(owner);if(style.textOverflow==='ellipsis'&&style.overflowX==='hidden'){ellipsis=true;break;}owner=owner.parentElement;}if(ellipsis)continue;
          const range=document.createRange();range.selectNodeContents(node);const text=range.getBoundingClientRect();
          if(text.width&&text.height&&(text.left<bounds.x-1||text.right>bounds.right+1||text.top<bounds.y-1||text.bottom>bounds.bottom+1)){issues.push({kind:'button-text-outside',text:node.textContent.trim().slice(0,60),button:bounds,textBox:{x:text.x,y:text.y,width:text.width,height:text.height}});break;}
        }
      }
      for(const [index,pair] of pairs.entries())if(Math.abs(pair[0].y-pair[1].y)>1)issues.push({kind:'paired-field-top',index,delta:pair[0].y-pair[1].y});
      if(textBoxes.length===2&&(Math.abs(textBoxes[0].y-textBoxes[1].y)>1||Math.abs(textBoxes[0].bottom-textBoxes[1].bottom)>1))issues.push({kind:'rewrite-box-alignment',textBoxes});
      if(document.documentElement.scrollWidth>innerWidth+1)issues.push({kind:'window-horizontal-overflow'});
      for(const dialog of [...document.querySelectorAll('.modal')].filter(visible)){const r=box(dialog);if(r.x<0||r.right>innerWidth+1||r.y<0||r.bottom>innerHeight+1)issues.push({kind:'dialog-outside-window',box:r});}
      for(const radio of [...document.querySelectorAll('.settings-body input[type=radio]')].filter(visible)){const r=box(radio);if(Math.abs(r.width-r.height)>1)issues.push({kind:'radio-not-square',box:r});}
      // 面板内部滚动时，固定的提交操作仍须完整处于卡片内。
      const brainButton=document.querySelector('.brain-form>.primary');
      if(brainButton&&visible(brainButton)){const r=box(brainButton),p=box(brainButton.parentElement);if(r.y<p.y||r.bottom>p.bottom+1)issues.push({kind:'brain-action-clipped',button:r,panel:p});}
      const footer=document.querySelector('.workflow-footer');if(footer&&box(footer).bottom>innerHeight)issues.push({kind:'footer-outside-window'});
      // 步骤数字、图标和名称应共用行中心，而不是分别靠自身外边距对齐。
      for(const step of [...document.querySelectorAll('.steps>button')].filter(visible)){
        const bounds=box(step),centers=[...step.children].map(child=>{const r=box(child);return r.y+r.height/2;});
        if(centers.some(center=>Math.abs(center-bounds.y-bounds.height/2)>1))issues.push({kind:'step-content-center',text:step.textContent.trim(),centers,box:bounds});
      }
      const workflowStatus=document.querySelector('.workflow-main>.workflow-job-status'),stage=document.querySelector('.workflow-main>.stage-body');
      if(workflowStatus&&stage&&visible(workflowStatus)&&box(workflowStatus).y-box(stage).bottom<11)issues.push({kind:'workflow-status-no-gap',gap:box(workflowStatus).y-box(stage).bottom});
      return {window:{width:innerWidth,height:innerHeight},panels,pairs,textBoxes,issues};
    });
    const file=path.join(root,name+'.png');await page.screenshot({path:file});pages.push({name,file,...metrics});
    fs.writeFileSync(path.join(root,'report.json'),JSON.stringify({checkedAt:new Date().toISOString(),label,pages,pageErrors:errors,scope:'逐页布局边界、双列字段、改写框对齐与截图；不代表与原图像素一致'},null,2));
  }
  async function menu(name){await page.getByRole('button',{name:'菜单',exact:true}).click();await page.getByRole('navigation',{name:'主菜单'}).getByRole('button',{name,exact:true}).click();}
  await menu('新工作流');await page.locator('.steps>button').nth(0).click();
  for(const [tab,name] of [['提取文案','01-extract'],['IP大脑','02-brain'],['爆款选题','03-topic'],['营销文案','04-marketing']]){await page.locator('.main-tabs').getByRole('button',{name:tab,exact:true}).click();await capture(name);}
  for(const [step,name] of [[1,'05-rewrite'],[2,'06-voice'],[3,'07-video']]){await page.locator('.steps>button').nth(step).click();await capture(name);}
  await page.getByRole('button',{name:'多镜头',exact:true}).click();await capture('08-video-multi');await page.getByRole('button',{name:'单形象',exact:true}).click();
  await page.locator('.steps>button').nth(4).click();
  for(const [tab,name] of [['音视频参数','09-edit-params'],['标题','10-edit-title'],['字幕','11-edit-subtitles'],['个人名片','12-edit-card'],['音效','13-edit-sfx'],['背景音乐','14-edit-bgm'],['画中画混剪','15-edit-pip']]){await page.locator('.edit-nav>button').filter({hasText:tab}).click();if(tab==='画中画混剪'){await page.getByRole('checkbox',{name:'启用画中画混剪',exact:true}).check();await page.locator('.pip-settings-advanced>summary').click();await page.getByRole('combobox',{name:'画中画模式',exact:true}).selectOption('captions');}await capture(name);}
  await page.getByRole('button',{name:'自定义画中画',exact:true}).click();await capture('16-pip-modal');await page.getByRole('dialog',{name:'自定义画中画'}).getByRole('button',{name:'取消',exact:true}).click();
  await page.getByRole('button',{name:'编辑字幕',exact:true}).click();await capture('16b-captions-modal');await page.getByRole('dialog',{name:'编辑字幕'}).getByRole('button',{name:'关闭弹窗',exact:true}).click();
  await page.getByRole('button',{name:'修改',exact:true}).click();await capture('16c-source-picker');await page.getByRole('dialog').getByRole('button',{name:'关闭弹窗',exact:true}).click();
  await page.locator('.steps>button').nth(5).click();await capture('17-cover');
  for(const [tab,name] of [['封面来源','18-cover-source'],['文本图层','19-cover-text'],['遮罩','20-cover-mask']]){await page.getByRole('tablist',{name:'封面选项',exact:true}).getByRole('tab',{name:tab,exact:true}).click();await capture(name);}
  await page.locator('.steps>button').nth(6).click();await capture('21-publish');
  await menu('旧工作流');await capture('22-legacy');
  await page.locator('.legacy-page').evaluate(e=>e.scrollTop=e.scrollHeight);await capture('22b-legacy-bottom');
  for(const [tab,name] of [['声音管理','23-voices'],['形象管理','24-avatars'],['素材管理','25-assets'],['账号管理','26-accounts'],['任务中心','27-tasks'],['设置','28-settings-general']]){await menu(tab);await capture(name);}
  for(const [tab,name] of [['模型设置','29-settings-models'],['提示词管理','30-settings-prompts'],['数据设置','31-settings-data'],['软件更新','32-settings-update']]){await page.locator('.settings-nav').getByRole('button',{name:tab,exact:true}).click();await capture(name);}
  await menu('帮助');await capture('33-help');

  await menu('声音管理');
  await page.getByRole('button',{name:'直接录音',exact:true}).click();await capture('34-voice-record-idle');
  await page.getByRole('button',{name:'上传音频',exact:true}).click();
  await page.locator('.resource-library-heading').getByRole('button',{name:'添加',exact:true}).click();await capture('35-voice-add-modal');await page.keyboard.press('Escape');
  await menu('形象管理');await page.locator('.resource-library-heading').getByRole('button',{name:'添加',exact:true}).click();await capture('36-avatar-add-modal');await page.keyboard.press('Escape');
  await menu('素材管理');await page.getByRole('button',{name:'新建分类',exact:true}).click();await capture('37-asset-category-modal');await page.keyboard.press('Escape');
  await menu('账号管理');await page.getByRole('button',{name:'添加账号',exact:true}).click();await capture('38-account-add-modal');await page.keyboard.press('Escape');
  await menu('任务中心');
  if(await page.locator('.draft-task-table').getByRole('button',{name:'详情',exact:true}).count()){
    await page.locator('.draft-task-table').getByRole('button',{name:'详情',exact:true}).first().click();await capture('39a-task-detail-top');
    const detail=page.getByRole('dialog',{name:'任务详情',exact:true});
    await detail.locator('.modal-body').evaluate(e=>e.scrollTop=e.scrollHeight);await capture('39b-task-detail-bottom');
    if(await detail.getByRole('button',{name:'查看执行',exact:true}).count()){await detail.getByRole('button',{name:'查看执行',exact:true}).first().click();await capture('39c-task-detail-execution');await page.keyboard.press('Escape');}
    await detail.getByRole('button',{name:'关闭',exact:true}).click();
  }
  await page.getByRole('button',{name:'执行记录',exact:true}).click();await capture('39-task-runs');
  if(await page.getByRole('button',{name:'详情',exact:true}).count()){await page.getByRole('button',{name:'详情',exact:true}).first().click();await capture('40-task-details-modal');await page.keyboard.press('Escape');}
  await menu('设置');await page.locator('.settings-nav').getByRole('button',{name:'常规设置',exact:true}).click();
  await page.locator('.settings-body').evaluate(e=>e.scrollTop=e.scrollHeight);await capture('41-settings-general-bottom');
  await page.locator('.settings-nav').getByRole('button',{name:'模型设置',exact:true}).click();
  await page.locator('.settings-body').evaluate(e=>e.scrollTop=e.scrollHeight);await capture('42-settings-models-bottom');
  await page.locator('.settings-nav').getByRole('button',{name:'提示词管理',exact:true}).click();await page.getByRole('button',{name:'编辑',exact:true}).first().click();await capture('43-settings-prompt-editor');
  await page.getByRole('button',{name:'取消',exact:true}).click();

  page.off('pageerror',onError);
  const issues=pages.flatMap(p=>p.issues.map(i=>({page:p.name,...i})));
  return {label,pages:pages.length,issues,pageErrors:errors,report:path.join(root,'report.json')};
};
