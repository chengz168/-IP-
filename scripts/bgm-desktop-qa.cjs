const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
module.exports=function(app,root,report){
 return async function measure(width,height,font,mode){
  await app.page.locator('.edit-first-frame img').waitFor();
  await app.page.waitForFunction(()=>{const i=document.querySelector('.edit-first-frame img');return i?.complete&&i.naturalWidth>0;});
  await app.page.getByRole('button',{name:'关闭提示',exact:true}).waitFor({state:'hidden'});
  const record=await app.page.evaluate(()=>{const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};},panel=document.querySelector('.bgm-panel'),scroll=document.querySelector('.bgm-editor-scroll');return {w:innerWidth,h:innerHeight,font:document.documentElement.dataset.fontSize,documentOverflow:document.documentElement.scrollWidth-innerWidth,scrollOverflow:scroll.scrollWidth-scroll.clientWidth,panel:rect(panel),segment:rect(panel.querySelector('.ant-segmented')),columns:[...document.querySelector('.edit-columns').children].map(rect),upload:panel.querySelector('.upload-row')?rect(panel.querySelector('.upload-row')):null,button:panel.querySelector('.upload-row button')?rect(panel.querySelector('.upload-row button')):null,tracks:[...panel.querySelectorAll('.bgm-item>.ant-btn')].map(e=>({row:rect(e.parentElement),button:rect(e)}))};});
  assert.equal(record.w,width);assert.equal(record.h,height);assert.equal(record.font,font);assert.ok(record.documentOverflow<=1);assert.ok(record.scrollOverflow<=1);assert.equal(record.segment.height,36);assert.ok(record.segment.x>=record.panel.x-1&&record.segment.right<=record.panel.right+1);
  if(record.button)assert.ok(record.button.right<=record.panel.right+1);
  assert.ok(Math.max(...record.columns.map(r=>r.y))-Math.min(...record.columns.map(r=>r.y))<1);
  const controls={compact:14,standard:15,comfortable:16,large:18};for(const item of record.tracks){assert.equal(item.button.height,controls[font]+12);assert.equal(item.row.height,item.button.height+16);}
  const image=width+'-'+font+'-'+mode+'.png';await app.page.screenshot({path:path.join(root,image)});report.layouts.push({mode,...record,image});fs.writeFileSync(path.join(root,'functional-report.json'),JSON.stringify(report,null,2));return record;
 };
};
