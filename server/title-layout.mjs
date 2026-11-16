// 元数据依据原版951前端的模板排版表；模板基准与自定义标题的坐标体系不同。
const common={main:{x:0,y:100,fontSize:70,bold:true},sub:{x:0,y:160,fontSize:65,bold:false}};
const layouts={
 title_yellow_ximai_stroke:common,
 title_yellow_white_xingkai_shadow:common,
 title_yellow_white_serif:common,
 title_yellow_white_dakai_shadow:{main:{x:0,y:100,fontSize:70,bold:true},sub:{x:0,y:180,fontSize:65,bold:false}},
 title_white_houzun_italic:{main:{x:0,y:80,fontSize:70,bold:true,italic:true},sub:{x:0,y:160,fontSize:70,bold:false,italic:true},mask:{paddingTop:20,paddingBottom:20}},
 title_red_jiangcheng_stroke:{main:{x:0,y:100,fontSize:70,bold:true},sub:{x:0,y:180,fontSize:70,bold:false}},
 title_orange_yellow_xiehei_stroke:{main:{x:-200,y:100,fontSize:70,bold:true,italic:true},sub:{x:200,y:180,fontSize:70,bold:false,italic:true}},
 title_orange_white_stroke:{main:{x:0,y:100,fontSize:70,bold:true},sub:{x:0,y:180,fontSize:65,bold:false}},
 title_orange_white_serif_shadow:{main:{x:0,y:80,fontSize:70,bold:true},sub:{x:0,y:160,fontSize:65,bold:false},mask:{paddingTop:20,paddingBottom:20}},
 title_blue_wendao_stroke:{main:{x:0,y:100,fontSize:70,bold:true,italic:true,fontWeight:900},sub:{x:0,y:160,fontSize:60,bold:false,italic:true,fontWeight:900}}
};
const px=value=>Number(value.toFixed(2));
export function templateTitleLayout(snapshot){
 const spec=layouts[snapshot.design.templateId];if(!spec)throw new Error('标题模板排版不存在');
 const {width,height,design,style}=snapshot,xScale=width/1920,yScale=height/1080;
 const top=style.top+design.offsetY,delta=top-spec.main.y,items=[];
 // 原版模板使用nowrap；主副行分别定位，不按当前文字长度重排另一行。
 if(snapshot.main||!snapshot.sub)items.push({key:'main',text:snapshot.main||'主标题示例',line:spec.main,color:style.color});
 if(snapshot.sub)items.push({key:'sub',text:snapshot.sub,line:spec.sub,color:style.secondaryColor||style.color});
 const lines=items.map(({key,text,line,color})=>({key,text:String(text).replace(/[\t\n\f\r ]+/g,' ').trim(),x:width/2+px(line.x*xScale),y:px((line.y+delta)*yScale),fontSize:px(Math.max(12,line.fontSize*yScale)),fontWeight:line.fontWeight||(line.bold?style.fontWeight||900:700),italic:!!(line.italic||style.italic),color,boxWidth:px(Math.max(40,width*.92))}));
 let mask=null;
 if(spec.mask||style.background.enabled){
  const first=items[0].line,last=items.at(-1).line;
  const rawTop=(first.y+delta-first.fontSize/2-(spec.mask?.paddingTop||20))*yScale;
  const bottom=(last.y+delta+last.fontSize/2+(spec.mask?.paddingBottom||20))*yScale;
  mask={x:0,y:px(Math.max(0,rawTop)),width,height:px(Math.max(0,bottom-rawTop)),color:style.background.color||'rgba(0,0,0,0.24)'};
 }
 return {kind:'reference-template',version:1,referenceWidth:1920,referenceHeight:1080,top,lines,mask};
}
export function templateTitlePointerOffset(clientY,rect,presetTop){
 if(!Number.isFinite(clientY)||!Number.isFinite(rect?.top)||!Number.isFinite(rect?.height)||rect.height<=0||!Number.isFinite(presetTop))return null;
 const y=Math.max(24,Math.min(rect.height-72,clientY-rect.top));
 return Math.max(-10000,Math.min(10000,Math.round(Math.min(rect.height,y)/rect.height*1080)-presetTop));
}
