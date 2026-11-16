import {textStyle} from './cover-model.mjs';
export function canvasFont(style){return `${style.italic?'italic ':''}${style.bold?'700':'400'} ${style.fontSize}px "${String(style.renderFamily||style.fontFamily).replace(/["\\]/g,'')}","Microsoft YaHei",sans-serif`;}
function rowWidth(ctx,text,spacing){return [...text].reduce((sum,ch)=>sum+ctx.measureText(ch).width,0)+Math.max(0,[...text].length-1)*spacing;}
export function layoutText(ctx,layer){
  const s=textStyle(layer.style);ctx.font=canvasFont(s);const rows=[];
  // 原版启用文字背景并指定宽度时，文字与背景使用相同折行宽度。
  const width=s.background.enabled&&Number(s.background.width)>0?Number(s.background.width):s.boxWidth;
  for(const paragraph of String(layer.text).split(/\r?\n/)){let row='';for(const ch of paragraph){if(row&&rowWidth(ctx,row+ch,s.letterSpacing)>width){rows.push(row);row='';}row+=ch;}rows.push(row);}
  const widths=rows.map(row=>rowWidth(ctx,row,s.letterSpacing)),height=Math.max(1,rows.length)*s.fontSize*s.lineHeight;
  return {id:layer.id,style:s,rows,widths,width,height,left:s.align==='left'?0:s.align==='right'?-width:-width/2};
}
function rectangle(ctx,x,y,w,h,r=0){ctx.beginPath();ctx.roundRect(x,y,w,h,Math.min(Math.max(0,r),w/2,h/2));}
function maskPaint(ctx,mask){
  if(!mask?.enabled)return;ctx.save();ctx.globalAlpha=mask.opacity??1;
  const x=mask.x||0,y=mask.y||0,w=mask.width||1080,h=mask.height||1920;
  rectangle(ctx,x,y,w,h,mask.radius);
  if(mask.fillLinearGradientColorStops||mask.gradient){let g;if(mask.fillLinearGradientColorStops){const a=mask.fillLinearGradientStartPoint,b=mask.fillLinearGradientEndPoint;g=ctx.createLinearGradient(x+a.x,y+a.y,x+b.x,y+b.y);const stops=mask.fillLinearGradientColorStops;for(let i=0;i<stops.length;i+=2)g.addColorStop(stops[i],stops[i+1]);}else{const angle=mask.gradientAngle*Math.PI/180,dx=Math.cos(angle)*w/2,dy=Math.sin(angle)*h/2;g=ctx.createLinearGradient(x+w/2-dx,y+h/2-dy,x+w/2+dx,y+h/2+dy);g.addColorStop(0,colorAlpha(mask.gradientStartColor,mask.gradientStartOpacity));g.addColorStop(1,colorAlpha(mask.gradientColor,mask.gradientOpacity));}ctx.fillStyle=g;}else ctx.fillStyle=mask.color||'#000000';ctx.fill();
  if(mask.stroke?.enabled){ctx.strokeStyle=mask.stroke.color;ctx.lineWidth=mask.stroke.width;ctx.stroke();}ctx.restore();
}
export function colorAlpha(color,alpha){const hex=/^#([\da-f]{6})$/i.exec(color);return hex?`rgba(${parseInt(hex[1].slice(0,2),16)},${parseInt(hex[1].slice(2,4),16)},${parseInt(hex[1].slice(4,6),16)},${alpha})`:color;}
function letters(ctx,row,x,y,s,stroke=false){
  if(!s.letterSpacing){(stroke?ctx.strokeText:ctx.fillText).call(ctx,row,x,y);return;}
  for(const ch of row){(stroke?ctx.strokeText:ctx.fillText).call(ctx,ch,x,y);x+=ctx.measureText(ch).width+s.letterSpacing;}
}
export function drawCover(canvas,scene,background=null,blur=0){
  const {width,height}=scene,ctx=canvas.getContext('2d');ctx.save();ctx.setTransform(canvas.width/width,0,0,canvas.height/height,0,0);ctx.clearRect(0,0,width,height);
  const gradient=ctx.createLinearGradient(0,0,0,height);gradient.addColorStop(0,'#3c3c3b');gradient.addColorStop(1,'#111111');ctx.fillStyle=gradient;ctx.fillRect(0,0,width,height);
  if(background){ctx.save();ctx.filter=blur?`blur(${blur}px)`:'none';const ratio=Math.max(width/background.width,height/background.height),w=background.width*ratio,h=background.height*ratio;ctx.drawImage(background,(width-w)/2,(height-h)/2,w,h);ctx.restore();}
  maskPaint(ctx,scene.mask);for(const shape of scene.shapes||[]){ctx.save();ctx.globalAlpha=shape.opacity??1;ctx.fillStyle=shape.fill||'#FFFFFF';rectangle(ctx,shape.x,shape.y,shape.width,shape.height,shape.radius);ctx.fill();ctx.restore();}
  const layouts=[];
  for(const layer of scene.layers){
    const layout=layoutText(ctx,layer),s=layout.style;layouts.push(layout);ctx.save();ctx.translate(s.x,s.y);ctx.rotate(s.rotation*Math.PI/180);ctx.globalAlpha=s.opacity;ctx.font=canvasFont(s);ctx.textAlign='left';ctx.textBaseline='middle';ctx.lineJoin='round';
    if(s.background.enabled){const w=s.background.width??layout.width+32,h=s.background.height??layout.height+20;ctx.fillStyle=colorAlpha(s.background.color,s.background.opacity);rectangle(ctx,layout.left+layout.width/2-w/2,-h/2,w,h,s.background.radius);ctx.fill();}
    for(const [index,row]of layout.rows.entries()){const x=layout.left+(s.align==='left'?0:s.align==='right'?layout.width-layout.widths[index]:(layout.width-layout.widths[index])/2),y=(index-(layout.rows.length-1)/2)*s.fontSize*s.lineHeight;
      if(s.shadow.enabled){ctx.save();ctx.shadowColor=colorAlpha(s.shadow.color,s.shadow.opacity);ctx.shadowBlur=s.shadow.blur;ctx.shadowOffsetX=s.shadow.distance;ctx.shadowOffsetY=s.shadow.distance;ctx.fillStyle=s.color;letters(ctx,row,x,y,s);ctx.restore();}
      if(s.stroke.enabled){ctx.lineWidth=s.stroke.width;ctx.strokeStyle=s.stroke.color;letters(ctx,row,x,y,s,true);}ctx.fillStyle=s.color;letters(ctx,row,x,y,s);
      if(s.underline){ctx.fillStyle=s.color;ctx.fillRect(x,y+s.fontSize*.48,layout.widths[index],Math.max(1,s.fontSize*.045));}
    }ctx.restore();
  }ctx.restore();return layouts;
}
