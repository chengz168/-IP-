// 每张预览独立完成，字体或背景失败必须成为可读错误，不能继续冒充加载中。
export const loadingThumbnails=items=>Object.fromEntries(items.map(item=>[item.id,{status:'loading',url:'',error:''}]));
export async function renderThumbnails({items,render,isCurrent,publish}){
 const result=loadingThumbnails(items);if(!isCurrent())return;publish({...result});
 for(const item of items){
  if(!isCurrent())return;
  let state;try{state={status:'ready',url:await render(item),error:''};}
  catch(error){state={status:'failed',url:'',error:typeof error?.message==='string'&&error.message.trim()?error.message:'模板预览生成失败，请重试'};}
  if(!isCurrent())return;result[item.id]=state;publish({...result});
 }
}
