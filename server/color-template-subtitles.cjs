const {fitRow,plainTags,builder,warm}=require('./native-subtitle-common.cjs');
const colorSubtitleIds=['white_pinyin','variety_wave','cartoon_yellow','energy_pink_yellow','cute_pink'];
const white='&HFFFFFF&';
const charWidth=(c,s)=>s*(c===' '?.35:'，。！？、；：.!?;:·…'.includes(c)?.45:c.charCodeAt(0)<=127?.6:1);
function colorMetrics(id,width,height){
 const sx=v=>Math.round(v*width/1920),sy=v=>Math.round(v*height/1080),portrait=height>width;
 let fontSize=sy(50),maxChars=Math.floor((width-20)/fontSize),minimum=.75;
 if(id==='cartoon_yellow')maxChars=Infinity;
 if(id==='white_pinyin')return {fontSize:sy(portrait?46:50),safeWidth:Math.max(180,width-2*sx(portrait?140:90))};
 if(id==='energy_pink_yellow'){fontSize=sy(portrait?62:70);maxChars=Math.max(3,Math.floor(Math.max(width-2*sx(portrait?120:80)-sx(portrait?160:100),fontSize*3)/fontSize));minimum=.7;}
 if(id==='cute_pink'){fontSize=sy(80);maxChars=Math.max(1,Math.floor((width-2*sx(80)-20)/(fontSize*1.2)));minimum=.6;}
 return {fontSize,maxChars,minimum};
}
function toColorTemplateAss(rows,width,height,id,family,{speed=1,offsetY=0,keywords=false,signal,pinyin,random=Math.random}={}){
 if(!colorSubtitleIds.includes(id))throw Error('当前模板没有彩色或注音字幕规则');
 if(id==='white_pinyin'&&(!Array.isArray(pinyin)||pinyin.length!==rows.length||pinyin.some((v,i)=>!Array.isArray(v)||v.length!==Array.from(rows[i].text).length||v.some(s=>typeof s!=='string'))))throw Error('注音结果未逐字对齐');
 const sx=v=>Math.round(v*width/1920),sy=v=>Math.round(v*height/1080),shift=sy(offsetY),time=v=>Math.round(v/speed*100),x=Math.round(width/2),b=builder(width,height),details=[];
 const pos=(a,c)=>`\\pos(${Math.round(a)},${Math.round(c)-shift})`,move=(a,c,d,e,ms)=>`\\move(${Math.round(a)},${Math.round(c)-shift},${Math.round(d)},${Math.round(e)-shift},0,${ms})`,clip=(a,c,d,e)=>`\\clip(${Math.round(a)},${Math.round(c)-shift},${Math.round(d)},${Math.round(e)-shift})`;
 const metrics=colorMetrics(id,width,height),base=metrics.fontSize;
 const fitted=rows.map(row=>{
  const f=fitRow(row,base,metrics.maxChars??Infinity,metrics.minimum,keywords);
  if(id==='white_pinyin'){
   const chars=f.units.filter(u=>u.char!=='\n'),estimate=(chars.reduce((s,u)=>s+charWidth(u.char,base),0)+Math.max(0,chars.length-1)*-5)*1.08;
   if(estimate>metrics.safeWidth){f.fontSize=Math.max(Math.round(base*.58),Math.floor(base*metrics.safeWidth/Math.max(1,estimate)));f.size=f.fontSize;}
  }
  return f;
 });
 const fsTag=f=>f.fontSize===null?'':`\\fs${f.fontSize}`;
 const inherited=(f,u,color)=>fsTag(f)+(f.keywordColors?`\\c${u.highlighted?warm:color}`:'');
 const chars=f=>f.units.map(u=>({...u,char:u.char==='\n'?' ':u.char}));
 const plain=(f,color)=>plainTags(f,color);
 const styled=(f,callback,color,{reset='',preserveLines=false}={})=>{let index=0;return f.units.map(u=>{if(u.char==='\n'&&preserveLines)return '\\N';const unit={...u,char:u.char==='\n'?' ':u.char},i=index++;return `{${callback(i)}${inherited(f,unit,color)}}${unit.char}${reset?`{\\r${reset}}`:''}`;}).join('');};
 const emit=(a,c,text,style='Default')=>b.emit(a,c,text,style);
 // 增长阶段带光标，完整停留阶段使用无光标全文。
 function typewriter(start,end,f,y,color,common,style='Default'){
  const units=chars(f),step=Math.min(5,Math.max(1,Math.floor(Math.max(1,end-start)/(units.length+2))));let cursor=start,value='';
  for(const u of units){value+=`{${inherited(f,u,color)}}${u.char}`;const next=Math.min(end,cursor+step);if(next<=cursor)break;emit(cursor,next,`{${common}\\1c${color}${pos(x,y)}}${value}|`,style);cursor=next;if(cursor>=end)break;}
  if(cursor<end)emit(cursor,end,`{${common}\\1c${color}${pos(x,y)}}${plain({...f,units},color)}`,style);
  return step;
 }
 if(id==='variety_wave')for(const [name,primary]of [['Pink','&H00D0A1FD&'],['White','&H00FFFFFF&'],['Green','&H00EBFCE0&']])b.addStyle({name,primary,fontname:family,fontsize:base,bold:true,outline:sy(2),alignment:2,marginV:20});
 else b.addStyle({name:id==='cartoon_yellow'?'StyleCartoonYellow':id==='cute_pink'?'StyleCutePink':'Default',fontname:family,fontsize:base,bold:id==='energy_pink_yellow',outline:id==='white_pinyin'?sy(2):id==='cartoon_yellow'?1:id==='cute_pink'?3:0,shadow:id==='cartoon_yellow'?1:0,spacing:id==='cute_pink'?-15:0,alignment:id==='cute_pink'?5:2,marginV:['cartoon_yellow','energy_pink_yellow'].includes(id)?20:10});
 if(id==='energy_pink_yellow'){
  const common='\\3c&H000000&\\bord2\\shad0\\an5',top=sy(760),bottom=sy(820);
  const wave=(f,color)=>styled(f,i=>{const w=[0,24,48,24,0,-24,-48,-24][i%8],d=i*34;return `\\alpha&HFF&\\fscx70\\fscy70\\blur4\\frz${(-w/10).toFixed(1)}\\t(${d},${d+160},1.6,\\alpha&H00&\\fscx100\\fscy${100+w}\\blur0\\frz0)\\t(${d+160},${d+320},1.3,\\fscy100)`;},color);
  for(let i=0;i<rows.length;){
   signal?.throwIfAborted();let group=Math.floor(random()*3)+1;if(group<1||group>3)throw Error('随机源返回无效分组');if(i+1>=rows.length)group=1;
   const start=time(rows[i].start),f=fitted[i];
   if(group===1){const end=time(rows[i].end),color=random()>.5?'&H8DF2F1&':'&HCC96F8&',step=typewriter(start,end,f,bottom,color,common);details.push({index:i,group,startCs:start,endCs:end,fittedFontSize:f.fontSize,step,color});i++;continue;}
   const nextStart=time(rows[i+1].start),end=time(rows[i+1].end),next=fitted[i+1];
   if(group===2){emit(start,end,`{${common}\\1c&HCC96F8&${pos(x,top)}}${wave(f,'&HCC96F8&')}`);emit(nextStart,end,`{${common}\\1c&H8DF2F1&${pos(x,bottom)}}${wave(next,'&H8DF2F1&')}`);}
   else{
    emit(start,end,`{${common}\\1c&H88F7FD&${move(x,top-sy(30),x,top,260)}\\fscx80\\fscy80\\alpha&HFF&\\t(0,220,1.4,\\fscx115\\fscy115\\alpha&H00&)\\t(220,320,1.2,\\fscx100\\fscy100)}${plain(f,'&H88F7FD&')}`);
    const half=sy(260);for(const [a,c,d,e]of [[0,0,0,x],[width,width,x,width]])emit(nextStart,end,`{${common}\\1c&HD19BF5&${pos(x,bottom)}${clip(a,bottom-half,c,bottom+half)}\\t(0,320,1.2,${clip(d,bottom-half,e,bottom+half)})\\alpha&HFF&\\t(0,320,1.2,\\alpha&H00&)}${plain(next,'&HD19BF5&')}`);
   }
   details.push({index:i,group,startCs:start,endCs:end,fittedFontSize:f.fontSize},{index:i+1,group,startCs:nextStart,endCs:end,fittedFontSize:next.fontSize});i+=2;
  }
 }else rows.forEach((row,i)=>{
  signal?.throwIfAborted();const period=id==='variety_wave'?4:5,slot=i%period+1,start=time(row.start),f=fitted[i];let end=time(row.end),step;
  if(id==='white_pinyin'){
   const lines=[[]],original=Array.from(row.text);let sourceIndex=0;
   for(const c of original){if(c==='\r'&&original[sourceIndex+1]==='\n'){sourceIndex++;continue;}if(c==='\r'||c==='\n')lines.push([]);else lines.at(-1).push({char:c,pinyin:pinyin[i][sourceIndex]});sourceIndex++;}
   // 使用转义后的正文排字，同时维持原始Unicode字符与注音的一一对应。
   const sanitized=f.units.filter(u=>u.char!=='\n');let next=0;for(const line of lines)for(const u of line)Object.assign(u,sanitized[next++]);
   const window=Math.max(200,Math.floor(Math.max(300,(end-start)*10)*.6));
   lines.forEach((line,j)=>{
    const y=sy(860)-(lines.length-1-j)*sy(110),py=y-Math.floor(base*.95),widths=line.map(u=>charWidth(u.char,f.size)),total=widths.reduce((s,v)=>s+v,0)+Math.max(0,line.length-1)*-5;let cursor=x-total/2;
    const interval=Math.max(40,Math.floor(window/Math.max(1,line.length)));
    line.forEach((u,k)=>{
     const at=Math.floor(cursor+widths[k]/2),delay=k*interval,to=Math.min(window,delay+interval),animation=`\\t(${delay},${to},1.0,\\alpha&H00&)`;
     emit(start,end,`{\\1c${white}\\3c&H000000&\\bord${Math.max(1,Math.round(sy(2)*f.size/base))}\\shad0\\an2${pos(at,y)}\\fs${f.size}\\alpha&H80&${animation}${f.keywordColors?`\\c${u.highlighted?warm:white}`:''}}${u.char}`);
     const code=u.char.charCodeAt(0);if(u.pinyin&&((code>=19968&&code<=40959)||(code>=13312&&code<=19903)))emit(start,end,`{\\1c${white}\\3c&H000000&\\bord${sy(1)}\\shad0\\an2${pos(at,py)}\\fs${sy(16)}\\alpha&H99&${animation}}${u.pinyin}`);
     cursor+=widths[k]-5;
    });
   });
  }else if(id==='variety_wave'){
   if(slot===2&&rows[i+1])end=time(rows[i+1].end);
   const y=sy([800,840,920,840][slot-1]),style=slot<=2?'Pink':'Green',mode=[1,4].includes(slot)?'in':'fade',upper=style==='Pink'?'&HD0A1FD&':'&HEBFCE0&';
   const value=styled(f,j=>{const w=[0,36,72,36,0,-36,-72,-36][j%8],d=j*(mode==='in'?36:30);return mode==='in'?`\\alpha&HFF&\\fscx70\\fscy70\\blur5\\frz${(-w/6).toFixed(1)}\\t(${d},${d+160},1.6,\\alpha&H00&\\fscx100\\fscy${100+w}\\blur0\\frz0)\\t(${d+160},${d+320},1.4,\\fscy100)`:`\\alpha&HFF&\\blur3\\fscy100\\frz${(-w/10).toFixed(1)}\\t(${d},${d+140},1.5,\\alpha&H00&\\fscx100\\fscy${100+w}\\blur0\\frz0)\\t(${d+140},${d+300},1.3,\\fscy100)`;},upper,{reset:style});
   emit(start,end,`{${pos(sx(960),y)}${clip(0,y-sy(220),width,y)}}${value}`,style);emit(start,end,`{${pos(sx(960),y)}${clip(0,y,width,y+sy(220))}}${value}`,'White');
  }else if(id==='cartoon_yellow'){
   if([1,4].includes(slot)&&rows[i+1])end=time(rows[i+1].end);
   const common='\\3c&H000000&\\bord0\\shad3\\an5',color=[1,3,5].includes(slot)?'&HACFEF6&':white;let tags='',value=plain(f,color);
   if(slot===1)tags=pos(x,sy(860))+'\\fscx150\\fscy150\\alpha&HFF&\\t(0,260,1.4,\\fscx100\\fscy100\\alpha&H00&)';
   if(slot===2){tags=move(x+sx(120),sy(910)+sy(60),x,sy(910),260);value=styled(f,j=>`\\alpha&HFF&\\fscx60\\fscy60\\t(${j*35},${j*35+60},1.2,\\alpha&H00&\\fscx100\\fscy100)`,color);}
   if(slot===3)tags=pos(x,sy(860))+'\\fscx60\\fscy60\\alpha&HFF&\\t(0,240,1.4,\\fscx110\\fscy110\\alpha&H00&)\\t(240,320,1.0,\\fscx100\\fscy100)';
   if(slot===4)tags=pos(x,sy(860))+'\\alpha&H50&\\fscx60\\fscy60\\t(0,260,1.4,\\fscx100\\fscy100\\alpha&H50&)';
   if(slot===5)step=typewriter(start,end,f,sy(890),color,common,'StyleCartoonYellow');else emit(start,end,`{${common}\\1c${color}${tags}}${value}`,'StyleCartoonYellow');
  }else{
   if([2,4].includes(slot)&&rows[i+1])end=time(rows[i+1].end);
   const common='\\3c&H000000&\\bord2\\shad0\\fsp-12',color=['&HF9F4AE&','&HD0A1FD&','&H70F9FD&','&HD1A3FD&','&H6AEEF8&'][slot-1];
   let tags='',value=plain(f,color);
   if(slot===1)tags='\\an5'+pos(x,sy(840))+`\\1c${color}\\fad(300,0)`;
   if(slot===4)tags='\\an5'+move(x,sy(740),x,sy(790),500)+`\\1c${color}\\fad(300,0)`;
   if([2,3,5].includes(slot)){tags=`\\an${slot===2?4:slot===3?6:5}`+pos(slot===2?sx(80):slot===3?width-sx(80):x,sy(slot===2?790:890));value=styled(f,j=>`\\1c${color}\\alpha&HFF&\\fscx0\\fscy0\\t(${j*50},${j*50+75},\\alpha&H00&\\fscx120\\fscy120)\\t(${j*50+75},${j*50+125},\\fscx100\\fscy100)`,color);}
   emit(start,end,`{${common}${tags}}${value}`,'StyleCutePink');
  }
  details.push({index:i,slot,startCs:start,endCs:end,fittedFontSize:f.fontSize,...(step===undefined?{}:{step})});
 });
 return {ass:b.content(),shift,eventCount:b.events.length,details};
}
module.exports={colorSubtitleIds,colorMetrics,toColorTemplateAss};
