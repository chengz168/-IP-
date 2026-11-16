const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
// 由持久交互会话传入已连接的真实窗口；每项立即落盘，超时后只补缺项。
async function setFont(page,label){
 await page.getByRole('button',{name:'菜单',exact:true}).click({noWaitAfter:true});await page.getByRole('navigation',{name:'主菜单'}).getByRole('button',{name:'设置',exact:true}).click({noWaitAfter:true});await page.getByRole('group',{name:'界面字号',exact:true}).getByRole('button',{name:label,exact:true}).click({noWaitAfter:true});await page.getByRole('button',{name:'菜单',exact:true}).click({noWaitAfter:true});await page.getByRole('navigation',{name:'主菜单'}).getByRole('button',{name:'新工作流',exact:true}).click({noWaitAfter:true});await page.locator('.edit-nav .edit-nav-select').filter({hasText:'字幕'}).click({noWaitAfter:true});
}
async function audit(page,root,name){
 // 正常等待自动提示消失，再检查真实命中，避免计数与点击之间的竞态。
 await page.getByRole('button',{name:'关闭提示',exact:true}).waitFor({state:'hidden',timeout:15000});
 const report=await page.evaluate(()=>{
  const box=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};},issues=[],panel=document.querySelector('.subtitle-panel'),scroll=panel.querySelector('.subtitle-panel-scroll'),grid=panel.querySelector('.subtitle-template-grid'),cards=[...grid.children].map(box);
  if(panel.scrollWidth>panel.clientWidth+2||scroll.scrollWidth>scroll.clientWidth+2)issues.push('字幕面板横溢');if(cards.length!==22)issues.push('模板数量错误');
  for(let i=0;i<cards.length;i+=2){if(Math.abs(cards[i].width-cards[i+1].width)>1||Math.abs(cards[i].y-cards[i+1].y)>1)issues.push('双列不齐');if(Math.abs(cards[i+1].x-cards[i].right-10)>1)issues.push('双列间距不是10px');}
  const nav=[...document.querySelectorAll('.edit-nav-item')].map(e=>{const r=box(e),s=box(e.querySelector('small'));return {text:e.innerText,card:r,summary:s,overflow:Math.max(0,s.bottom-r.bottom)};});if(nav.some(r=>r.overflow>0))issues.push('模块摘要越界');
  const viewport=box(scroll),hits=[...grid.children].filter(e=>{const r=box(e);return r.y>=viewport.y&&r.bottom<=viewport.bottom;}).map(e=>{const r=box(e),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {name:e.getAttribute('aria-label'),hit:hit===e||e.contains(hit)};});if(hits.some(r=>!r.hit))issues.push('可见模板中心被遮挡');
  const slider=box(panel.querySelector('input[type=range]'));if(slider.width<=0||box(panel).bottom>innerHeight)issues.push('滑块宽度或面板底部错误');
  return {window:{width:innerWidth,height:innerHeight},fontSize:document.querySelector('.app').dataset.size,cards,nav,visibleTemplateHits:hits,slider,issues};
 });
 const expected=/^(1100|1400)-/.exec(name);if(expected){assert.equal(report.window.width,Number(expected[1]),'记录名与真实窗口宽度不符');assert.equal(report.window.height,expected[1]==='1100'?760:1000,'记录名与真实窗口高度不符');}
 assert.equal(report.issues.length,0,JSON.stringify(report.issues));await page.screenshot({path:path.join(root,'final-'+name+'.png'),timeout:15000});
 const file=path.join(root,'desktop-layout.json'),layouts=JSON.parse(fs.readFileSync(file,'utf8'));assert.ok(!layouts.some(r=>r.name===name),'已有同状态记录，拒绝重复计数');layouts.push({name,...report});fs.writeFileSync(file,JSON.stringify(layouts,null,2));
 const checkFile=path.join(root,'desktop-checks.json'),checks=JSON.parse(fs.readFileSync(checkFile,'utf8'));checks.push({type:'layout-summary',name,passed:true});fs.writeFileSync(checkFile,JSON.stringify(checks,null,2));return {name,issues:report.issues,visibleHits:report.visibleTemplateHits.length};
}
module.exports={setFont,audit};
