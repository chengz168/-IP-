// 模型只选择原文单元的边界；正文始终由程序切片，避免重抄长文时漏句或改字。
function sourceUnits(source,minimum=1){
 if(typeof source!=='string'||!source.trim())throw Error('剧本为空');
 const pieces=source.match(/[^。！？!?；;\r\n]+[。！？!?；;]*[”’」』"]*[\r\n]*|[。！？!?；;\r\n]+/gu)||[];
 const units=[];let offset=0,prefix='';
 for(const text of pieces){
  if(!text.trim()){if(units.length){units.at(-1).text+=text;units.at(-1).end=offset+text.length;}else prefix+=text;offset+=text.length;continue;}
  units.push({id:units.length+1,start:offset-prefix.length,end:offset+text.length,text:prefix+text});prefix='';offset+=text.length;
 }
 // 时长要求多个镜头而原文缺少句号时，只细分最长单元，仍保留全部字符。
 while(units.length<minimum){
  const candidates=units.map((unit,index)=>({unit,index,characters:Array.from(unit.text)})).filter(item=>item.characters.length>1).sort((a,b)=>b.characters.length-a.characters.length);
  if(!candidates.length)break;
  const {unit,index,characters}=candidates[0],middle=Math.floor(characters.length/2),left=characters.slice(0,middle).join('');
  units.splice(index,1,{...unit,end:unit.start+left.length,text:left},{...unit,start:unit.start+left.length,text:characters.slice(middle).join('')});
 }
 units.forEach((unit,index)=>unit.id=index+1);
 if(units.map(unit=>unit.text).join('')!==source)throw Error('原文分段未完整覆盖，未提交模型');
 return units;
}
function restoreRanges(source,units,items,label){
 if(!Array.isArray(items)||!items.length)throw Error(label+'结果为空');
 let previous=0;
 const result=items.map(item=>{
  if(!Number.isSafeInteger(item.endUnit)||item.endUnit<=previous||item.endUnit>units.length)throw Error(label+'原文边界无效，旧结果保留');
  const text=source.slice(previous?units[previous-1].end:0,units[item.endUnit-1].end);previous=item.endUnit;
  return {...item,text};
 });
 if(previous!==units.length||result.map(item=>item.text).join('')!==source)throw Error(label+'没有完整覆盖原文，旧结果保留');
 return result;
}
module.exports={sourceUnits,restoreRanges};
