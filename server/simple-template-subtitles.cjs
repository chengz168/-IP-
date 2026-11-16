// 依据只读静态契约实现三种简约模板；横纵坐标与字号各自按原生基准取整。
const {simpleSubtitleIds}=require('./subtitle-output.mjs');
const stamp=t=>{const c=Math.max(0,Math.round(t*100));return `${Math.floor(c/360000)}:${String(Math.floor(c/6000)%60).padStart(2,'0')}:${String(Math.floor(c/100)%60).padStart(2,'0')}.${String(c%100).padStart(2,'0')}`;};
const plain=text=>String(text).replace(/\r\n?/g,'\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g,' ').replace(/\\/g,'＼').replace(/{/g,'｛').replace(/}/g,'｝');
const fade='\\alpha&HFF&\\t(0,200,1.2,\\alpha&H00&)';
const pop='\\fscx120\\fscy120\\alpha&HFF&\\t(0,220,1.4,\\fscx100\\fscy100\\alpha&H00&)';
const tilt='\\frz3\\alpha&HFF&\\t(0,220,1.3,\\frz0\\alpha&H00&)';
const zoom=scale=>`\\fscx${scale}\\fscy${scale}\\alpha&HFF&\\t(0,300,1.5,\\fscx100\\fscy100\\alpha&H00&)`;

function cycleMetrics(id,slot,width,height){
 const portrait=height>width,sx=v=>Math.round(v*width/1920),sy=v=>Math.round(v*height/1080);
 const base=sy(slot===5&&id!=='simple_brown_white'?(portrait?56:60):50);
 const x2=portrait?760:600,x3=portrait?920:id==='simple_yellow_white'?950:1000;
 let candidates=[960],factor=1;
 if(id==='simple_yellow_white'){
  candidates=slot===2?[x2]:slot===3?[x3]:[960];factor=slot<=3?1.5:1;
 }else if(id==='simple_blue_white'){
  candidates=slot===1?[960,1040,860]:slot===2?[x2,portrait?840:680]:slot===3?[x3,portrait?980:1080]:slot===4?[960,portrait?940:900]:slot===6?[960,1040]:[960];
  factor=slot<=3?1.5:[4,6].includes(slot)?1.2:1;
 }else{
  candidates=[1,6].includes(slot)?[960,1040]:slot===2?[x2,portrait?840:680]:slot===3?[x3,portrait?980:1080]:[960];factor=[2,4].includes(slot)?1.2:1;
 }
 const available=Math.max(1,Math.min(...candidates.map(v=>Math.min(sx(v),width-sx(v))))-sx(portrait?90:60));
 const safeWidth=Math.max(120,Math.floor((available*2-sx(portrait?120:80))/factor));
 return {fontSize:base,safeWidth,maxChars:Math.max(3,Math.floor(safeWidth/base))};
}

function fitText(text,metrics){
 // 保留普通文案；用户输入的ASS控制符只显示为文字，不能覆盖模板样式。
 const value=plain(text),size=value.length>metrics.maxChars?Math.max(Math.round(metrics.fontSize*.7),Math.floor(metrics.fontSize*metrics.maxChars/value.length)):null;
 return {value,size,text:(size===null?'':`{\\fs${size}}`)+value.replace(/\n/g,'\\N')};
}

function typewriter(fitted,cursor){
 // 真实字号标签在每个字符生效；补充平面字符保持完整，避免拆开代理对。
 let text=Array.from(fitted.value.replace(/\n/g,' ')).map((ch,index)=>`{\\alpha&HFF&\\t(${index*26},${index*26+55},1.2,\\alpha&H00&)${fitted.size===null?'':`\\fs${fitted.size}`}}${ch}`).join('');
 if(cursor)text+='{\\alpha&H00&\\t(0,140,\\alpha&HFF&)\\t(140,280,\\alpha&H00&)\\t(280,420,\\alpha&HFF&)\\t(420,560,\\alpha&H00&)}|';
 return text;
}

function toSimpleTemplateAss(rows,width,height,id,family,{speed=1,offsetY=0,signal}={}){
 if(!simpleSubtitleIds.includes(id))throw Error('当前模板没有简约字幕生成规则');
 const portrait=height>width,sx=v=>Math.round(v*width/1920),sy=v=>Math.round(v*height/1080),shift=sy(offsetY);
 const pos=(x,y)=>`\\pos(${sx(x)},${sy(y)-shift})`;
 const move=(x1,y1,x2,y2,ms=300)=>`\\move(${sx(x1)},${sy(y1)-shift},${sx(x2)},${sy(y2)-shift},0,${ms})`;
 const slide=(x1,y1,x2,y2)=>move(x1,y1,x2,y2,220)+'\\alpha&HFF&\\t(0,220,1.2,\\alpha&H00&)';
 const brown=id==='simple_brown_white',blue=id==='simple_blue_white',shadow=sy(brown?1:4),color=brown?'&H54719D&':blue?'&HFFA63A&':'&H00D7FF&';
 const colored=`\\1c${color}${brown?'\\4c&H000000&':''}\\shad${shadow}\\bord0\\an5`,white=`\\1c&HFFFFFF&\\shad${shadow}\\bord0\\an5`;
 const events=[],details=[];let seed=20260115;
 for(const [index,row]of rows.entries()){
  signal?.throwIfAborted();
  const slot=index%6+1,metrics=cycleMetrics(id,slot,width,height),fitted=fitText(row.text,metrics);
  const start=row.start/speed,end=([2,4].includes(slot)&&rows[index+1]?rows[index+1].end:row.end)/speed;
  let animation='';
  if(blue){seed=(seed*9301+49297)%233280;animation=['fade','pop','slide'][Math.floor(seed/233280*3)];}
  if(brown)animation=['fade','pop','slide','tilt','type','cursor'][index%6];
  const simple=kind=>kind==='fade'?fade:kind==='pop'?pop:kind==='tilt'?tilt:'';
  let tags='',text=fitted.text;
  if(brown){
   if(slot===1)tags=colored+pos(960,800)+fade;
   if(slot===2)tags=white+pos(portrait?760:600,750)+pop;
   if(slot===3)tags=colored+pos(portrait?920:1000,810)+slide(portrait?980:1080,810,portrait?920:1000,810);
   if(slot===4)tags=colored+move(960,700,960,720)+'\\fad(300,0)'+tilt;
   if(slot===5)tags=white+move(960,870,960,810)+`\\fs${sy(50)}\\fad(300,0)`;
   if(slot===6)tags=white+pos(960,800);
   if(slot>=5)text=typewriter(fitted,slot===6);
  }else if(blue){
   let added=simple(animation);
   if(slot===1){if(animation==='slide')added=slide(1040,900,860,900);tags=colored+pos(960,900)+zoom(150)+added;}
   if(slot===2){if(animation==='slide')added=slide(portrait?840:680,850,portrait?760:600,850);tags=white+pos(portrait?760:600,850)+zoom(150)+added;}
   if(slot===3){if(animation==='slide')added=slide(portrait?980:1080,950,portrait?920:1000,850);tags=colored+pos(portrait?920:1000,920)+zoom(150)+added;}
   if(slot===4)tags=colored+move(960,800,portrait?940:900,850)+'\\fad(300,0)'+simple(animation==='slide'?'pop':animation);
   if(slot===5)tags=white+move(960,1000,960,930)+`\\fs${sy(portrait?56:60)}\\fad(300,0)`;
   if(slot===6){if(animation==='slide')added=slide(1040,900,960,900);tags=white+pos(960,900)+zoom(50)+added;}
  }else{
   if(slot===1)tags=colored+pos(960,840)+zoom(150);
   if(slot===2)tags=white+pos(portrait?760:600,850)+zoom(150);
   if(slot===3)tags=colored+pos(portrait?920:950,900)+zoom(150);
   if(slot===4)tags=colored+move(960,800,960,850)+'\\fad(300,0)';
   if(slot===5)tags=white+move(960,960,960,900)+`\\fs${sy(portrait?56:60)}\\fad(300,0)`;
   if(slot===6)tags=white+pos(960,840)+zoom(50);
  }
  events.push(`Dialogue: 0,${stamp(start)},${stamp(end)},Default,,0,0,0,,{${tags}}${text}`);
  details.push({index,slot,start,end,animation:animation||([1,2,3].includes(slot)?'zoom150':slot===6?'zoom50':'move'),fontSize:metrics.fontSize,fittedFontSize:fitted.size,safeWidth:metrics.safeWidth});
 }
 const style=`Style: Default,${family},${sy(50)},&H00FFFFFF,&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,0,${blue?shadow:0},5,10,10,${brown?100:10},1`;
 const ass=`[Script Info]\nScriptType: v4.00+\nPlayResX: ${width}\nPlayResY: ${height}\nWrapStyle: 0\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n${style}\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n${events.join('\n')}`;
 return {ass,details,shift};
}
module.exports={toSimpleTemplateAss,cycleMetrics};
