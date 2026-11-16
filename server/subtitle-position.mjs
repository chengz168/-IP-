// 新旧模板位置统一换算；旧任务只读取绝对位置，不在打开页面时回写。
export function subtitleOffset(edit,template){
 if(Number.isFinite(edit.subtitleOffsetY))return edit.subtitleOffsetY;
 return Number.isFinite(edit.subtitleTemplateY)?840-edit.subtitleTemplateY*1080/1920:0;
}
export function subtitlePosition(edit,template){
 if(edit.subtitleOffsetY!==undefined&&!Number.isFinite(edit.subtitleOffsetY)||edit.subtitleTemplateY!==undefined&&!Number.isFinite(edit.subtitleTemplateY))throw Error('字幕上下位置无效');
 const offset=subtitleOffset(edit,template);
 if(!Number.isFinite(offset)||offset < -200||offset > 600){
  if(edit.subtitleOffsetY===undefined&&Number.isFinite(edit.subtitleTemplateY)&&edit.subtitleTemplateY>=100&&edit.subtitleTemplateY<=1820)return edit.subtitleTemplateY;
  throw Error('字幕上下偏移需在-200至600之间');
 }
 if(edit.subtitleOffsetY===undefined&&Number.isFinite(edit.subtitleTemplateY))return edit.subtitleTemplateY;
 return Math.round((840-offset)*1920/1080);
}
