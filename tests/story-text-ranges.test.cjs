const {test}=require('node:test'),assert=require('node:assert/strict');
const {sourceUnits,restoreRanges,balancedRanges}=require('../server/story-text-ranges.cjs');

test('原文边界覆盖中文、换行、引号和表情，保留全部空白与字面转义',()=>{
 const source='\r\n  小猫🐈走进房间。\r\n他说：“价格为12.50元！”\n\n道具标签写着\\n，不能当作换行替换。\n  ';
 const units=sourceUnits(source);
 assert.equal(units.map(unit=>unit.text).join(''),source);
 assert(units.every(unit=>unit.text.trim()));
 const result=restoreRanges(source,units,[{title:'前半',endUnit:1},{title:'后半',endUnit:units.length}],'分集');
 assert.equal(result.map(item=>item.text).join(''),source);
 assert.equal(result[1].text,source.slice(units[0].end));
});

test('模型遗漏结尾、跳回、重复、越界或非整数边界全部拒绝',()=>{
 const source='第一句。第二句。第三句。',units=sourceUnits(source);
 for(const items of [[{endUnit:2}],[{endUnit:2},{endUnit:1}],[{endUnit:1},{endUnit:1}],[{endUnit:4}],[{endUnit:1.5}],[{endUnit:'3'}],[{endUnit:0}]])assert.throws(()=>restoreRanges(source,units,items,'分集'),/覆盖原文|边界无效/);
 assert.throws(()=>sourceUnits(' \n '),/为空/);
});

test('少标点长句按最低镜头数细分，表情代理对及原文偏移保持完整',()=>{
 const source='  一只🐈坐在窗边静静地看雨  ',units=sourceUnits(source,4);
 assert.equal(units.length,4);
 assert.equal(restoreRanges(source,units,units.map(unit=>({endUnit:unit.id})),'镜头').map(item=>item.text).join(''),source);
 for(const unit of units){assert.equal(unit.text,source.slice(unit.start,unit.end));assert(!/[\uD800-\uDBFF]$/.test(unit.text));assert(!/^[\uDC00-\uDFFF]/.test(unit.text));}
});

test('本地模型重复边界时按原文长度均分并严格完整覆盖',()=>{
 const {source}=require('./fixtures/story-shot-boundary-regression.json');
 const units=sourceUnits(source),ranges=balancedRanges(source,units,16,'镜头');
 assert.equal(ranges.length,16);
 assert.equal(ranges.map(range=>range.text).join(''),source);
 assert(ranges.every(range=>range.text.length>0));
 assert(ranges.every((range,index)=>!index||range.endUnit>ranges[index-1].endUnit));assert.equal(ranges.at(-1).endUnit,units.length);
});

test('本地兜底保留长短句、首尾空白与表情，拒绝无法实现的镜头数',()=>{
 for(const source of ['\r\n一。'+('很长的句子🐈'.repeat(200))+'。\n最后。\r\n','🐈'.repeat(25)]){
  const units=sourceUnits(source,4);for(const count of [1,2,4]){const ranges=balancedRanges(source,units,count);assert.equal(ranges.length,count);assert.equal(ranges.map(range=>range.text).join(''),source);assert(ranges.every(range=>range.text.length>0&&!/^[\uDC00-\uDFFF]/.test(range.text)&&!/[\uD800-\uDBFF]$/.test(range.text)));}
  for(const count of [0,-1,1.5,units.length+1])assert.throws(()=>balancedRanges(source,units,count),/数量/);
 }
});
