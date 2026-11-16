const {warm,fitRow,plainTags,animatedChars,builder}=require('./native-subtitle-common.cjs');
const motionSubtitleIds=['scrolling_3lines','scrolling_4lines','3d_flip','purple_slide','red_yellow','red_blue_science'];

function toMotionTemplateAss(rows,width,height,id,family,{speed=1,offsetY=0,keywords=false,signal}={}){
 if(!motionSubtitleIds.includes(id))throw Error('当前模板没有滚动或立体字幕生成规则');
 const portrait=height>width,sx=v=>Math.round(v*width/1920),sy=v=>Math.round(v*height/1080),shift=sy(offsetY),b=builder(width,height),details=[];
 const time=v=>Math.round(v/speed*100),pos=(x,y)=>`\\pos(${x},${y-shift})`,move=(x1,y1,x2,y2,ms=300)=>`\\move(${x1},${y1-shift},${x2},${y2-shift},0,${ms})`;
 const x=Math.round(width/2),base=sy(id==='3d_flip'||id.startsWith('scrolling_')?45:50);
 let maxChars=Math.floor((width-20)/base),minimum=.75,xFront,entryX;
 if(id.startsWith('scrolling_'))maxChars=Math.floor((width-sx(250)-100)/base);
 if(id==='3d_flip'){
  xFront=sx(portrait?520:600);entryX=xFront+sx(portrait?100:140);minimum=.7;
  maxChars=Math.max(3,Math.floor(Math.max(width-entryX-sx(portrait?120:80)-sx(portrait?140:90),base*3)/base));
 }
 const fitted=rows.map(row=>fitRow(row,base,maxChars,minimum,keywords));
 const emit=(start,end,text,name,layer)=>b.emit(start,end,text,name,layer);
 if(id.startsWith('scrolling_')){
  const three=id==='scrolling_3lines',y=sy(800),gap=sy(65),at=sx(250),entry=sx(200),border=sy(6),inner=sy(2);
  for(const active of [true,false])b.addStyle({name:active?'Active':'Inactive',fontname:family,fontsize:active?base:sy(30),primary:active?'&H00FFFFFF':three?'&H4000D7FF':'&H40FFFFFF',secondary:active?'&H00808080':'&H00FFFFFF',bold:true,italic:true,alignment:three?1:7,marginL:sx(200),marginR:100,marginV:three?20:100});
  function line(start,end,index,movement,active){
   const f=fitted[index],text=active?karaoke(f,start,end,three?'&H00D7FF&':'&HFFFFFF&'):plainTags(f,three?'&H00D7FF&':'&HFFFFFF&'),name=active?'Active':'Inactive',alpha=active?'':'\\alpha&H80&';
   if(three){emit(start,end,`{\\bord${border}\\3c&HFFFFFF&\\1c&HFFFFFF&\\2c&HFFFFFF&${alpha}}{${movement}}${text}`,name);emit(start,end,`{\\bord${inner}\\3c&H000000&\\1c&H00D7FF&\\2c&HFFFFFF&${alpha}}{${movement}}${text}`,name);}
   else emit(start,end,`{${movement}}${text}`,name);
  }
  function karaoke(f,start,end,color){
   const units=f.units.filter(u=>u.char!=='\n'),duration=end-start,length=units.length,part=Math.floor(duration/length),remaining=duration%length;
   return units.map((u,i)=>`{\\k${part+(i<remaining?1:0)}${f.fontSize===null?'':`\\fs${f.fontSize}`}${f.keywordColors?`\\c${u.highlighted?warm:color}`:''}}${u.char}`).join('');
  }
  rows.forEach((row,i)=>{
   signal?.throwIfAborted();const start=time(row.start);let end=time(row.end),next=rows[i+1]?time(rows[i+1].start):null;
   if(next!==null&&next>end&&next-end<1000)end=next;
   if(i>0)line(start,end,i-1,move(at,y,at,y-gap),false);
   line(start,end,i,move(entry,i===0?y:y+gap,at,y,i===0?200:300),true);
   if(rows[i+1])line(start,end,i+1,i===0?pos(entry,y+gap):move(entry,y+2*gap,entry,y+gap),false);
   if(!three&&rows[i+2])line(start,end,i+2,i===0?pos(entry,y+2*gap):move(entry,y+3*gap,entry,y+2*gap),false);
   details.push({index:i,startCs:start,endCs:end,fittedFontSize:fitted[i].fontSize,active:true});
  });
 }else if(id==='3d_flip'){
  b.addStyle({name:'Style3DFlip',fontname:family,fontsize:base,shadow:1,alignment:4});
  rows.forEach((row,i)=>{
   signal?.throwIfAborted();const start=time(row.start),end=time(row.end),group=Math.floor(i/3),next=(group+1)*3,next2=(group+2)*3,frontEnd=rows[next]?time(rows[next].start):end+150,backEnd=rows[next2]?time(rows[next2].start):frontEnd+200,y=sy([800,850,900][i%3]);
   const origin=`\\org(${sx(portrait?320:400)},${sy(800)-shift})`,baseTags=origin+'\\bord0\\shad2\\an4',text=plainTags(fitted[i]);
   emit(start,frontEnd,`{${baseTags}${move(entryX,y-base,xFront,y,200)}\\fry12\\fax-0.05\\t(0,200,1.5,\\fry0\\fax0)\\fad(160,0)}${text}`,'Style3DFlip');
   emit(frontEnd,backEnd,`{${baseTags}${move(xFront,y,sx(-50),y)}\\t(0,300,1.5,\\fry-10\\fax0.5\\fscx60\\fscy60\\alpha&H99&)}${text}`,'Style3DFlip');
   details.push({index:i,group,startCs:start,frontEndCs:frontEnd,backEndCs:backEnd,fittedFontSize:fitted[i].fontSize});
  });
 }else if(id==='purple_slide'){
  const outline=sy(4),y=sy(840),px=sx(10),py=sy(12);
  b.addStyle({name:'Txt',fontname:family,fontsize:base,bold:true,outline,alignment:1,marginV:20});
  rows.forEach((row,i)=>{
   signal?.throwIfAborted();const f=fitted[i],start=time(row.start),end=time(row.end),units=f.units.map(u=>({...u,char:u.char==='\n'?' ':u.char}));while(units[0]?.char===' ')units.shift();while(units.at(-1)?.char===' ')units.pop();
   const size=f.size,widths=units.map(u=>purpleCharWidth(u.char,size)),left=Math.floor(x-widths.reduce((a,c)=>a+c,0)/2),top=y-Math.floor(size)-py,boxHeight=Math.floor(size)-Math.floor(size*.08)+2*py,step=Math.min(5,Math.max(1,Math.floor(Math.max(1,end-start)/(units.length+2)))),edge=Math.max(1,Math.round(outline*size/base));
   let cursor=start,at=left,count=0;
   units.forEach((unit,j)=>{
    const width=widths[j],center=Math.floor(at+width/2),boxLeft=Math.floor(at-px),boxWidth=Math.floor(width+2*px);at+=width;
    const next=Math.min(end,cursor+step);if(next<=cursor)return;
    if(unit.char!==' '){emit(cursor,end,`{\\an7${pos(boxLeft,top)}\\p1\\bord0\\shad0\\1c&HFF3D7A&}m 0 0 l ${boxWidth} 0 l ${boxWidth} ${boxHeight} l 0 ${boxHeight}`,'Txt',0);emit(cursor,end,`{\\an2${pos(center,y)}\\fs${size}\\1c${unit.highlighted?warm:'&HFFFFFF&'}\\3c&H000000&\\bord${edge}\\shad0}${unit.char}`,'Txt',1);count++;}cursor=next;
   });
   details.push({index:i,startCs:start,endCs:end,stepCs:step,characters:count,fittedFontSize:f.fontSize});
  });
 }else{
  const science=id==='red_blue_science',y=sy(840),outline=science?sy(2):0,shadow=sy(2);
  b.addStyle({fontname:family,fontsize:base,bold:true,outline,shadow:science?0:sy(3),outlineColor:science?'&H00FFFFFF':'&H00000000',alignment:science?5:2,marginV:science?10:20});
  rows.forEach((row,i)=>{
   signal?.throwIfAborted();const f=fitted[i],slot=i%(science?5:7)+1,start=time(row.start);let end=time(row.end),tags='',text='';
   if(science){
    if([1,4].includes(slot)&&rows[i+1])end=time(rows[i+1].end);
    const common=`\\3c&HFFFFFF&\\bord${outline}\\shad0\\4c&H000000&\\an5`,color=slot===1||slot===5?'&H0000FF&':slot===3?'&H00D7FF&':'&HFF6600&';
    tags=common+(slot===5?move(x,y-sy(35),x,y,260):pos(x,slot===2||slot===4?sy(900):y));
    if(slot<=2)text=animatedChars(f,(u,j,fs)=>`{\\1c${u.highlighted?warm:color}\\alpha&HFF&\\fscx30\\fscy30\\t(${j*35},${j*35+60},1.2,\\alpha&H00&\\fscx100\\fscy100)${fs}}${u.char}`);
    else{tags+=`\\1c${color}\\fad(200,0)`;text=plainTags(f,color);}
   }else{
    if(slot===3&&rows[i+1])end=time(rows[i+1].end);if(slot===5&&rows[i+2])end=time(rows[i+2].end);
    const points=[[x,y],[x,y],[x-sx(30),y-sy(30)],[x+sx(70),y+sy(20)],[x,y],[x-sx(240),y-sy(70)],[x+sx(240),y+sy(70)]],color=slot===2||slot===7?warm:slot===6?'&H0000FF&':'&HFFFFFF&',border=slot===4||slot===6?1:0;
    tags=pos(...points[slot-1])+`\\1c${color}\\bord${border}\\shad${shadow}\\4c&H000000&\\an5`;
    if(slot===2)text=animatedChars(f,(u,j,fs)=>`{\\alpha&HFF&\\t(${j*24},${j*24+50},1.2,\\alpha&H00&)${fs}${f.keywordColors?`\\c${u.highlighted?warm:color}`:''}}${u.char}`);
    else{if([4,6,7].includes(slot)){const scale=slot===7?140:60,ms=slot===6?240:260;tags+=`\\fscx${scale}\\fscy${scale}\\alpha&HFF&\\t(0,${ms},1.4,\\fscx100\\fscy100\\alpha&H00&)`;}else tags+='\\fad(200,0)';text=plainTags(f,color);}
   }
   emit(start,end,`{${tags}}${text}`);details.push({index:i,slot,startCs:start,endCs:end,fittedFontSize:f.fontSize});
  });
 }
 return {ass:b.content(),shift,eventCount:b.events.length,details};
}
function purpleCharWidth(char,size){if(char===' ')return size*.35;if('，。！？、；：.!?;:·…'.includes(char))return size*.45;if(char.charCodeAt(0)<=127)return size*.6;return size*1.05;}
module.exports={toMotionTemplateAss,motionSubtitleIds,purpleCharWidth};
