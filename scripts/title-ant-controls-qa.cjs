const assert=require('node:assert/strict');
// 在真实源码窗口上检查同版本控件，不用后台写值代替用户操作。
module.exports=function(app,root,report,pid){
 const base=require('./edit-title-desktop-qa.cjs')(app,root,report,pid);
 return {...base,async measure(width,height,font,mode='custom'){
  await base.measure(width,height,font,mode);
  const detail=await app.page.locator('.title-custom').evaluate(e=>{
   const rect=x=>{const r=x.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
   const selector=e.querySelector('.ant-select-selector'),label=selector.querySelector('.title-font-label');
   return {selector:rect(selector),selectedWeight:getComputedStyle(label).fontWeight,selectedSize:getComputedStyle(label).fontSize,searchWeight:getComputedStyle(e.querySelector('.ant-select-selection-search-input')).fontWeight,
    checkboxes:[...e.querySelectorAll('.ant-checkbox-inner')].map(rect),switches:[...e.querySelectorAll('.ant-switch')].map(x=>({...rect(x),handle:rect(x.querySelector('.ant-switch-handle'))})),
    cards:[...e.querySelectorAll('.title-style-group')].map(card=>{const fields=card.querySelector('.title-group-fields');return {title:card.getAttribute('aria-label'),columns:fields?getComputedStyle(fields).gridTemplateColumns:null,overflow:card.scrollWidth-card.clientWidth};})};
  });
  assert.equal(detail.selector.height,24);assert.equal(detail.selectedWeight,'900');assert.equal(detail.searchWeight,'400');
  for(const checkbox of detail.checkboxes){assert.equal(checkbox.width,16);assert.equal(checkbox.height,16);}
  for(const sw of detail.switches){assert.equal(sw.width,28);assert.equal(sw.height,16);assert.equal(sw.handle.width,12);assert.equal(sw.handle.height,12);}
  for(const card of detail.cards){assert.ok(card.overflow<=1,card.title);if(card.columns)assert.equal(card.columns.split(' ').length,2);}
  report.layouts.at(-1).antControls=detail;return detail;
 }};
};
