const {fitRow,plainTags,builder,warm}=require('./native-subtitle-common.cjs');
const bilingualSubtitleIds=['black_white_bilingual','yellow_white_bilingual','red_white_bilingual'];
function bilingualMetrics(id,width,height){
 const sx=v=>Math.round(v*width/1920),sy=v=>Math.round(v*height/1080),portrait=height>width;
 if(id==='yellow_white_bilingual')return {chsSize:sy(50),engSize:sy(18),chsMax:Math.floor((width-20)/sy(50)),engMax:Math.floor((width-20)/(sy(18)*.6)),chsMinimum:.75,engMinimum:.75};
 const safe=Math.max(200,width-2*sx(portrait?220:140)),chsSize=sy(portrait?40:45),engSize=sy(portrait?18:id==='red_white_bilingual'?22:20);
 return {chsSize,engSize,chsMax:Math.max(4,Math.floor(safe/(chsSize*1.05))),engMax:Math.max(8,Math.floor(safe/(engSize*.62))),chsMinimum:.62,engMinimum:id==='red_white_bilingual'?.62:.55};
}
function fitUnits(f,size,maxChars,minimum){
 const length=f.units.filter(u=>u.char!=='\n').map(u=>u.char).join('').length;
 const fontSize=length>maxChars?Math.max(Math.round(size*minimum),Math.floor(size*maxChars/length)):null;
 return {...f,fontSize,size:fontSize??size};
}
function wrapChinese(f,max){
 const units=[];let count=0;
 for(const u of f.units){if(u.char==='\n'){units.push(u);count=0;continue;}if(count>=max){units.push({char:'\n',highlighted:false});count=0;}units.push(u);count++;}
 return {...f,units};
}
function wrapEnglish(f,max){
 const words=f.value.trim().split(/\s+/),lines=[];let line='';
 for(const word of words){const candidate=line?line+' '+word:word;if(candidate.length>max&&line){lines.push(line);line=word;}else line=candidate;}
 if(line)lines.push(line);return {...f,units:Array.from(lines.join('\n'),char=>({char,highlighted:false}))};
}
const lineCount=f=>f.units.map(u=>u.char).join('').split('\n').filter(Boolean).length||1;
function toBilingualTemplateAss(rows,width,height,id,family,{speed=1,offsetY=0,keywords=false,signal}={}){
 if(!bilingualSubtitleIds.includes(id))throw Error('当前模板没有双语字幕规则');
 const sx=v=>Math.round(v*width/1920),sy=v=>Math.round(v*height/1080),shift=sy(offsetY),time=v=>Math.round(v/speed*100),b=builder(width,height),m=bilingualMetrics(id,width,height),details=[],portrait=height>width,x=id==='yellow_white_bilingual'?sx(960):Math.round(width/2);
 const pos=(a,c)=>`\\pos(${Math.round(a)},${Math.round(c)-shift})`,move=(a,c,d,e,ms)=>`\\move(${Math.round(a)},${Math.round(c)-shift},${Math.round(d)},${Math.round(e)-shift},0,${ms})`;
 const base={fontname:family,bold:true,alignment:5,marginL:id==='yellow_white_bilingual'?10:30,marginR:id==='yellow_white_bilingual'?10:30};
 if(id==='black_white_bilingual')for(const [name,fontsize]of [['BoxStyleEng',m.engSize],['BoxStyleChs',m.chsSize]])b.addStyle({...base,name,fontsize,outline:sy(2),borderStyle:3,back:'&H00737373&'});
 else{
  b.addStyle({...base,name:'Chs',fontsize:m.chsSize,primary:id==='yellow_white_bilingual'?'&H0000D7FF&':'&H00FFFFFF&',shadow:id==='yellow_white_bilingual'?2:sy(3)});
  b.addStyle({...base,name:'Eng',fontsize:m.engSize});
  if(id==='red_white_bilingual')b.addStyle({...base,name:'Red',fontsize:m.chsSize,primary:'&H000000FF&',shadow:sy(3)});
 }
 const emit=(a,c,text,style)=>b.emit(a,c,text,style);
 function typewriter(f,color,delay,duration,yellow){let index=0;return f.units.map(u=>{
  if(u.char==='\n')return '\\N';const d=index++*delay,extra=(f.fontSize===null?'':`\\fs${f.fontSize}`)+(f.keywordColors?`\\c${u.highlighted?warm:color}`:'');
  return `{\\alpha&HFF&${yellow?'\\blur2\\fscx80\\fscy80':''}\\t(${d},${d+duration},${yellow?'1.3':'1.2'},\\alpha&H00&${yellow?'\\blur0\\fscx100\\fscy100':''})${extra}}${u.char}`;
 }).join('');}
 rows.forEach((row,i)=>{
  signal?.throwIfAborted();const slot=i%4+1,start=time(row.start);let end=time(row.end);
  let chs=fitRow(row,m.chsSize,Infinity,.75,keywords),eng=fitRow({text:row.auxiliary.translation},m.engSize,Infinity);
  if(id==='red_white_bilingual'){chs=wrapChinese(chs,m.chsMax);eng=wrapEnglish(eng,m.engMax);}
  chs=fitUnits(chs,m.chsSize,m.chsMax*(id==='red_white_bilingual'?2:1),m.chsMinimum);eng=fitUnits(eng,m.engSize,m.engMax*(id==='red_white_bilingual'?2:1),m.engMinimum);
  if(id==='yellow_white_bilingual'){
   const common=`\\3c&H000000&\\bord${sy(3)}\\shad1\\4c&H000000&\\an5`,color='&H00D7FF&',y=sy(840);let tags=`${common}\\1c${color}${pos(x,y)}`,value=plainTags(chs,color);
   if(slot===1)tags+=move(x,y+sy(18),x,y,260)+'\\fscx115\\fscy115\\blur3\\alpha&HFF&\\t(0,260,1.4,\\fscx100\\fscy100\\blur0\\alpha&H00&)';
   if(slot===3)tags+=move(x+sx(80),y,x,y,240)+'\\alpha&HFF&\\t(0,240,1.3,\\alpha&H00&)';
   if(slot===2||slot===4)value=typewriter(chs,color,slot===2?28:22,slot===2?55:45,true);
   emit(start,end,`{${tags}}${value}`,'Chs');
   emit(start,end,`{${common}\\1c&HFFFFFF&${pos(x,sy(880))}\\fs${m.engSize}\\bord0\\shad0\\fad(${[220,180,180,160][slot-1]},0)}${plainTags(eng)}`,'Eng');
  }else{
   if(id==='red_white_bilingual'&&slot===2&&rows[i+1])end=time(rows[i+1].end);
   const ch= lineCount(chs)*m.chsSize*1.15,eh=lineCount(eng)*m.engSize*1.2,cy=Math.round(sy(portrait?980:1020)-ch/2),ey=Math.round(cy-ch/2-sy(portrait?18:14)-eh/2);
   if(id==='black_white_bilingual'){emit(start,end,`{${pos(x,ey)}}${plainTags(eng)}`,'BoxStyleEng');emit(start,end,`{${pos(x,cy)}}${plainTags(chs)}`,'BoxStyleChs');}
   else if(slot===3)emit(start,end,`{${pos(x,Math.round(cy+ch/2+sy(portrait?32:28)))}\\fad(200,0)}${plainTags(chs,'&H0000FF&')}`,'Red');
   else{
    emit(start,end,`{${pos(x,cy)}${slot===1?'\\fad(200,0)':''}}${slot===1?plainTags(chs):typewriter(chs,'&HFFFFFF&',35,60,false)}`,'Chs');
    emit(start,end,`{${pos(x,ey)}\\fad(${slot===1?200:150},0)}${plainTags(eng)}`,'Eng');
   }
  }
  details.push({index:i,slot,startCs:start,endCs:end,chsFontSize:chs.fontSize,engFontSize:eng.fontSize,chsLines:lineCount(chs),engLines:lineCount(eng)});
 });
 return {ass:b.content(),shift,eventCount:b.events.length,details};
}
module.exports={bilingualSubtitleIds,bilingualMetrics,toBilingualTemplateAss};
