function wrapLines(text,maxUnits){
  const rows=[];
  for(const paragraph of String(text).split(/\r?\n/)){let line='',units=0;for(const ch of paragraph){const width=/[\u0000-\u007f]/.test(ch)?.6:1;if(units+width>maxUnits&&line){rows.push(line);line='';units=0;}line+=ch;units+=width;}rows.push(line);}
  return rows;
}
function toAss(rows,width,height,{speed=1,marginV=80,fontSize=48,style='white',position='bottom',maxChars=18}={}){
  const size=Number(fontSize),chars=Number(maxChars),margin=Number(marginV);
  if(!Number.isFinite(size)||size<20||size>120||!Number.isInteger(chars)||chars<4||chars>40||!Number.isFinite(margin)||margin<0||margin>height*.9)throw new Error('字幕字号、断句或边距参数无效');
  if(!['white','yellow','box'].includes(style)||!['bottom','middle','top'].includes(position))throw new Error('字幕样式或位置无效');
  const stamp=t=>{const cents=Math.max(0,Math.round(t*100));return String(Math.floor(cents/360000)).padStart(2,'0')+':'+String(Math.floor(cents/6000)%60).padStart(2,'0')+':'+String(Math.floor(cents/100)%60).padStart(2,'0')+'.'+String(cents%100).padStart(2,'0');};
  const escape=text=>wrapLines(String(text).replace(/\\/g,'＼').replace(/{/g,'｛').replace(/}/g,'｝'),chars).join('\\N');
  const color=style==='yellow'?'&H0000E8FF':'&H00FFFFFF',alignment=position==='top'?8:position==='middle'?5:2;
  return `[Script Info]\nScriptType: v4.00+\nPlayResX: ${width}\nPlayResY: ${height}\nWrapStyle: 2\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Microsoft YaHei,${Math.round(size*width/1080)},${color},${color},&H00101010,&H80000000,0,0,0,0,100,100,0,0,${style==='box'?3:1},2,1,${alignment},${Math.round(width*.08)},${Math.round(width*.08)},${Math.round(margin)},1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`+rows.map(r=>`Dialogue: 0,${stamp(r.start/speed)},${stamp(r.end/speed)},Default,,0,0,0,,${escape(r.text)}`).join('\n');
}
module.exports={toAss,wrapLines};
