import {titleSnapshot} from '../server/title-model.mjs';
import {prepareCoverFonts} from './cover-fonts.mjs';
import {templateTitleLayout} from '../server/title-layout.mjs';
const loaded=new Map();
export async function prepareTitle(snapshot,fonts,load){
 if(snapshot.style.fontId&&!fonts.some(f=>f.id===snapshot.style.fontId))throw new Error('所选标题字体已缺失，请重新选择');
 const aliases={'喜脉体':'字制区喜脉体','三极行楷简体':'三极行楷简体-粗','思源宋体':'思源宋体 Heavy'},style={...snapshot.style};if(!style.fontId&&aliases[style.fontFamily])style.fontFamily=aliases[style.fontFamily];
 const scene=await prepareCoverFonts({layers:[{style}]},fonts,load);
 return {...snapshot,style:scene.layers[0].style};
}
export function loadTitleFont(call,font){
 if(font.face>0)throw new Error('当前字体为集合中的附加字族，请选择独立字体文件或首个字族');
 if(!loaded.has(font.id))loaded.set(font.id,(async()=>{const data=await call('coverFontData',{fontId:font.id}),alias='title_'+font.id.replace(/-/g,'_'),bytes=Uint8Array.from(atob(data.data),ch=>ch.charCodeAt(0)),face=await new FontFace(alias,bytes.buffer).load();document.fonts.add(face);return alias;})().catch(error=>{loaded.delete(font.id);throw error;}));return loaded.get(font.id);
}
export {titleSnapshot};
function colorAlpha(ctx,color,opacity){ctx.globalAlpha=opacity;ctx.fillStyle=color;}
function drawTemplate(canvas,snapshot){
 const ctx=canvas.getContext('2d'),layout=templateTitleLayout(snapshot),s=snapshot.style,scale=canvas.height/1080;
 ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,canvas.width,canvas.height);ctx.save();
 try{
  if(layout.mask){ctx.fillStyle=layout.mask.color;ctx.fillRect(layout.mask.x,layout.mask.y,layout.mask.width,layout.mask.height);}
  ctx.textAlign='center';ctx.textBaseline='alphabetic';ctx.lineJoin='miter';
  for(const line of layout.lines){
   ctx.font=`${line.italic?'italic ':''}${line.fontWeight} ${line.fontSize}px "${s.renderFamily||s.fontFamily}"`;
   const metrics=ctx.measureText(line.text||'汉'),baseline=line.y+(metrics.fontBoundingBoxAscent-metrics.fontBoundingBoxDescent)/2;
   const stroke=s.stroke.enabled&&s.stroke.width?Number(Math.max(1,s.stroke.width*scale).toFixed(2)):0;
   ctx.lineWidth=stroke;
   if(s.shadow.enabled){const distance=Number(Math.max(1,(s.shadow.distance||3)*scale).toFixed(2));ctx.fillStyle=s.shadow.color;ctx.strokeStyle=s.shadow.color;ctx.fillText(line.text,line.x+distance,baseline+distance);if(stroke)ctx.strokeText(line.text,line.x+distance,baseline+distance);}
   // 原版CSS文字先填充再描边，描边宽度为总宽，不加倍。
   ctx.fillStyle=line.color;ctx.fillText(line.text,line.x,baseline);
   if(stroke){ctx.strokeStyle=s.stroke.color;ctx.strokeText(line.text,line.x,baseline);}
  }
 }finally{ctx.restore();}
 // 模板原版在整个媒体框接收按下；绘制元数据保留真实像素坐标供输出验收。
 return {x:0,y:0,width:1080,height:canvas.height/canvas.width*1080,rows:layout.lines.length,offsetX:0,offsetY:snapshot.design.offsetY,layout};
}
// 预览与成片共用透明图层；自定义沿用1080宽，模板使用原版独立参考系。
export function drawTitle(canvas,snapshot){
 if(snapshot.design.mode==='template')return drawTemplate(canvas,snapshot);
 if(snapshot.version>=3)throw new Error('新版自定义标题需要原生DOM绘制，请使用桌面后台绘制服务');
 const ctx=canvas.getContext('2d'),s=snapshot.style,scale=canvas.width/1080,h=canvas.height/scale,p=s.background,spacing=s.letterSpacing||0;
 ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,canvas.width,canvas.height);ctx.save();ctx.scale(scale,scale);
 ctx.font=`${s.italic?'italic ':''}${s.fontWeight||(s.bold?700:400)} ${s.fontSize}px "${s.renderFamily||s.fontFamily}"`;ctx.textBaseline='middle';ctx.lineJoin='round';
 const measure=text=>[...text].reduce((n,ch)=>n+ctx.measureText(ch).width,0)+Math.max(0,[...text].length-1)*spacing,maxWidth=1080-80-(p.enabled?p.paddingX*2:0),rows=[];
 for(const [text,color]of [[snapshot.main,s.color],[snapshot.sub,s.secondaryColor]])if(text.trim())for(const paragraph of text.split(/\r?\n/)){let row='';for(const ch of paragraph){if(row&&measure(row+ch)>maxWidth){rows.push({text:row,color});row='';}row+=ch;}rows.push({text:row,color});}
 const rowHeight=s.fontSize*1.3,width=Math.max(0,...rows.map(r=>measure(r.text))),height=rows.length*rowHeight,padX=p.enabled?p.paddingX:0,padY=p.enabled?p.paddingY:0;
 if(!rows.length){ctx.restore();return null;}
 if(height+padY*2>h-32){ctx.restore();throw new Error('标题超过画面可用高度，请减小字号或精简内容');}
 const x=Math.max(20+padX+width/2,Math.min(1060-padX-width/2,540+(s.templateOffsetX||0)+snapshot.design.offsetX)),top=Math.max(16+padY,Math.min(h-16-height-padY,s.top+snapshot.design.offsetY));
 if(p.enabled){ctx.save();colorAlpha(ctx,p.color,p.opacity*s.opacity);ctx.beginPath();ctx.roundRect(x-width/2-padX,top-padY,width+padX*2,height+padY*2,Math.min(p.radius,(height+padY*2)/2));ctx.fill();ctx.restore();}
 function letters(row,left,y,stroke=false){if(!spacing){ctx[stroke?'strokeText':'fillText'](row,left,y);return;}for(const ch of row){ctx[stroke?'strokeText':'fillText'](ch,left,y);left+=ctx.measureText(ch).width+spacing;}}
 rows.forEach((row,i)=>{const w=measure(row.text),left=x-w/2,y=top+rowHeight*(i+.5);ctx.globalAlpha=s.opacity;
  if(s.shadow.enabled){ctx.save();ctx.globalAlpha=s.opacity*s.shadow.opacity;ctx.fillStyle=s.shadow.color;letters(row.text,left+s.shadow.distance,y+s.shadow.distance);ctx.restore();}
  if(s.stroke.enabled){ctx.strokeStyle=s.stroke.color;ctx.lineWidth=s.stroke.width*2;letters(row.text,left,y,true);}ctx.fillStyle=row.color;letters(row.text,left,y);
  if(s.underline)ctx.fillRect(left,y+s.fontSize*.48,w,Math.max(1,s.fontSize*.045));
 });ctx.restore();return {x:x-width/2-padX,y:top-padY,width:width+padX*2,height:height+padY*2,rows:rows.length,offsetX:x-540-(s.templateOffsetX||0),offsetY:top-s.top};
}
