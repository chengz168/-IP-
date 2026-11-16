import templates from './title-templates.json' with {type:'json'};
export const titleTemplates=templates;
export const titleDefaults={fontFamily:'Microsoft YaHei',fontId:'',fontSize:56,color:'#FFFFFF',secondaryColor:'#FFFFFF',opacity:1,bold:true,italic:false,underline:false,letterSpacing:0,top:120,stroke:{enabled:false,color:'#000000',width:2},shadow:{enabled:true,color:'#000000',opacity:.45,distance:3},background:{enabled:true,color:'#000000',opacity:.38,paddingX:24,paddingY:12,radius:18}};
export function titleStyle(input={}){return {...structuredClone(titleDefaults),...input,stroke:{...titleDefaults.stroke,...input.stroke},shadow:{...titleDefaults.shadow,...input.shadow},background:{...titleDefaults.background,...input.background}};}
// 旧任务只读转换，用户修改后才保存新配置；旧成片仍沿用原来的绘制分支。
export function titleDesign(edit){return edit.titleDesign?JSON.parse(JSON.stringify(edit.titleDesign)):{version:1,mode:'custom',templateId:templates[2].id,displayMode:'always',duration:3,offsetX:0,offsetY:0,custom:titleStyle({color:edit.titleStyle==='white'?'#FFFFFF':'#FFFF00',secondaryColor:edit.titleStyle==='white'?'#FFFFFF':'#FFFF00',stroke:{enabled:true},background:{enabled:false},shadow:{enabled:false}})};}
export function templateTitleStyle(template){const s=template.style;return titleStyle({fontFamily:s.fontFamily,fontSize:s.fontSize,color:s.color,secondaryColor:s.secondaryColor,opacity:s.opacity??1,bold:Number(s.fontWeight)>=700,fontWeight:Number(s.fontWeight)||400,italic:s.fontStyles?.includes('italic')||false,underline:s.fontStyles?.includes('underline')||false,letterSpacing:s.letterSpacing??0,top:s.offsetY,templateOffsetX:s.offsetX||0,stroke:{enabled:s.enableStroke??s.strokeWidth>0,color:s.strokeColor||'#000000',width:s.strokeWidth||0},shadow:{enabled:s.enableShadow??s.shadowDistance>0,color:s.shadowColor||'#000000',opacity:s.shadowOpacity??1,distance:s.shadowDistance||0},background:{enabled:!!s.enableBackground,color:s.backgroundColor||'rgba(0,0,0,0)',opacity:s.backgroundOpacity??1,paddingX:s.backgroundPaddingX??24,paddingY:s.backgroundPaddingY??12,radius:s.backgroundRadius??18}});}
function solidColor(color){const m=/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)$/.exec(color);return m?{color:'#'+m.slice(1,4).map(n=>Number(n).toString(16).padStart(2,'0')).join('').toUpperCase(),opacity:m[4]===undefined?1:Number(m[4])}:{color,opacity:1};}
// 模板转自定义沿用当前可见样式，颜色拆为纯色与透明度以支持真实控件编辑。
export function customTitleFromTemplate(template){const s=templateTitleStyle(template);for(const key of ['shadow','background']){const parsed=solidColor(s[key].color);s[key]={...s[key],color:parsed.color,opacity:s[key].opacity*parsed.opacity};}const offsetX=s.templateOffsetX;delete s.templateOffsetX;return {style:s,offsetX};}
function rawTitleStyle(style){const s=titleStyle(style);return {fontFamily:s.fontFamily,fontSize:s.fontSize,color:s.color,secondaryColor:s.secondaryColor,opacity:s.opacity,fontWeight:String(s.fontWeight||(s.bold?700:400)),fontStyles:[s.bold&&'bold',s.italic&&'italic',s.underline&&'underline'].filter(Boolean),offsetX:s.templateOffsetX||0,offsetY:s.top,letterSpacing:s.letterSpacing,enableStroke:s.stroke.enabled,strokeColor:s.stroke.color,strokeWidth:s.stroke.width,enableShadow:s.shadow.enabled,shadowColor:s.shadow.color,shadowOpacity:s.shadow.opacity,shadowDistance:s.shadow.distance,enableBackground:s.background.enabled,backgroundColor:s.background.color,backgroundOpacity:s.background.opacity,backgroundPaddingX:s.background.paddingX,backgroundPaddingY:s.background.paddingY,backgroundRadius:s.background.radius};}
// 原版选择模板会合并当前样式，模板没有声明的开关和字形继续继承。
export function selectTitleTemplate(edit,template){const d=titleDesign(edit),prior=d.mode==='template'?(d.templateStyle||rawTitleStyle(templateTitleStyle(templates.find(t=>t.id===d.templateId)))):rawTitleStyle(d.custom),effective={...prior,...structuredClone(template.style)},inherited=customTitleFromTemplate({style:effective});return {...d,mode:'template',templateId:template.id,templateStyle:effective,custom:{...inherited.style,templateOffsetX:inherited.offsetX},offsetX:0,offsetY:0};}
// 两种模式共享有效顶部；坐标的解释随原版模式变化，切换不丢失拖动结果。
export function switchTitleMode(edit,mode){const d=titleDesign(edit);if(d.mode===mode)return d;const effectiveTop=d.custom.top+d.offsetY,top=Math.max(0,Math.min(10000,effectiveTop));d.custom={...d.custom,top};d.offsetY=effectiveTop-top;d.mode=mode;d.templateStyle=rawTitleStyle(d.custom);return d;}
export function validateTitleDesign(input){
 const d=structuredClone(input);if(d?.version!==1||!['template','custom'].includes(d.mode)||!['always','seconds'].includes(d.displayMode))throw new Error('标题配置版本、模式或显示时长无效');
 const number=(n,min,max,name)=>{if(!Number.isFinite(n)||n<min||n>max)throw new Error(name+'超出允许范围');};
 number(d.duration,.1,3600,'标题显示秒数');number(d.offsetX,-10000,10000,'标题横向位置');number(d.offsetY,-10000,10000,'标题纵向位置');
 if(!templates.some(t=>t.id===d.templateId))throw new Error('标题模板不存在，请重新选择');
 if(d.templateStyle!==undefined){
  if(!d.templateStyle||typeof d.templateStyle!=='object'||Array.isArray(d.templateStyle))throw new Error('标题模板样式无效');
  for(const key of ['enableStroke','enableShadow','enableBackground'])if(typeof d.templateStyle[key]!=='boolean')throw new Error('标题模板效果开关无效');
  if(!Array.isArray(d.templateStyle.fontStyles)||d.templateStyle.fontStyles.some(v=>!['bold','italic','underline'].includes(v)))throw new Error('标题模板字形无效');
  const inherited=customTitleFromTemplate({style:d.templateStyle});validateTitleDesign({...d,templateStyle:undefined,custom:{...inherited.style,templateOffsetX:inherited.offsetX}});
 }
 const s=titleStyle(d.custom);number(s.fontSize,12,300,'标题字号');number(s.top,0,10000,'标题顶部距离');number(s.opacity,0,1,'文字透明度');number(s.letterSpacing,-5,100,'字间距');
 if(s.templateOffsetX!==undefined)number(s.templateOffsetX,-10000,10000,'模板继承横向位置');
 if(s.fontWeight!==undefined)number(s.fontWeight,100,1000,'标题字重');
 for(const key of ['color','secondaryColor'])if(!/^#[\da-f]{6}$/i.test(s[key]))throw new Error('标题文字颜色无效');
 if(typeof s.fontFamily!=='string'||!s.fontFamily.trim()||s.fontFamily.length>150||typeof s.fontId!=='string')throw new Error('标题字体无效');
 for(const key of ['stroke','shadow','background']){if(typeof s[key].enabled!=='boolean'||!/^#[\da-f]{6}$/i.test(s[key].color))throw new Error('标题效果配置无效');}
 for(const key of ['bold','italic','underline'])if(typeof s[key]!=='boolean')throw new Error('标题文字样式无效');
 number(s.stroke.width,0,30,'描边宽度');number(s.shadow.opacity,0,1,'阴影透明度');number(s.shadow.distance,0,100,'阴影距离');number(s.background.opacity,0,1,'背景透明度');number(s.background.paddingX,0,200,'背景宽度');number(s.background.paddingY,0,200,'背景高度');number(s.background.radius,0,240,'背景圆角');d.custom=s;return d;
}
export function titleSnapshot(edit,width,height){
 const design=validateTitleDesign(titleDesign(edit)),main=String(edit.title||''),sub=String(edit.subtitle||'');
 if(main.length>500||sub.length>500)throw new Error('主副标题各最多500字，请精简后重试');
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<16||height<16||width>8192||height>8192)throw new Error('标题视频尺寸无效');
 return {version:design.mode==='template'?2:3,width,height,main,sub,design,style:design.mode==='template'?templateTitleStyle(design.templateStyle?{style:design.templateStyle}:templates.find(t=>t.id===design.templateId)):titleStyle(design.custom)};
}
export {editTitleSignature as titleGenerationSignature} from './edit-title-request.mjs';
