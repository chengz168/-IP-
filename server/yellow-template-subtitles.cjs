const {fitRow,plainTags,builder,warm}=require('./native-subtitle-common.cjs');
const yellowSubtitleIds=['yellow_white_split','yellow_white_italic','yellow_white_calligraphy','yellow_white_bounce','yellow_box_white'];
const yellow='&H00D7FF&',white='&HFFFFFF&';
// 字宽为模板的估算契约，不能用字体测量或统一宽度替换。
function yellowCharWidth(char,size){const factor=char===' '?.35:'，。！？、；：.!?;:·…'.includes(char)?.45:char.charCodeAt(0)<=127?.55:1;return 40*factor*(size/40);}
function characterPositions(units,size,center,spacing=0){
 const widths=units.map(u=>yellowCharWidth(u.char,size)),total=widths.reduce((n,v)=>n+v,0)+Math.max(0,units.length-1)*spacing;let cursor=center-total/2;
 return units.map((u,i)=>{const x=Math.floor(cursor+widths[i]/2);cursor+=widths[i]+spacing;return {...u,x};});
}
function yellowMetrics(id,slot,width,height){
 const sx=v=>Math.round(v*width/1920),sy=v=>Math.round(v*height/1080),portrait=height>width;let fontSize=sy(50),maxChars=Math.floor((width-20)/fontSize),minimum=.75,centerX=sx(960);
 if(id==='yellow_white_italic'){
  fontSize=sy(slot===3?(portrait?56:60):50);minimum=.7;
  const factor=slot===1?1.2:[2,3,4,8,9].includes(slot)?1:1.5;
  maxChars=Math.max(3,Math.floor(Math.max(fontSize*3,Math.floor((width-sx(70)*2)/factor))/fontSize));
 }else if(id==='yellow_white_bounce'){
  fontSize=sy(slot===5?(portrait?78:90):65);minimum=.7;centerX=sx(slot===2?(portrait?760:600):slot===3?(portrait?920:1000):960);
  const available=Math.max(1,Math.min(centerX,width-centerX)-sx(60));maxChars=Math.max(3,Math.floor(Math.max(fontSize*3,available*2)/fontSize));
 }
 return {fontSize,maxChars,minimum,centerX};
}
function toYellowTemplateAss(rows,width,height,id,family,{speed=1,offsetY=0,keywords=false,signal}={}){
 if(!yellowSubtitleIds.includes(id))throw Error('当前模板没有黄白系列字幕规则');
 const sx=v=>Math.round(v*width/1920),sy=v=>Math.round(v*height/1080),shift=sy(offsetY),time=v=>Math.round(v/speed*100),b=builder(width,height),details=[];
 const pos=(x,y)=>`\\pos(${Math.round(x)},${Math.round(y)-shift})`,move=(a,c,d,e,ms)=>`\\move(${Math.round(a)},${Math.round(c)-shift},${Math.round(d)},${Math.round(e)-shift},0,${ms})`,clip=(a,c,d,e)=>`\\clip(${Math.round(a)},${Math.round(c)-shift},${Math.round(d)},${Math.round(e)-shift})`;
 const base=sy(50),x=sx(960),text=(f)=>plainTags(f),units=f=>f.units.map(u=>({...u,char:u.char==='\n'?' ':u.char})),fs=f=>f.fontSize===null?'':`\\fs${f.fontSize}`;
 const period=id==='yellow_white_italic'?10:id==='yellow_white_bounce'?6:4;
 const fitted=rows.map((row,i)=>{const metrics=yellowMetrics(id,i%period+1,width,height);return fitRow(row,metrics.fontSize,metrics.maxChars,metrics.minimum,keywords);});
 if(id==='yellow_box_white'){
  b.addStyle({name:'TypeBox',fontname:family,fontsize:base,bold:true,outlineColor:'&H0000E0FF&',borderStyle:3,outline:sy(8),alignment:2,marginV:20});
  b.addStyle({name:'TypeText',fontname:family,fontsize:base,bold:true,shadow:sy(1),alignment:2,marginV:20});
 }else b.addStyle({fontname:family,fontsize:base,bold:true,italic:id==='yellow_white_italic',outline:id==='yellow_white_split'?sy(5):['yellow_white_italic','yellow_white_calligraphy'].includes(id)?sy(2):0,alignment:id==='yellow_white_calligraphy'?2:5,marginV:id==='yellow_white_calligraphy'?20:10});
 function emit(start,end,t,style='Default',layer=0){b.emit(start,end,t,style,layer);}
 function gradient(start,end,value,y,extra='',prefix='',layer=0){for(const [color,top,bottom]of [[white,y-60,y],[yellow,y,y+60]])emit(start,end,`{${prefix}\\3c&H000000&\\bord${sy(4)}\\shad0\\an5\\1c${color}${pos(x,y)}${clip(0,top,width,bottom)}${extra}}${value}`,'Default',layer);}
 function segments(start,end,f,y,{gradient:twoColors=false,glow=false}={}){
  const chars=units(f),step=Math.min(5,Math.max(1,Math.floor(Math.max(1,end-start)/(chars.length+2))));let cursor=start,value='';
  const paint=(from,to,v)=>{if(twoColors)gradient(from,to,v,y,fs(f));else emit(from,to,`{\\3c&H000000&\\bord${sy(4)}\\shad0\\an5\\1c${white}${pos(x,y)}${fs(f)}}${v}`);if(glow)emit(from,to,`{\\1c${white}\\bord0\\shad0\\blur8\\alpha&H80&${pos(x,y)}${fs(f)}}${v}`,'Default',1);};
  for(const char of chars){value+=char.char;const next=Math.min(end,cursor+step);if(next<=cursor)break;paint(cursor,next,value);cursor=next;if(cursor>=end)break;}
  if(cursor<end)paint(cursor,end,chars.map(u=>u.char).join(''));
  return step;
 }
 rows.forEach((row,i)=>{
  signal?.throwIfAborted();const slot=i%period+1,f=fitted[i],start=time(row.start);let end=time(row.end),color=white,tags='',step;
  if(id==='yellow_white_italic'){
   if([2,6,9].includes(slot)&&rows[i+1])end=time(rows[i+1].end);
   if(slot===5){if(rows[i+2])end=time(rows[i+2].end);else if(rows[i+1])end=time(rows[i+1].end);}
   const y=sy(800),gap=sy(60);color=[2,3,5,6,7,8,10].includes(slot)?yellow:white;
   if(slot===1)tags=pos(x,sy(900))+'\\fscx120\\fscy120\\t(0,100,\\fscx100\\fscy100)';
   if(slot===2)tags=move(sx(-500),y-gap*.5,x,y-gap*.5,300);
   if(slot===3)tags=`\\fs${sy(height>width?56:60)}`+move(sx(2420),y+gap*.5,x,y+gap*.5,300);
   if(slot===4)tags=pos(x,sy(900))+'\\fscx50\\fscy50\\alpha&HFF&\\t(0,300,\\fscx100\\fscy100\\alpha&H00&)';
   if([5,6,7].includes(slot))tags=pos(x,y+(slot-6)*gap)+'\\fscx150\\fscy150\\t(0,300,\\fscx100\\fscy100)';
   if(slot===8)tags=move(sx(2420),sy(900),x,sy(900),300);
   if(slot===9)tags=move(x,sy(1200),x,y-gap*.5,300);
   if(slot===10)tags=pos(x,y+gap*.5)+'\\fscx150\\fscy150\\alpha&HFF&\\t(0,300,\\fscx100\\fscy100\\alpha&H00&)';
   emit(start,end,`{\\1c${color}\\3c&H000000&\\bord${sy(2)}\\shad0\\an5${tags}}${text(f)}`);
  }else if(id==='yellow_white_split'){
   const y=sy(900),edge=sy(5),common=c=>`\\1c${c}\\3c&H000000&\\bord${edge}\\shad0`;
   if(slot===1){const chars=characterPositions(units(f),f.size,x),window=Math.max(180,Math.floor(Math.max(300,(end-start)*10)*.65));step=Math.max(40,Math.floor(window/Math.max(1,chars.length)));chars.forEach((u,j)=>emit(start,end,`{${common(yellow)}\\fs${f.size}\\an2${pos(u.x,y)}\\alpha&HFF&\\t(${j*step},${Math.min(window,(j+1)*step)},1.0,\\alpha&H00&)}${u.char}`));}
   else if(slot===2){
    emit(start,end,`{${common(white)}\\an5${fs(f)}${pos(x,y)}\\fscx70\\fscy70\\t(0,180,1.8,\\fscx170\\fscy170)\\t(180,340,1.6,\\fscx100\\fscy100)}${units(f).map(u=>u.char).join('')}`,'Default',1);
    if(i>0){const previous=fitted[i-1].value.replace(/\n/g,'\\N'),span=sx(1700);emit(start,end,`{${common(yellow)}\\an5${pos(x-10,y-14)}${clip(x-span/2-10,y-140-14,x+span/2-10,y-14)}}${previous}`);emit(start,end,`{${common(yellow)}\\an5${pos(x+10,y+14)}${clip(x-span/2+10,y+14,x+span/2+10,y+140+14)}}${previous}`);}
   }else{color=slot===3?yellow:white;tags=move(x,y+(slot===3?-sy(50):sy(50)),x,y,260)+`\\fscx${slot===3?70:150}\\fscy${slot===3?70:150}\\t(0,260,1.6,\\fscx100\\fscy100)`;emit(start,end,`{${common(color)}\\an5${fs(f)}${tags}}${text({...f,fontSize:null})}`);}
  }else if(id==='yellow_white_calligraphy'){
   if(slot===2&&rows[i+1])end=time(rows[i+1].end);
   if(slot===1)gradient(start,end,units(f).map(u=>u.char).join(''),sy(860),fs(f),'\\fscx130\\fscy130\\blur6\\alpha&HFF&\\t(0,320,1.4,\\fscx100\\fscy100\\blur0\\alpha&H00&)');
   if(slot===2||slot===3)step=segments(start,end,f,sy(slot===2?740:800),{gradient:slot===3,glow:slot===3});
   if(slot===4){
    const chars=units(f),from=start*10,to=end*10,span=Math.max(120,Math.floor(Math.max(10,to-from)*.6)),limit=Math.min(to,from+span),interval=Math.max(70,Math.floor(span/Math.max(1,chars.length)));let completed=null;
    for(let j=0;j<chars.length;j++){const a=from+j*interval,c=Math.min(limit,from+(j+1)*interval);if(a>=limit)break;if(c<=a)continue;const value=chars.slice(0,j+1).map(u=>u.char).join(''),ms=Math.min(240,Math.max(40,c-a)),y=sy(860),motion=move(x+60,y,x,y,ms)+`\\blur10\\alpha&H40&\\t(0,${ms},1.6,\\blur0\\alpha&H00&)`;gradient(Math.floor(a/10),Math.floor(c/10),value,y,fs(f),motion);emit(Math.floor(a/10),Math.floor(c/10),`{\\1c${yellow}\\3c&H000000&\\bord0\\shad0\\blur14\\alpha&HAA&${fs(f)}${move(x+80,y,x,y,ms)}}${value}`,'Default',1);if(j===chars.length-1)completed=c;}
    const hold=Math.min(Math.max(completed??limit,from),to);if(hold<to)gradient(Math.floor(hold/10),Math.floor(to/10),chars.map(u=>u.char).join(''),sy(860),fs(f));step=interval;
   }
  }else if(id==='yellow_white_bounce'){
   if([2,4].includes(slot)&&rows[i+1])end=time(rows[i+1].end);
   const normal=sy(65),fittedSize=f.fontSize??normal,size=slot===5?Math.round(sy(height>width?78:90)*fittedSize/normal):fittedSize,metrics=yellowMetrics(id,slot,width,height),y=sy([900,850,950,850,950,900][slot-1]),chars=characterPositions(units(f),size,metrics.centerX,-20),window=Math.max(200,Math.floor(Math.max(300,(end-start)*10)*.7));
   step=Math.max(90,Math.floor(window/Math.max(1,chars.length)));const up=Math.max(40,Math.floor(step*.55)),down=Math.max(30,step-up);color=[1,3,4].includes(slot)?yellow:white;
   chars.forEach((u,j)=>{const delay=j*step,keyword=f.keywordColors?`\\c${u.highlighted?warm:color}`:'';emit(start,end,`{\\1c${color}\\shad${sy(4)}\\bord0\\an2${pos(u.x,y)}\\fs${size}\\fscx100\\fscy100\\t(${delay},${delay+up},1.4,\\fscy135)\\t(${delay+up},${delay+up+down},1.2,\\fscy100)${keyword}}${u.char}`);});
  }else{
   const chars=units(f),y=sy(840);step=Math.min(5,Math.max(1,Math.floor(Math.max(1,end-start)/(chars.length+2))));let cursor=start,value='';
   const paint=(a,c,t)=>{for(const style of ['TypeBox','TypeText'])emit(a,c,`{${pos(x,y)}}${t}`,style);};
   for(const u of chars){value+=`{${fs(f)}${f.keywordColors?`\\c${u.highlighted?warm:white}`:''}}${u.char}`;const next=Math.min(end,cursor+step);if(next<=cursor)break;paint(cursor,next,value+'|');cursor=next;if(cursor>=end)break;}
   if(cursor<end)paint(cursor,end,value);
  }
  details.push({index:i,slot,startCs:start,endCs:end,fittedFontSize:f.fontSize,...(step===undefined?{}:{step})});
 });
 return {ass:b.content(),shift,eventCount:b.events.length,details};
}
module.exports={toYellowTemplateAss,yellowSubtitleIds,yellowMetrics,yellowCharWidth};
