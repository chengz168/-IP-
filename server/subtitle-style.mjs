// 编辑器、预览与视频烧录共用参数，未确认自定义时保持旧任务的渲染方式。
export const subtitleDefaults={version:1,fontId:'',fontFamily:'Microsoft YaHei',fontSize:50,bold:false,italic:false,underline:false,color:'#FFFFFF',opacity:100,outlineEnabled:false,outlineWidth:2,outlineColor:'#000000',outlineOpacity:100,shadowEnabled:false,shadowDistance:3,shadowColor:'#000000',shadowOpacity:80,backgroundEnabled:false,backgroundColor:'#000000',backgroundOpacity:80,bottomMargin:420,letterSpacing:0,referenceHeight:1920};
export const subtitlePresets=[
  {id:'simple',name:'简约白字',color:'#FFFFFF',outlineEnabled:true,outlineColor:'#000000'},
  {id:'transparent',name:'描边透明',color:'#000000',outlineEnabled:true,outlineColor:'#FFFFFF'},
  {id:'yellow-outline',name:'黄色描边',color:'#FFDE00',outlineEnabled:true,outlineColor:'#000000'},
  {id:'pink-outline',name:'粉色描边',color:'#FFFFFF',outlineEnabled:true,outlineColor:'#FE8A80'},
  {id:'black-box',name:'黑色背景',color:'#FFFFFF',backgroundEnabled:true,backgroundColor:'#000000',backgroundOpacity:80},
  {id:'white-box',name:'白色背景',color:'#000000',backgroundEnabled:true,backgroundColor:'#FFFFFF',backgroundOpacity:100},
  {id:'yellow-box',name:'黄色背景',color:'#000000',backgroundEnabled:true,backgroundColor:'#FFDE00',backgroundOpacity:100},
  {id:'red-box',name:'深红背景',color:'#FFFFFF',backgroundEnabled:true,backgroundColor:'#A74F59',backgroundOpacity:100}
];
export function presetStyle(id,current,font){const preset=subtitlePresets.find(p=>p.id===id);if(!preset)throw new Error('字幕预设不存在');const {id:unusedId,name:unusedName,...values}=preset;
 if(current.version===2){
  const index=subtitlePresets.indexOf(preset),lineHeights=[1.2,1.2,1.2,1.2,1.4,1.1,1.3,1.2],spacings=[0,0,0,0,1,.5,0,1],edges=['#000000','#FFFFFF','#000000','#FE8A80','#333333','#FFFFFF','#8B4513','#FFFFFF'];
  return {...current,...subtitleDefaults,...values,version:2,fontSize:50,bottomMargin:current.bottomMargin,referenceHeight:current.referenceHeight,fontId:font.id,fontFamily:font.family,lineHeight:lineHeights[index],letterSpacing:spacings[index],outlineWidth:index<4?2:0,outlineColor:edges[index],backgroundColor:index<2?current.backgroundColor:index===3?'#000000':values.backgroundColor||'#000000',backgroundOpacity:index<2?current.backgroundOpacity:index===3?60:index<5?80:100,presetId:id};
 }
 return {...subtitleDefaults,fontSize:current.fontSize,bottomMargin:current.bottomMargin,letterSpacing:current.letterSpacing,referenceHeight:current.referenceHeight,fontId:font.id,fontFamily:font.family,...values};}
export const subtitleRanges={fontSize:[10,200],opacity:[0,100],outlineWidth:[0,20],outlineOpacity:[0,100],shadowDistance:[0,30],shadowOpacity:[0,100],backgroundOpacity:[0,100],bottomMargin:[0,3840],letterSpacing:[-10,30]};
export function validateSubtitleStyle(input){
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('字幕样式无效');
  const result={...subtitleDefaults,...(input.version===2?{version:2,lineHeight:1.2,presetId:''}:{})};
  for(const key of Object.keys(result))if(Object.hasOwn(input,key))result[key]=input[key];
  if(![1,2].includes(result.version)||![1080,1920].includes(result.referenceHeight))throw new Error('字幕样式版本或预览方向无效');
  const ranges=result.version===2?{...subtitleRanges,letterSpacing:[-10,50],lineHeight:[1,3]}:subtitleRanges;
  for(const [key,[min,max]] of Object.entries(ranges))if(typeof result[key]!=='number'||!Number.isFinite(result[key])||result[key]<min||result[key]>max)throw new Error('字幕参数超出允许范围：'+key);
  if(result.version===2&&typeof result.presetId!=='string')throw Error('字幕预设标识无效');
  for(const key of ['bold','italic','underline','outlineEnabled','shadowEnabled','backgroundEnabled'])if(typeof result[key]!=='boolean')throw new Error('字幕开关参数无效：'+key);
  for(const key of ['color','outlineColor','shadowColor','backgroundColor']){if(typeof result[key]!=='string'||!/^#[a-f\d]{6}$/i.test(result[key]))throw new Error('颜色请输入六位十六进制色值');result[key]=result[key].toUpperCase();}
  if(typeof result.fontId!=='string'||!/^font-[a-f\d]{20}$/.test(result.fontId))throw new Error('请选择可用的本地字体');
  if(typeof result.fontFamily!=='string'||!result.fontFamily.trim()||/[\r\n,\\{}]/.test(result.fontFamily)||result.fontFamily.length>150)throw new Error('字体名称无效');
  if(result.bottomMargin>result.referenceHeight*.9)throw new Error('底部距离需小于画面高度的90%');
  return result;
}
// 确认前仅转换临时副本，旧样式的文件与版本不会因打开弹窗而改变。
export function toEditorSubtitle(input,{height=1920}={}){
 const fontSize=Math.max(32,Math.min(96,Math.round(input.fontSize)));
 if(input.version===2)return {...input,fontSize};
 const referenceHeight=input.referenceHeight||1920;
 return {...input,version:2,fontSize,lineHeight:1.2,presetId:'',bottomMargin:Math.round(Math.max(0,Math.min(referenceHeight*.9,input.bottomMargin/height*referenceHeight+input.fontSize*referenceHeight/1080*.58)))};
}
export function fromLegacySubtitle(edit,{width=1080,height=1920}={},font){
  if(edit.subtitleCustom)return {...edit.subtitleCustom};
  const referenceHeight=height>=width?1920:1080;
  const margin=edit.subtitlePosition==='top'?height*(1-Number(edit.subtitleMargin??.055))-(edit.subtitleFontSize||48)*width/1080:edit.subtitlePosition==='middle'?height/2:Number(edit.subtitleMargin??.055)*height;
  return {...subtitleDefaults,fontId:font.id,fontFamily:font.family,referenceHeight,fontSize:Math.max(10,Math.min(200,(edit.subtitleFontSize||48)*width/height)),bottomMargin:Math.max(0,Math.min(referenceHeight*.9,Math.round(margin/height*referenceHeight))),color:edit.subtitleStyle==='yellow'?'#FFE800':'#FFFFFF',outlineEnabled:true,outlineWidth:2,outlineColor:'#101010',shadowEnabled:true,shadowDistance:1,backgroundEnabled:edit.subtitleStyle==='box'};
}
