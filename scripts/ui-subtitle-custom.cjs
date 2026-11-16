const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const root=path.resolve(process.env.SUBTITLE_CUSTOM_EVIDENCE||'evidence/validation/subtitle-custom'),file=path.resolve('evidence/validation/pip-desktop-workspace/studio.json');
const read=()=>JSON.parse(fs.readFileSync(file,'utf8'));
async function disk(predicate){for(let i=0;i<100;i++){const data=read();if(predicate(data))return data;await new Promise(r=>setTimeout(r,50));}throw new Error('任务保存未在5秒内完成');}
async function ready(page){await page.waitForFunction(()=>{const b=document.querySelector('.subtitle-editor-footer .primary');return b&&!b.disabled;},{},{timeout:20000});}
async function open(page){await page.locator('.edit-nav').getByRole('button',{name:'字幕',exact:false}).click();await page.getByRole('button',{name:'调整样式',exact:true}).click();await ready(page);}
async function section(page,name){await page.getByRole('tab',{name,exact:true}).click();}
async function position(page){await page.getByRole('button',{name:'更多字幕设置',exact:true}).click();await page.locator('.subtitle-tab-menu').getByRole('button',{name:'位置布局',exact:true}).click();}
async function basic(page){if(!await page.getByRole('tab',{name:'基础样式',exact:true}).count()){await page.getByRole('button',{name:'更多字幕设置',exact:true}).click();await page.locator('.subtitle-tab-menu').getByRole('button',{name:'基础样式',exact:true}).click();}else await section(page,'基础样式');}
async function menu(page,name){await page.getByRole('button',{name:'菜单',exact:true}).click();await page.getByRole('navigation',{name:'主菜单'}).getByRole('button',{name,exact:true}).click();}
async function capture(page,name){
  await page.evaluate(async()=>{await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
  await page.mouse.move(10,30);
  const report=await page.locator('.subtitle-editor').evaluate(el=>{
    const box=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
    const visible=e=>e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden';
    const modal=el.closest('.modal'),r=box(modal),issues=[];
    if(Math.abs(r.width-790)>1)issues.push({kind:'modal-width',width:r.width});
    if(r.x<0||r.y<0||r.right>innerWidth||r.bottom>innerHeight)issues.push({kind:'modal-outside-window',...r});
    for(const e of el.querySelectorAll('button,.subtitle-style-fields,.subtitle-settings-pane,.subtitle-editor-footer'))if(visible(e)&&e.scrollWidth-e.clientWidth>2)issues.push({kind:'horizontal-overflow',element:e.className,text:e.textContent.slice(0,40),overflow:e.scrollWidth-e.clientWidth});
    const clippedTabs=[];
    const controls=[...el.querySelectorAll('button,input,select')].filter(visible).map(e=>{
      const bounds=box(e),tabs=e.closest('[role=tablist]');
      // 标签条刻意展示下一页的一部分，更多菜单提供完整可操作入口。
      if(e.getAttribute('role')==='tab'&&tabs){const clip=box(tabs);if(bounds.right>clip.right+1){clippedTabs.push({label:e.textContent.trim(),...bounds});if(e.getAttribute('aria-selected')==='true'||!el.querySelector('.subtitle-more'))issues.push({kind:'active-tab-clipped',...bounds});return {label:e.textContent.trim(),...bounds,right:Math.min(bounds.right,clip.right),width:Math.max(0,Math.min(bounds.right,clip.right)-bounds.x)};}}
      return {label:e.getAttribute('aria-label')||e.textContent.trim().slice(0,30),...bounds};
    });
    for(const e of controls)if(e.x<r.x||e.right>r.right+1)issues.push({kind:'control-outside-modal',...e});
    for(const pair of el.querySelectorAll('.subtitle-two-fields,.subtitle-font-row')){const inputs=[...pair.children].map(c=>c.querySelector('.subtitle-color-field,.subtitle-range-value,.subtitle-font-picker,select')).filter(Boolean).filter(visible).map(box);if(inputs.length===2&&Math.abs(inputs[0].y-inputs[1].y)>2)issues.push({kind:'paired-control-misaligned',difference:inputs[0].y-inputs[1].y});}
    const footer=box(el.querySelector('.subtitle-editor-footer'));if(footer.bottom>r.bottom+1)issues.push({kind:'footer-outside-modal'});
    for(const button of el.querySelectorAll('.subtitle-editor-footer>button')){const b=box(button);for(const [x,y]of [[b.x+6,b.y+6],[b.x+b.width/2,b.y+b.height/2],[b.right-6,b.bottom-6]]){const top=document.elementFromPoint(x,y);if(top!==button&&!button.contains(top)){issues.push({kind:'footer-button-obscured',text:button.textContent.trim(),cover:top?.className||top?.tagName});break;}}}
    return {modal:r,orientation:el.querySelector('.subtitle-orientation .active')?.textContent,controls,clippedTabs,issues};
  });
  report.file=path.join(root,name+'.png');await page.screenshot({path:report.file});return report;
}
module.exports={open,ready,menu,basic,position,async functional(page){
  const report={checkedAt:new Date().toISOString(),assertions:[],screens:[],pageErrors:[]};
  page.on('pageerror',e=>report.pageErrors.push(e.message));
  await page.getByRole('textbox',{name:'任务名称',exact:true}).fill('字幕样式桌面验收');await disk(s=>s.drafts.find(d=>d.id===s.currentId)?.title==='字幕样式桌面验收');
  await page.locator('.steps>button').nth(4).click();await disk(s=>s.drafts.find(d=>d.id===s.currentId)?.step===4);
  const initial=fs.readFileSync(file,'utf8'),draftId=read().currentId;report.draftId=draftId;
  await open(page);await page.getByRole('button',{name:'重置默认',exact:true}).click();await page.getByRole('button',{name:'竖版',exact:true}).click();await ready(page);
  const names=['简约白字','描边透明','黄色描边','粉色描边','黑色背景','白色背景','黄色背景','深红背景'];
  for(const [i,name] of names.entries()){await page.getByRole('button',{name,exact:true}).click();await ready(page);report.screens.push(await capture(page,'preset-'+i));}
  assert.equal(fs.readFileSync(file,'utf8'),initial);report.assertions.push('八基础预设逐个实际点击与真实预览，不改变任务或旧结果');
  await page.getByLabel('字幕字号',{exact:true}).fill('62');
  await page.getByRole('button',{name:'粗体',exact:true}).click();await page.getByRole('button',{name:'斜体',exact:true}).click();await page.getByRole('button',{name:'下划线',exact:true}).click();
  const fonts=await page.evaluate(()=>window.studio.invoke('listSubtitleFonts',{}));
  const chosenFont=fonts.find(f=>f.label==='宋体')||fonts.find(f=>f.label==='Arial')||fonts[0];await page.getByRole('combobox',{name:'字幕字体',exact:true}).click();await page.getByRole('option',{name:chosenFont.label,exact:true}).first().click();report.chosenFont=chosenFont;
  await page.getByLabel('字幕颜色',{exact:true}).fill('#oops');await page.getByRole('alert').filter({hasText:'六位'}).waitFor();assert.equal(await page.getByRole('button',{name:'确认设置',exact:true}).isDisabled(),true);
  await page.getByLabel('字幕颜色',{exact:true}).fill('#12AEEF');await page.getByLabel('字幕透明度',{exact:true}).press('End');await page.getByLabel('字幕透明度',{exact:true}).press('ArrowLeft');await ready(page);
  await section(page,'特效设置');await page.getByRole('checkbox',{name:'启用描边',exact:true}).check();await page.getByLabel('描边宽度',{exact:true}).press('Home');for(let i=0;i<8;i++)await page.getByLabel('描边宽度',{exact:true}).press('ArrowRight');await page.getByLabel('描边颜色',{exact:true}).fill('#112233');
  await page.getByRole('checkbox',{name:'启用阴影',exact:true}).check();await page.getByLabel('阴影距离',{exact:true}).press('Home');for(let i=0;i<12;i++)await page.getByLabel('阴影距离',{exact:true}).press('ArrowRight');await page.getByLabel('阴影透明度',{exact:true}).press('End');await page.getByLabel('阴影透明度',{exact:true}).press('ArrowLeft');await page.getByLabel('阴影颜色',{exact:true}).fill('#A03050');await ready(page);report.screens.push(await capture(page,'effects-all-enabled'));
  await section(page,'背景设置');await page.getByRole('radio',{name:'无背景',exact:true}).check();await page.getByRole('radio',{name:'纯色背景',exact:true}).check();await page.getByLabel('背景颜色',{exact:true}).fill('#2447AB');await page.getByLabel('背景透明度',{exact:true}).press('Home');for(let i=0;i<65;i++)await page.getByLabel('背景透明度',{exact:true}).press('ArrowRight');await ready(page);report.screens.push(await capture(page,'background-enabled'));
  await position(page);await page.getByLabel('字幕底部距离',{exact:true}).fill('350');await page.getByLabel('字幕字间距',{exact:true}).fill('3');await page.getByRole('button',{name:'横版',exact:true}).click();await ready(page);assert.equal(await page.getByLabel('字幕底部距离',{exact:true}).inputValue(),'197');report.screens.push(await capture(page,'position-landscape'));await page.getByRole('button',{name:'竖版',exact:true}).click();await ready(page);assert.equal(await page.getByLabel('字幕底部距离',{exact:true}).inputValue(),'350');
  await page.getByRole('button',{name:'取消',exact:true}).click();assert.equal(fs.readFileSync(file,'utf8'),initial);await open(page);assert.equal(await page.getByLabel('字幕字号',{exact:true}).inputValue(),'62');report.assertions.push('字体、字号、粗斜下划线、颜色与透明度、描边、阴影、背景、横竖位置和字间距实际操作；取消不写盘，重开保留草稿');
  const beforeFailure=fs.readFileSync(file,'utf8');
  try{fs.chmodSync(file,0o444);await page.getByRole('button',{name:'确认设置',exact:true}).click();await page.getByRole('alert').filter({hasText:'字幕样式保存失败'}).waitFor({timeout:10000});assert.equal(await page.getByRole('dialog',{name:'字幕样式设置',exact:true}).count(),1);assert.equal(fs.readFileSync(file,'utf8'),beforeFailure);}finally{fs.chmodSync(file,0o666);}
  report.assertions.push('实际业务文件只读时保存失败，弹窗及编辑内容保留，磁盘与任务仍为旧值');
  await page.getByRole('button',{name:'确认设置',exact:true}).click();await page.getByRole('dialog',{name:'字幕样式设置',exact:true}).waitFor({state:'hidden'});const saved=read().drafts.find(d=>d.id===draftId).edit.subtitleCustom;assert.equal(saved.fontSize,62);assert.equal(saved.fontId,chosenFont.value);assert.equal(saved.outlineWidth,4);assert.equal(saved.shadowDistance,6);assert.equal(saved.backgroundOpacity,65);assert.equal(saved.bottomMargin,350);report.saved=saved;
  await page.reload();await open(page);assert.equal(await page.getByLabel('字幕字号',{exact:true}).inputValue(),'62');assert.equal(await page.getByLabel('字幕颜色',{exact:true}).inputValue(),'#12AEEF');await page.getByRole('button',{name:'取消',exact:true}).click();report.assertions.push('确认持久化与页面刷新后字体、颜色、字号完整恢复');
  fs.writeFileSync(path.join(root,'desktop-report.json'),JSON.stringify(report,null,2));return {file:path.join(root,'desktop-report.json'),assertions:report.assertions,issues:report.screens.flatMap(s=>s.issues),pageErrors:report.pageErrors};
},async layout(page,size,font){
  const report={size,font,states:[],pageErrors:[]};const listener=e=>report.pageErrors.push(e.message);page.on('pageerror',listener);
  await open(page);await page.getByRole('button',{name:'重置默认',exact:true}).click();await page.getByRole('button',{name:'竖版',exact:true}).click();await ready(page);
  async function snap(name){const result=await capture(page,'layout-'+font+'-'+size+'-'+name);if(name==='position-portrait')assert.equal(result.orientation,'竖版');if(name==='position-landscape')assert.equal(result.orientation,'横版');report.states.push(result);}
  await snap('basic');await section(page,'特效设置');await snap('effects-off');await page.getByRole('checkbox',{name:'启用描边',exact:true}).check();await page.getByRole('checkbox',{name:'启用阴影',exact:true}).check();await ready(page);await snap('effects-on');
  await section(page,'背景设置');await snap('background-off');await page.getByRole('radio',{name:'纯色背景',exact:true}).check();await ready(page);await snap('background-on');
  await position(page);await snap('position-portrait');await page.getByRole('button',{name:'横版',exact:true}).click();await ready(page);await snap('position-landscape');await basic(page);await page.getByRole('button',{name:'更多字幕设置',exact:true}).click();await snap('more-menu');await page.getByRole('button',{name:'更多字幕设置',exact:true}).click();await page.getByLabel('字幕颜色',{exact:true}).fill('bad');await snap('invalid-color');await page.getByLabel('字幕颜色',{exact:true}).fill('#FFFFFF');await ready(page);
  await page.getByRole('button',{name:'取消',exact:true}).click();page.off('pageerror',listener);const out=path.join(root,'layout-'+font+'-'+size+'.json');fs.writeFileSync(out,JSON.stringify(report,null,2));return {file:out,states:report.states.length,issues:report.states.flatMap(s=>s.issues),pageErrors:report.pageErrors};
}};
