import {compact,referenceOpening} from './content-quality.mjs';

// 仅核对数字及英文标识的原写法，不把字面覆盖当成语义事实验证。
export function explicitTokens(value){
 const matches=String(value).match(/[A-Za-z][A-Za-z0-9]*(?:[._+-][A-Za-z0-9]+)*|\d+(?:\.\d+)?%?/gu)||[];
 return [...new Set(matches.filter(token=>/\d/u.test(token)||/^[A-Z]{2,}$/u.test(token)))];
}

export function rewriteUnits(source,target){
 const normalized=String(source).trim(),opening=referenceOpening(normalized),prefix=opening.replace(/[。！？!?]$/u,'');
 if(!prefix||!normalized.startsWith(prefix))throw Error('无法定位保留开头，当前文案保留');
 const remainder=normalized.slice(prefix.length).replace(/^[，,。！？!?；;\s]+/u,'');
 const segments=(remainder.match(/[^。！？!?\n]+(?:[。！？!?]+[”」』）)]*)?/gu)||[]).map(value=>value.trim()).filter(value=>compact(value));
 if(!segments.length)throw Error('原文只有模板要求保留的开头，请补充后文或切换写作模板');
 const requested=Number(target);
 if(!Number.isFinite(requested)||requested<=opening.length)throw Error('目标字数不足以保留开头和后文，请增加字数或切换写作模板');
 const bodyLength=segments.reduce((sum,value)=>sum+value.length,0),bodyTarget=requested-opening.length;
 const units=segments.map((value,index)=>{const expected=value.length/bodyLength*bodyTarget;return {id:'u'+(index+1),source:value,clauses:value.split(/[，,；;]/u).map(clause=>clause.trim()).filter(Boolean),minCharacters:Math.max(1,Math.floor(expected*.85)),maxCharacters:Math.max(2,Math.ceil(expected*1.2)),tokens:explicitTokens(value)};});
 return {opening,source:normalized,target:requested,targetRange:{min:Math.floor(requested*.8),max:Math.ceil(requested*1.2)},units};
}

export function unitSchema(plan){
 const properties=Object.fromEntries(plan.units.map(unit=>[unit.id,{type:'string',minLength:1,description:`仅改写${unit.id}的source后文，不重复固定首段。参考${unit.minCharacters}至${unit.maxCharacters}字符，完整保留本单元信息`} ]));
 return {type:'object',description:'仅包含待改写后文；固定首段由应用单独拼接，不在任何单元中重复。',additionalProperties:false,properties:{units:{type:'object',additionalProperties:false,properties,required:plan.units.map(unit=>unit.id)}},required:['units']};
}

export function assembleUnits(plan,value){
 if(!value||Array.isArray(value)||typeof value!=='object'||Object.keys(value).length!==1||!value.units||typeof value.units!=='object'||Array.isArray(value.units))throw Error('改写信息单元格式无效，当前文案保留');
 const ids=plan.units.map(unit=>unit.id),actual=Object.keys(value.units);
 if(ids.length!==actual.length||actual.some(id=>!ids.includes(id)))throw Error('改写信息单元编号缺失或多出，当前文案保留');
 const lengthWarnings=[],units=plan.units.map(unit=>{
  const output=value.units[unit.id];
  if(typeof output!=='string'||!output.trim()||!compact(output))throw Error('改写信息单元'+unit.id+'为空，当前文案保留');
  const text=output.trim();
  // 字数偏差只能提示遗漏或冗长的可能，不能直接作为语义事实错误的证据。
  if(text.length<unit.minCharacters||text.length>unit.maxCharacters)lengthWarnings.push(`信息单元${unit.id}为${text.length}字符，参考${unit.minCharacters}至${unit.maxCharacters}字符，请对照原句核对遗漏或冗长：${unit.source}`);
  if(compact(text).startsWith(compact(plan.opening)))throw Error('后文重复了保留开头，当前文案保留');
  const tokens=explicitTokens(text),missing=unit.tokens.filter(token=>!tokens.includes(token));
  if(missing.length)throw Error('改写信息单元'+unit.id+'未保留数字或标识原写法：'+missing.join('、')+'，当前文案保留');
  return {...unit,text};
 });
 const text=[plan.opening,...units.map(unit=>unit.text)].join('\n'),sourceTokens=explicitTokens(plan.source),added=explicitTokens(text).filter(token=>!sourceTokens.includes(token));
 if(added.length)throw Error('改写新增了原文没有的数字或标识：'+added.join('、')+'，当前文案保留');
 return {text,assembly:{kind:'source-opening-and-model-units',opening:plan.opening,units,lengthWarnings,targetRange:plan.targetRange,coverageScope:'有序句段逐项返回及有限数字标识原写法核对，不证明动作、条件、语义或口播质量通过'}};
}
