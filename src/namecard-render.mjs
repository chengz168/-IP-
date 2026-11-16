import {prepareCoverFonts} from './cover-fonts.mjs';
export async function prepareNamecard(snapshot,fonts,load){
 try{const prepared=await prepareCoverFonts({layers:[{style:snapshot.design}]},fonts,load);return {...snapshot,design:prepared.layers[0].style};}
 catch(error){throw Error(error.message.replace(/封面/g,'名片'),{cause:error});}
}
// 前台和成片共用透明PNG，横坐标以1080、纵坐标以1920为基准。
export function drawNamecard(canvas,snapshot){
 const {width,height,design:s}=snapshot,ctx=canvas.getContext('2d'),sx=width/1080,sy=height/1920;
 canvas.width=width;canvas.height=height;ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,width,height);
 const spacing=s.letterSpacing*sx,size=s.fontSize*sy,padX=s.backgroundPaddingX*sx,padY=s.backgroundPaddingY*Math.min(2,Math.max(.6,s.fontSize/24))*sy,gap=s.lineSpacing*sy,family=s.renderFamily||s.fontFamily;
 const rows=[{text:snapshot.name,size:size*.82,weight:s.nameBold?900:400,line:1.02},...snapshot.lines.map(text=>({text,size:size*.5,weight:400,line:1.08}))];
 const font=row=>`${row.weight} ${row.size}px "${family}"`;
 const measure=row=>{ctx.font=font(row);return [...row.text].reduce((sum,ch)=>sum+ctx.measureText(ch).width,0)+Math.max(0,[...row.text].length-1)*spacing;};
 const boxWidth=Math.max(...rows.map(measure))+padX*2,boxHeight=rows.reduce((sum,r)=>sum+r.size*r.line,0)+gap*(rows.length-1)+padY*2;
 if(boxWidth>width||boxHeight>height)throw Error('名片内容超出画面，请缩小字号、背景尺寸或精简文字');
 const x=Math.max(0,Math.min(width-boxWidth,s.offsetX*sx)),y=Math.max(0,Math.min(height-boxHeight,height-s.offsetY*sy-boxHeight));
 ctx.save();ctx.fillStyle=s.backgroundColor;ctx.globalAlpha=s.backgroundOpacity;ctx.beginPath();ctx.roundRect(x,y,boxWidth,boxHeight,Math.min(s.backgroundRadius*Math.min(sx,sy),boxWidth/2,boxHeight/2));ctx.fill();ctx.restore();
 let top=y+padY;ctx.textBaseline='middle';ctx.fillStyle=s.textColor;ctx.globalAlpha=s.opacity;
 for(const row of rows){ctx.font=font(row);let left=x+padX;const cy=top+row.size*row.line/2;for(const ch of row.text){ctx.fillText(ch,left,cy);left+=ctx.measureText(ch).width+spacing;}top+=row.size*row.line+gap;}
 ctx.globalAlpha=1;return {x,y,width:boxWidth,height:boxHeight};
}
