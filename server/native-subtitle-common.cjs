// 原生字幕共用文本转义、颜色标注和ASS构建；不执行模板来源中的代码。
const stampCs=value=>{const c=Math.max(0,Math.round(value));return `${Math.floor(c/360000)}:${String(Math.floor(c/6000)%60).padStart(2,'0')}:${String(Math.floor(c/100)%60).padStart(2,'0')}.${String(c%100).padStart(2,'0')}`;};
const warm='&H6CCBF3&';
function fitRow(row,size,maxChars,minimum=.75,keywords=false){
 const ranges=[];
 if(keywords)for(const word of row.auxiliary.keywords){let index=row.text.indexOf(word);while(index>=0){ranges.push([index,index+word.length]);index=row.text.indexOf(word,index+1);}}
 const units=[];let offset=0;
 for(const char of row.text){
  let ch=char;
  const highlighted=ranges.some(([a,b])=>offset>=a&&offset<b);offset+=char.length;
  if(ch==='\r'&&row.text[offset]==='\n')continue;
  if(ch==='\r')ch='\n';
  if(/[\u0000-\u0009\u000b-\u001f\u007f]/.test(ch))ch=' ';
  if(ch==='\\')ch='＼';if(ch==='{')ch='｛';if(ch==='}')ch='｝';
  units.push({char:ch,highlighted});
 }
 const value=units.map(u=>u.char).join(''),fitted=value.length>maxChars?Math.max(Math.round(size*minimum),Math.floor(size*maxChars/value.length)):null;
 return {units,value,fontSize:fitted,size:fitted??size,keywordColors:ranges.length>0};
}
function plainTags(fitted,baseColor='&HFFFFFF&'){
 let active=false,text=fitted.fontSize===null?'':`{\\fs${fitted.fontSize}}`;
 for(const unit of fitted.units){if(unit.highlighted!==active){active=unit.highlighted;text+=`{\\c${active?warm:baseColor}}`;}text+=unit.char==='\n'?'\\N':unit.char;}
 return text;
}
function animatedChars(fitted,callback,{newlines='space'}={}){
 return fitted.units.filter(u=>newlines!=='remove'||u.char!=='\n').map((unit,index)=>callback({...unit,char:unit.char==='\n'?' ':unit.char},index,`${fitted.fontSize===null?'':`\\fs${fitted.fontSize}`}`)).join('');
}
function style(config){
 const c={name:'Default',fontname:'Arial',fontsize:20,primary:'&H00FFFFFF',secondary:'&H000000FF',outlineColor:'&H00000000',back:'&H00000000',bold:false,italic:false,outline:0,shadow:0,alignment:5,marginL:10,marginR:10,marginV:10,...config};
 return `Style: ${c.name},${c.fontname},${c.fontsize||20},${c.primary},${c.secondary},${c.outlineColor},${c.back},${c.bold?-1:0},${c.italic?-1:0},0,0,100,100,${c.spacing??0},0,${c.borderStyle||1},${c.outline},${c.shadow},${c.alignment},${c.marginL||10},${c.marginR||10},${c.marginV||10},1`;
}
function builder(width,height){
 const events=[],styles=[];
 return {events,styles,addStyle:c=>styles.push(style(c)),emit:(start,end,text,name='Default',layer=0)=>{if(end>start)events.push(`Dialogue: ${layer},${stampCs(start)},${stampCs(end)},${name},,0,0,0,,${text}`);},content:()=>`[Script Info]\nScriptType: v4.00+\nPlayResX: ${width}\nPlayResY: ${height}\nWrapStyle: 0\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n${styles.join('\n')}\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n${events.join('\n')}`};
}
module.exports={stampCs,warm,fitRow,plainTags,animatedChars,builder};
