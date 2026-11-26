const wordSegmenter=new Intl.Segmenter('zh-CN',{granularity:'word'});
const closingPunctuation=/^[，。！？；：、,.!?;:%％）\)］\]｝\}〉》」』】”’]/;
const openingPunctuation=/[（\(［\[｛\{〈《「『【“‘]$/;
const numberWithUnit=/\d+(?:[.．]\d+)?[\t ]*(?:毫米|厘米|分米|千米|微米|平方米|立方米|千克|公斤|毫升|分钟|小时|万元|米|克|升|秒|元|个|台|件|张)/gu;
const charWidth=ch=>/[\u0000-\u007f]/.test(ch)?.6:1;
function wrapLines(text,maxUnits){
  if(!Number.isFinite(maxUnits)||maxUnits<=0)throw new Error('字幕每行宽度无效');
  const rows=[];
  for(const paragraph of String(text).split(/\r?\n/)){
    const chars=Array.from(paragraph),widths=[0],offsets=[0],boundaries=new Set([0]),quantityEnds=new Set();
    for(const ch of chars){widths.push(widths.at(-1)+charWidth(ch));offsets.push(offsets.at(-1)+ch.length);}
    for(const part of wordSegmenter.segment(paragraph))boundaries.add(part.index+part.segment.length);
    // 数字与常用完整单位按原文保护，不依赖运行时是否将“分米”“万元”完整分词。
    // 组合超过整行宽度时仍允许保底折行，避免丢字或超出画面。
    for(const match of paragraph.matchAll(numberWithUnit)){
      quantityEnds.add(match.index+match[0].length);
      for(let i=match.index+1;i<match.index+match[0].length;i++)boundaries.delete(i);
    }
    const fits=(a,b)=>widths[b]-widths[a]<=maxUnits+1e-7;
    const allowed=i=>!closingPunctuation.test(chars[i]||'')&&!openingPunctuation.test(chars[i-1]||'');
    const cuts=[0];let start=0;
    while(start<chars.length){
      let end=start+1;while(end<chars.length&&fits(start,end+1))end++;
      if(end<chars.length){
        let cut=end;
        while(cut>start&&(!allowed(cut)||!boundaries.has(offsets[cut])))cut--;
        // 极窄画面容不下“完整数量＋后续标点”时，优先保全可容纳的数量，才放宽标点禁则。
        if(cut===start){cut=end;while(cut>start&&!quantityEnds.has(offsets[cut]))cut--;}
        if(cut===start){cut=end;while(cut>start&&!allowed(cut))cut--;}
        if(cut>start)end=cut;
      }
      cuts.push(end);start=end;
    }
    // 只均衡过短的末行，不改显式换行，也不为排版拆分字幕时间段。
    if(cuts.length>2){
      const end=cuts.at(-1),last=cuts.at(-2),begin=cuts.at(-3);
      if(widths[end]-widths[last]<=maxUnits/3){
        let best=last,score=Infinity;
        for(let i=begin+1;i<end;i++)if(fits(begin,i)&&fits(i,end)&&allowed(i)&&boundaries.has(offsets[i])){
          const left=widths[i]-widths[begin],right=widths[end]-widths[i];
          const clauseEnd=/[，。！？；：、,.!?;:]$/.test(chars[i-1])&&Math.min(left,right)>=maxUnits/3;
          const candidate=Math.abs(left-right)-(clauseEnd?maxUnits:0);
          if(candidate<score){best=i;score=candidate;}
        }
        cuts[cuts.length-2]=best;
      }
    }
    if(!chars.length)rows.push('');
    else for(let i=1;i<cuts.length;i++)rows.push(chars.slice(cuts[i-1],cuts[i]).join(''));
  }
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
