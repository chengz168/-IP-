const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const {chromium}=require('C:/Users/DELL/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core');
const root=path.resolve('evidence/validation/dynamic-subtitles'),fixture=JSON.parse(fs.readFileSync(path.join(root,'desktop-fixture.json'))),stateFile=path.join(fixture.workspace,'studio.json');
const read=()=>JSON.parse(fs.readFileSync(stateFile,'utf8')),draft=()=>read().drafts.find(d=>d.id===fixture.id);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function disk(predicate){for(let i=0;i<160;i++){const state=read();if(predicate(state))return state;await sleep(50);}throw new Error('动态字幕参数未在8秒内落盘');}
async function menu(page,name){await page.getByRole('button',{name:'菜单',exact:true}).click();await page.getByRole('navigation',{name:'主菜单'}).getByRole('button',{name,exact:true}).click();}
async function workflow(page){await menu(page,'新工作流');await page.locator('.steps>button').nth(4).click();await page.locator('.edit-nav').getByRole('button',{name:'字幕',exact:false}).click();}
async function font(page,id){const labels={compact:'紧凑',standard:'标准',comfortable:'舒适',large:'大'};await menu(page,'设置');await page.getByRole('group',{name:'界面字号',exact:true}).getByRole('button',{name:labels[id],exact:true}).click();await page.waitForFunction(id=>document.documentElement.dataset.fontSize===id,id);await page.waitForFunction(()=>!document.querySelector('.operation-status'));await workflow(page);}
async function capture(page,name){const close=page.getByRole('button',{name:'关闭提示',exact:true});if(await close.count())await close.click();await page.mouse.move(10,30);await page.screenshot({path:path.join(root,name+'.png')});}
async function geometry(page){return page.locator('.subtitle-panel').evaluate(element=>{
  const box=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};},issues=[];
  const panel=box(element),scroll=box(element.querySelector('.subtitle-panel-scroll')),grid=element.querySelector('.subtitle-template-grid'),cards=[...grid.children].map(box),gap=parseFloat(getComputedStyle(grid).gap);
  if(element.scrollWidth>element.clientWidth+1)issues.push('字幕面板横向溢出');
  if(Math.abs(gap-10)>1)issues.push('模板间距不为10px');
  for(let i=0;i<cards.length;i+=2){if(Math.abs(cards[i].y-cards[i+1].y)>1)issues.push('同排卡片顶部未对齐');if(Math.abs(cards[i].width-cards[i+1].width)>1)issues.push('两列模板不等宽');if(Math.abs(cards[i+1].x-cards[i].right-10)>1)issues.push('两列卡片间距错误');if(cards[i].x<scroll.x||cards[i+1].right>scroll.right+1)issues.push('卡片超出滚动面板');}
  const visible=[...element.querySelectorAll('button,input')].filter(e=>{const r=box(e);return r.bottom>scroll.y&&r.y<scroll.bottom;});
  for(const control of visible){const r=box(control);if(r.right>panel.right+1||r.x<panel.x-1)issues.push('可见控件横向越界');}
  for(const button of document.querySelectorAll('.footer-actions>button')){const r=box(button),top=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);if(!button.contains(top))issues.push('流程页脚按钮被遮挡');}
  for(const summary of document.querySelectorAll('.edit-nav>button small'))if(summary.scrollWidth>summary.clientWidth+1)issues.push('左侧摘要文本横向溢出');
  return {panel,scroll,cards,gap,issues};
});}
async function main(){
  const browser=await chromium.connectOverCDP('http://127.0.0.1:9333'),page=browser.contexts()[0].pages()[0],report={checkedAt:new Date().toISOString(),assertions:[],layouts:[],pageErrors:[]};page.on('pageerror',e=>report.pageErrors.push(e.message));
  page.setDefaultTimeout(15000);
  const templates=(await import('../server/subtitle-templates.mjs')).subtitleTemplates;
  try{
    await workflow(page);await page.getByRole('group',{name:'字幕模式'}).getByRole('button',{name:'模板',exact:true}).click();
    assert.equal(await page.locator('.subtitle-template-card').count(),22);
    if(process.argv[2]==='layouts'){
      const handle=Number(process.argv[3]);assert.ok(handle);
      for(const [width,height]of [[1400,1000],[1100,760]]){
        const resized=spawnSync('python',['scripts/resize-desktop.py','--handle',String(handle),'--width',String(width),'--height',String(height)],{encoding:'utf8'});assert.equal(resized.status,0);
        await page.waitForFunction(size=>innerWidth===size[0]&&innerHeight===size[1],[width,height]);
        for(const size of ['compact','standard','comfortable','large']){
          await font(page,size);await page.locator('.subtitle-panel-scroll').evaluate(e=>e.scrollTop=0);await capture(page,`${width}-${size}-template-top`);const top=await geometry(page);assert.deepEqual(top.issues,[]);report.layouts.push({width,height,size,state:'top',...top});
          await page.getByRole('button',{name:'红白双语',exact:true}).scrollIntoViewIfNeeded();await page.getByLabel('模板上下位置',{exact:true}).scrollIntoViewIfNeeded();await capture(page,`${width}-${size}-template-bottom`);const bottom=await geometry(page);assert.deepEqual(bottom.issues,[]);report.layouts.push({width,height,size,state:'bottom',...bottom});
          await page.getByRole('button',{name:'编辑字幕',exact:true}).click();await page.getByRole('dialog',{name:'编辑字幕',exact:true}).waitFor();await capture(page,`${width}-${size}-caption-auxiliary`);
          const modal=await page.getByRole('dialog',{name:'编辑字幕',exact:true}).evaluate(el=>{const issues=[],r=el.getBoundingClientRect();if(r.x<0||r.y<0||r.right>innerWidth||r.bottom>innerHeight)issues.push('字幕编辑弹窗越界');const toolbar=el.querySelector('.caption-auxiliary-toolbar'),list=el.querySelector('.caption-list');if(toolbar.getBoundingClientRect().bottom>list.getBoundingClientRect().top+1)issues.push('辅助文本工具栏压住字幕列表');for(const b of el.querySelectorAll('footer button')){const s=b.getBoundingClientRect(),top=document.elementFromPoint(s.x+s.width/2,s.y+s.height/2);if(!b.contains(top))issues.push('字幕页脚按钮被遮挡');}return {issues};});assert.deepEqual(modal.issues,[]);report.layouts.push({width,height,size,state:'caption-auxiliary',...modal});await page.getByRole('dialog',{name:'编辑字幕',exact:true}).getByRole('button',{name:'取消',exact:true}).click();
        }
      }
      const restored=spawnSync('python',['scripts/resize-desktop.py','--handle',String(handle),'--width','1400','--height','1000'],{encoding:'utf8'});assert.equal(restored.status,0);await font(page,'comfortable');
    }else{
      for(const template of templates){await page.getByRole('button',{name:template.name,exact:true}).click();await disk(s=>{const d=s.drafts.find(d=>d.id===fixture.id);return d.edit.subtitleTemplate===template.id;});assert.equal(await page.getByRole('button',{name:template.name,exact:true}).getAttribute('aria-pressed'),'true');assert.equal(draft().edit.subtitleKeywords,template.keywordSupported);assert.equal(draft().edit.subtitleTemplateY,template.config.positionY);}
      report.assertions.push('22模板逐个实点，选中态、关键词支持规则及默认位置实际落盘');
      await page.getByRole('button',{name:'3D 翻转',exact:true}).click();await page.getByRole('checkbox',{name:'关键词高亮',exact:true}).uncheck();await disk(()=>draft().edit.subtitleKeywords===false);
      await page.getByLabel('模板上下位置',{exact:true}).press('Home');await disk(()=>draft().edit.subtitleTemplateY===100);await page.getByRole('button',{name:'默认',exact:true}).click();await disk(()=>draft().edit.subtitleTemplateY===1500);
      await page.getByRole('group',{name:'字幕模式'}).getByRole('button',{name:'自定义',exact:true}).click();await page.getByRole('button',{name:'调整样式',exact:true}).click();await page.getByRole('dialog',{name:'字幕样式设置',exact:true}).waitFor();await page.getByRole('button',{name:'取消',exact:true}).click();await page.getByRole('group',{name:'字幕模式'}).getByRole('button',{name:'模板',exact:true}).click();assert.equal(await page.getByRole('button',{name:'3D 翻转',exact:true}).getAttribute('aria-pressed'),'true');
      await disk(()=>draft().edit.subtitleMode==='template'&&draft().edit.subtitleTemplate==='3d_flip'&&draft().edit.subtitleKeywords===false);await page.reload();await workflow(page);assert.equal(await page.getByRole('button',{name:'3D 翻转',exact:true}).getAttribute('aria-pressed'),'true');assert.equal(await page.getByRole('checkbox',{name:'关键词高亮',exact:true}).isChecked(),false);report.assertions.push('模式切换保留模板，位置滑块和默认按钮有效，自定义编辑器可打开，刷新恢复模板与关键词状态');
      await page.getByRole('button',{name:'编辑字幕',exact:true}).click();const dialog=page.getByRole('dialog',{name:'编辑字幕',exact:true});await page.getByLabel('第1条字幕译文',{exact:true}).fill('Make every step count.');await page.getByLabel('第1条字幕关键词',{exact:true}).fill('不存在');await dialog.getByRole('button',{name:'确定',exact:true}).click();await page.getByRole('alert').filter({hasText:'必须逐字出现在原文'}).waitFor();const input=page.getByLabel('第1条字幕关键词',{exact:true});await input.fill('认真');await input.press('End');await input.press(',');assert.equal(await input.inputValue(),'认真,');await input.pressSequentially('做好');assert.equal(await input.inputValue(),'认真,做好');await input.fill('认真');await dialog.getByRole('button',{name:'确定',exact:true}).click();await dialog.waitFor({state:'hidden'});await page.getByRole('button',{name:'编辑字幕',exact:true}).click();assert.equal(await page.getByLabel('第1条字幕关键词',{exact:true}).inputValue(),'认真');report.assertions.push('译文与关键词真实编辑/保存/重开、逐键输入逗号与第二个词、非原文关键词阻止确认并保留弹窗');
      await page.getByRole('button',{name:'生成双语译文',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.operation-status'),{},{timeout:180000});await disk(()=>draft().edit.captions.every(row=>!!row.auxiliary?.translation));await page.getByRole('button',{name:'提取关键词',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.operation-status'),{},{timeout:180000});await disk(()=>draft().edit.captions.every(row=>Array.isArray(row.auxiliary?.keywords)));await capture(page,'desktop-local-text');
      report.assertions.push('桌面按钮实际调用现有9B本地模型生成两句译文和关键词并保存');
      await page.getByRole('button',{name:'生成双语译文',exact:true}).click();await page.getByLabel('字幕内容',{exact:true}).first().fill('认真做好每一步，输入已修改');await page.waitForFunction(()=>!document.querySelector('.operation-status'),{},{timeout:180000});await page.getByRole('alert').filter({hasText:'未覆盖当前内容'}).waitFor();await disk(()=>!draft().edit.captions[0].auxiliary);assert.equal(await page.getByLabel('第1条字幕译文',{exact:true}).inputValue(),'');report.assertions.push('模型运行时实际修改字幕，过期结果未覆盖新文字，旧译文/关键词失效');
      await page.getByLabel('字幕内容',{exact:true}).first().fill('认真做好每一步');await page.getByLabel('第1条字幕译文',{exact:true}).fill('Make every step count.');await page.getByLabel('第1条字幕关键词',{exact:true}).fill('认真');await dialog.getByRole('button',{name:'确定',exact:true}).click();await dialog.waitFor({state:'hidden'});
      await page.getByRole('button',{name:'白色注音',exact:true}).click();await page.getByRole('checkbox',{name:'关键词高亮',exact:true}).uncheck();await page.getByRole('button',{name:'剪辑视频',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.operation-status'),{},{timeout:180000});await disk(()=>!!draft().edit.resultId);const result=read().assets.find(asset=>asset.id===draft().edit.resultId);assert.equal(result.renderedSubtitleTemplate.templateId,'white_pinyin');assert.equal(result.renderedSubtitleTemplate.pinyin[0][0],'rèn');report.rendered=result;
      const video=page.locator('.edit-preview video');await video.waitFor();await video.evaluate(el=>{el.muted=true;return el.play();});await page.waitForFunction(()=>document.querySelector('.edit-preview video')?.currentTime>.8);await capture(page,'desktop-real-video');await video.evaluate(el=>el.pause());
      await page.getByRole('button',{name:'3D 翻转',exact:true}).click();await disk(()=>draft().edit.resultId==='');report.assertions.push('桌面真实注音剪辑、实际播放推进，切换模板使旧结果失效');
      for(const template of templates){const card=page.getByRole('button',{name:template.name,exact:true});await card.scrollIntoViewIfNeeded();await card.locator('img').waitFor({timeout:30000});}
      await page.getByRole('button',{name:'红白双语',exact:true}).scrollIntoViewIfNeeded();await page.waitForFunction(()=>[...document.querySelectorAll('.subtitle-template-card img')].length===22,{},{timeout:120000});await capture(page,'all-previews-ready');report.previewImages=await page.locator('.subtitle-template-card img').count();
    }
    assert.deepEqual(report.pageErrors,[]);fs.writeFileSync(path.join(root,process.argv[2]==='layouts'?'desktop-layout-report.json':'desktop-functional-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({assertions:report.assertions,layouts:report.layouts.length,previewImages:report.previewImages,pageErrors:report.pageErrors}));
  }catch(error){report.error=error.stack;fs.writeFileSync(path.join(root,'desktop-last-failure.json'),JSON.stringify(report,null,2));await capture(page,'desktop-failure');throw error;}finally{await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
