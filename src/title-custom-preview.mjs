// 依据原版951自定义标题和969缩放模块；文字尺寸按视频原生像素解释。
const rounded=value=>Number(value.toFixed(3));
export function titlePreviewScale(box,native={width:1080,height:1920},minimum=.12){
 const x=(Number(box.width)||0)/(Number(native.width)||1080),y=(Number(box.height)||0)/(Number(native.height)||1920);
 return rounded(Math.max(minimum,Math.min(x||y||.42,y||x||.42)));
}
export function titleStrokeWidth(value,scale){const n=Number(value),width=Number.isFinite(n)?Math.max(0,Math.min(6,Math.round(n/.5)*.5)):2;return Number((width*scale).toFixed(2));}
export function customTitlePointerTop(clientY,rect,nativeHeight){
 if(!Number.isFinite(clientY)||!Number.isFinite(rect?.top)||!Number.isFinite(rect?.height)||rect.height<=0||!Number.isFinite(nativeHeight)||nativeHeight<=0)return null;
 return Math.round(Math.max(24,Math.min(rect.height-72,clientY-rect.top))/rect.height*nativeHeight);
}
export function customTitleLayout(snapshot,box={width:snapshot.width,height:snapshot.height},{preview=true}={}){
 const s=snapshot.style,p=s.background,nativeScale=titlePreviewScale(box,snapshot),effectScale=titlePreviewScale(box),fontSize=Math.max(12,(s.fontSize||56)*nativeScale),top=Math.max(2,Math.min(86,(s.top+snapshot.design.offsetY)/snapshot.height*100));
 const lines=[];
 if(snapshot.main||preview)lines.push(String(snapshot.main||'主标题示例'));
 if(snapshot.sub)lines.push(String(snapshot.sub));
 const background=p.enabled?p.color+Math.round(255*Math.max(0,Math.min(1,p.opacity))).toString(16).padStart(2,'0'):'transparent';
 const style={position:'absolute',zIndex:'4',display:'grid',gap:'2px',left:'50%',top:top+'%',transform:'translateX(-50%)',minWidth:'0',padding:`${p.paddingY*nativeScale}px ${p.paddingX*nativeScale}px`,borderRadius:p.radius*nativeScale+'px',textAlign:'center',color:s.color,opacity:s.opacity,fontFamily:s.renderFamily?`"${s.renderFamily}"`:s.fontFamily||'Microsoft YaHei',fontSize:fontSize+'px',fontWeight:s.bold?900:s.fontWeight||400,fontStyle:s.italic?'italic':'normal',textDecoration:s.underline?'underline':'none',lineHeight:'1',letterSpacing:(Number(s.letterSpacing)||0)*effectScale+'px',background,textShadow:s.shadow.enabled?`0 ${Math.max(1,(s.shadow.distance||2)*effectScale)}px ${Math.max(4,16*effectScale)}px ${s.shadow.color}`:'none',WebkitTextStroke:s.stroke.enabled&&s.stroke.width?`${titleStrokeWidth(s.stroke.width,effectScale)}px ${s.stroke.color}`:'0 transparent'};
 style.fontSynthesis='weight style';
 return {kind:'reference-custom-dom',coordinateSystem:'native-video',nativeScale,effectScale,fontSize,topPercent:top,gap:2,style,lines,lineStyle:{display:'block',font:'inherit',color:'inherit',opacity:'1',whiteSpace:'nowrap'}};
}
export function createCustomTitleNode(snapshot,options){const layout=customTitleLayout(snapshot,undefined,options),node=document.createElement('div');Object.assign(node.style,layout.style);for(const text of layout.lines){const span=document.createElement('span');Object.assign(span.style,layout.lineStyle);span.textContent=text;node.append(span);}return {node,layout};}
