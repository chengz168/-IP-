const assert=require('node:assert/strict');
// 除外层几何外，逐卡片核对窄窗口仍为原版双列，防止只检查容器却漏掉字段分行。
module.exports=function(app,root,report,pid){
 const base=require('./edit-title-desktop-qa.cjs')(app,root,report,pid);
 return {...base,async measure(width,height,font,mode='custom'){
  await base.measure(width,height,font,mode);
  const detail=await app.page.locator('.title-custom').evaluate(e=>{const rect=x=>{const r=x.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right};},style=x=>getComputedStyle(x);return{numberInputs:e.querySelectorAll('input[type=number]').length,fontWeight:style(e.querySelector('.title-font-picker input')).fontWeight,fontSize:style(e.querySelector('.title-font-picker input')).fontSize,controlSize:style(document.documentElement).getPropertyValue('--app-font-size-control'),colors:[...e.querySelectorAll('input[type=color]')].map(rect),cards:[...e.querySelectorAll('.title-style-group')].map(card=>{const fields=card.querySelector('.title-group-fields'),h=card.querySelector('h4');return{title:h.textContent,box:rect(card),padding:style(card).padding,lineHeight:style(h).lineHeight,fontSize:style(h).fontSize,columns:fields?style(fields).gridTemplateColumns:null,fields:fields?[...fields.children].filter(x=>x.tagName==='LABEL').map(rect):[]};})};});
  assert.equal(detail.numberInputs,0);assert.equal(detail.fontWeight,'900');
  for(const color of detail.colors){assert.equal(color.width,34);assert.equal(color.height,24);}
  for(const card of detail.cards){assert.equal(card.padding,'11px 12px 12px 14px');assert.ok(Math.abs(parseFloat(card.lineHeight)-parseFloat(card.fontSize)*1.15)<.02);if(!card.columns)continue;assert.equal(card.columns.split(' ').length,2);for(let i=0;i+1<card.fields.length;i+=2){const a=card.fields[i],b=card.fields[i+1];assert.ok(Math.abs(a.y-b.y)<1);assert.ok(Math.abs(b.x-a.right-10)<1);}}
  report.layouts.at(-1).cardDetails=detail;return detail;
 }};
};
