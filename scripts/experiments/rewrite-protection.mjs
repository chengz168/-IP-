import {compact,negativeClauses} from '../../server/content-quality.mjs';
import {rewriteUnits,unitSchema,assembleUnits,explicitTokens} from '../../server/rewrite-units.mjs';

const chineseQuantities=value=>[...String(value).matchAll(/([零〇一二两三四五六七八九十百千万亿]+(?:点[零〇一二三四五六七八九]+)?)\s*(个|本|档|组|次|人|件|台|支|张|厘米|毫米|米|元|天|小时|分钟|秒|点|成|倍)/gu)];
// 只识别明确的文本标记；保留命中的整句，避免只锁数字却改变动作或限定对象。
export function protectionReasons(source){
 const reasons=[];
 if(explicitTokens(source).length)reasons.push('数字或英文标识');
 // 普通“一个/一组”不直接锁整句，以免普通动作稿全部失去改写空间；有上限等标记时仍锁整句。
 if(chineseQuantities(source).some(match=>match[1]!=='一')||/(?:最多|至少|至多|限|仅|只)[^，,。！？\n]{0,8}一(?:个|本|档|组|次|人|件|台|支|张|厘米|毫米|米|元|天|小时|分钟|秒|点|成|倍)/u.test(source))reasons.push('明确中文数量');
 if(negativeClauses(source).length||/(?:禁止|不得|必须|仅限|只限|最多|至少|至多|限于|不能|不可|无需|无须)/u.test(source))reasons.push('否定或限制');
 return reasons;
}

export function protectedRewritePlan(source,target){
 const base=rewriteUnits(source,target),units=base.units.map(unit=>({...unit,protectionReasons:protectionReasons(unit.source)}));
 const protectedUnits=units.filter(unit=>unit.protectionReasons.length),editableUnits=units.filter(unit=>!unit.protectionReasons.length);
 if(!editableUnits.length)throw Error('后文全部包含需要保留原句的数量、标识或限制条款，没有可改写句段；当前文案保留，请调整原文或选择自定义写作模板');
 return {...base,units,protectedUnits,editableUnits,protectionPolicy:'local-source-sentence-preservation-v1'};
}

export function protectedUnitSchema(plan){return unitSchema({...plan,units:plan.editableUnits});}

export function protectedRewriteRequest(input){
 const plan=protectedRewritePlan(input.fields.sourceText,input.fields.wordLimit),wrapperSource='local-reference-protected-units-v2';
 const user=`本次只改写标记为可改写的后文句段，输出JSON对象units，全部可改写编号必须返回，禁止返回其他编号。不要写提纲、标题或创作说明。\n第一段由本地保留，不要重复：${plan.opening}\n以下关键句由本地按原顺序保留原句，不能重复或另写与它们矛盾的内容：\n${JSON.stringify(plan.protectedUnits.map(unit=>({id:unit.id,source:unit.source,reasons:unit.protectionReasons})))}\n只改写下列句段。对象、具体动作、修饰范围、条件、地点和先后顺序都要完整保留，使用自然完整的口播句子，不用摘要缩写。不可弱化动作要求、泛化限定对象或改成概括建议。改变句式，不整句照搬，不增加新事实、建议、经历、功效或因果。保留句不参与改写，全文字数约${plan.target}字符，不能靠空话凑长。\n可改写有序句段：\n${JSON.stringify(plan.editableUnits.map(unit=>({id:unit.id,source:unit.source,lengthRange:[unit.minCharacters,unit.maxCharacters]})))}${input.fields.analysis?'\n仅参考表达方式，不新增事实：\n'+JSON.stringify(input.fields.analysis):''}`;
 return {system:input.template.content,user,schema:protectedUnitSchema(plan),plan,wrapperSource};
}

export function assembleProtectedRewrite(plan,value){
 if(!value||Array.isArray(value)||typeof value!=='object'||Object.keys(value).length!==1||!value.units||typeof value.units!=='object'||Array.isArray(value.units))throw Error('改写信息单元格式无效，当前文案保留');
 const ids=plan.editableUnits.map(unit=>unit.id),actual=Object.keys(value.units);
 if(ids.length!==actual.length||actual.some(id=>!ids.includes(id)))throw Error('可改写句段编号缺失或多出，保留句不能由模型覆盖，当前文案保留');
 for(const unit of plan.editableUnits){
  const text=value.units[unit.id];
  if(typeof text==='string'){
   const sourceQuantities=chineseQuantities(unit.source).map(match=>match[1]+match[2]),actualQuantities=chineseQuantities(text).map(match=>match[1]+match[2]);
   if(explicitTokens(text).some(token=>!unit.tokens.includes(token))||actualQuantities.some(token=>!sourceQuantities.includes(token)))throw Error('可改写句段'+unit.id+'新增了本句没有的数字、数量或标识，当前文案保留');
   if(sourceQuantities.some(token=>!actualQuantities.includes(token)))throw Error('可改写句段'+unit.id+'未保留中文数量原写法，当前文案保留');
  }
 }
 // 保留句不接受模型覆盖，原始回包与本地合稿分别留证。
 const units={...value.units,...Object.fromEntries(plan.protectedUnits.map(unit=>[unit.id,unit.source]))};
 const assembled=assembleUnits(plan,{units});
 if(plan.editableUnits.every(unit=>compact(unit.source)===compact(value.units[unit.id])))throw Error('可改写部分与原文相同，未形成有效改写，当前文案保留');
 return {...assembled,assembly:{...assembled.assembly,kind:'source-protected-and-model-units',protectionPolicy:plan.protectionPolicy,protectedUnits:plan.protectedUnits.map(unit=>({id:unit.id,source:unit.source,reasons:unit.protectionReasons})),editableUnitIds:ids,coverageScope:'命中的数量、标识及限制句段逐字保留；其余句段、跨句关系和口播质量仍需对照审读，不证明语义全部通过'}};
}
