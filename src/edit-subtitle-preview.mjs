import {subtitleTemplates} from '../server/subtitle-templates.mjs';
import {subtitlePosition} from '../server/subtitle-position.mjs';
// 原版编辑区使用固定示意文案，动画及真实字幕时间仍以成片为准。
export function editSubtitlePreview(edit,{width=1080,height=1920}={}){
 if(edit.subtitleMode==='template'){
  const template=subtitleTemplates.find(t=>t.id===edit.subtitleTemplate);if(!template)throw Error('字幕模板不存在，请重新选择');
  // 原版主编辑区沿用已保存的自定义字形，仅按模板偏移定位；动画样式由卡片和成片展示。
  return {...editSubtitlePreview({...edit,subtitleMode:'custom'},{width,height}),templateId:template.id,positionX:540,positionY:subtitlePosition(edit,template),highlight:false};
 }
 const custom=edit.subtitleCustom;
 if(custom)return {fontId:custom.fontId,fontFamily:custom.fontFamily,fontSize:custom.fontSize*1920/1080,fontStyles:[...(custom.bold?['bold']:[]),...(custom.italic?['italic']:[]),...(custom.underline?['underline']:[])],color:custom.color,opacity:custom.opacity/100,letterSpacing:custom.letterSpacing,lineHeight:custom.lineHeight,positionX:540,positionY:custom.version===2?1920*(1-custom.bottomMargin/custom.referenceHeight):1920*(1-custom.bottomMargin/height)-custom.fontSize*1920/1080*.58,enableStroke:custom.outlineEnabled,strokeWidth:custom.outlineWidth,strokeColor:custom.outlineColor,enableShadow:custom.shadowEnabled,shadowDistance:custom.shadowDistance,shadowColor:custom.shadowColor,shadowOpacity:custom.shadowOpacity/100,backgroundType:custom.backgroundEnabled?'solid':'none',backgroundColor:custom.backgroundColor,backgroundOpacity:custom.backgroundOpacity/100};
 return {fontFamily:'Microsoft YaHei',fontSize:(edit.subtitleFontSize||48)*width/height*1920/1080,fontStyles:[],color:edit.subtitleStyle==='yellow'?'#FFE800':'#FFFFFF',opacity:1,positionX:540,positionY:edit.subtitlePosition==='top'?1920*(edit.subtitleMargin??.055):edit.subtitlePosition==='middle'?960:1920*(1-(edit.subtitleMargin??.055)),enableStroke:true,strokeWidth:2,strokeColor:'#101010',enableShadow:true,shadowDistance:1,shadowColor:'#000000',shadowOpacity:.5,backgroundType:edit.subtitleStyle==='box'?'solid':'none',backgroundColor:'#000000',backgroundOpacity:.5};
}
