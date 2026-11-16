import {rewriteUnits,unitSchema,assembleUnits} from '../../server/rewrite-units.mjs';
import {negativeContradictions} from '../../server/content-quality.mjs';

// 此候选仅用于隔离验证，未接入正式生成链；原文引用不等于语义已通过。
export function anchorPlan(source,target){
 const plan=rewriteUnits(source,target);
 return {...plan,clauses:plan.units.flatMap(unit=>unit.clauses.map((source,index)=>({id:unit.id+'c'+(index+1),unitId:unit.id,source:source.replace(/[。！？!?]+$/u,'')})))};
}
export function anchorSchema(plan){
 const properties=Object.fromEntries(plan.clauses.map(clause=>[clause.id,{type:'array',minItems:1,maxItems:8,uniqueItems:true,items:{type:'string',minLength:1}}]));
 return {type:'object',additionalProperties:false,properties:{anchors:{type:'object',additionalProperties:false,properties,required:plan.clauses.map(c=>c.id)}},required:['anchors']};
}
export function parseAnchorPlan(plan,value){
 if(!value||Array.isArray(value)||typeof value!=='object'||Object.keys(value).length!==1||!value.anchors||typeof value.anchors!=='object'||Array.isArray(value.anchors))throw Error('关键短语清单格式无效');
 const actual=Object.keys(value.anchors),ids=plan.clauses.map(c=>c.id);
 if(ids.length!==actual.length||actual.some(id=>!ids.includes(id)))throw Error('关键短语分句编号缺失或多出');
 return plan.clauses.map(clause=>{
  const quotes=value.anchors[clause.id];
  if(!Array.isArray(quotes)||!quotes.length||quotes.length>8||new Set(quotes).size!==quotes.length||quotes.some(quote=>typeof quote!=='string'||!quote.trim()||quote!==quote.trim()||!clause.source.includes(quote)))throw Error('分句'+clause.id+'的关键短语不是有效原文引用');
  return {...clause,quotes:[...quotes]};
 });
}
export function assembleAnchoredRewrite(plan,anchors,value){
 const assembled=assembleUnits(plan,value),missing=[];
 for(const clause of anchors){const output=assembled.assembly.units.find(unit=>unit.id===clause.unitId).text;for(const quote of clause.quotes)if(!output.includes(quote))missing.push({clauseId:clause.id,unitId:clause.unitId,sourceQuote:quote,output});}
 if(missing.length){const error=Error('改写未保留关键短语：'+missing.map(row=>row.sourceQuote).join('、'));error.anchorDifferences=missing;throw error;}
 const contradictions=negativeContradictions(plan.source,assembled.text);if(contradictions.length)throw Error(contradictions.join('；'));
 return {...assembled,assembly:{...assembled.assembly,kind:'source-opening-and-anchored-model-units',anchors,coverageScope:'每分句有模型提出的原文短语引用，逐项检查在对应输出句段出现；不证明清单穷尽、逻辑关系不变或自然口播质量'}};
}
const parseJson=text=>JSON.parse(text.trim().replace(/^```(?:json)?\s*/u,'').replace(/\s*```$/u,''));
export async function generateAnchoredRewrite(providers,input,ctx={}){
 const plan=anchorPlan(input.fields.sourceText,input.fields.wordLimit),requests=[];
 const extractionSystem='你是中文原文短语整理助手。仅输出符合约束的JSON，不改写、不解释。每个分句至少引用一条原文中的连续短语；短语逐字复制，覆盖具体对象、动作和必要的修饰或限制，不概括、不替换同义词。数字型号、否定、条件、范围、顺序词需要保留。优先短而完整的关键短语，不把长分句整句复制充数。';
 const extractionUser=JSON.stringify(plan.clauses.map(({id,source})=>({id,source})));
 let anchorResult,result,anchors;
 try{
  ctx.signal?.throwIfAborted();anchorResult=await providers.text(extractionSystem,extractionUser,ctx,{model:input.generation.model,schema:anchorSchema(plan)});requests.push(anchorResult);anchors=parseAnchorPlan(plan,parseJson(anchorResult.text));ctx.signal?.throwIfAborted();
  const user='只改写下列后文句段，按原有units编号返回JSON，不输出已保留的开头。每项的引号短语均须逐字保留在对应句段，其余部分用自然口语重组句式，不增添事实、不概括行为、不更换条件和先后顺序，不写标题或解释。不要靠删减细节缩短。全文目标'+plan.target+'字符。已保留开头：'+plan.opening+'\n'+JSON.stringify(plan.units.map(unit=>({id:unit.id,source:unit.source,quotes:anchors.filter(clause=>clause.unitId===unit.id).flatMap(c=>c.quotes)})));
  result=await providers.text(input.template.content,user,ctx,{model:input.generation.model,schema:unitSchema(plan)});requests.push(result);ctx.signal?.throwIfAborted();const assembled=assembleAnchoredRewrite(plan,anchors,parseJson(result.text));
  return {...result,...assembled,rawText:result.text,wrapperSource:'local-reference-span-anchors-v1',extraction:anchorResult,requests};
 }catch(error){error.evidence={plan,anchors,extraction:anchorResult,result,requests,wrapperSource:'local-reference-span-anchors-v1',anchorDifferences:error.anchorDifferences||[]};throw error;}
}
