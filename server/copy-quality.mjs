import {processIssues,negativeClauses,compact,referenceOpening,constraintText,negativeContradictions,adjacentRepetitionWarnings} from './content-quality.mjs';
import {rewriteNumericFidelity} from './rewrite-numeric-fidelity.mjs';
// 这里只检查可确定的格式和复用问题；事实正确性、表达质量仍需对照原文人工验收。
export function assessRewrite(source,output,target,template,assembly){
 const clean=text=>String(text).replace(/[\s\p{P}\p{S}]/gu,'');
 const numeric=rewriteNumericFidelity(source,output);
 const issues=[...numeric.issues],warnings=[...(assembly?.lengthWarnings||[]),...numeric.warnings,...adjacentRepetitionWarnings(output)],same=clean(source)===clean(output);
 if(same)issues.push('输出与原文相同，未形成有效改写');
 issues.push(...processIssues(source,output));
 if(template?.source?.kind==='reference-visible'){
  const first=output.trim().split(/\r?\n/)[0];
  if(first.length>30)issues.push('原软件模板要求首段不超过30字，实际为'+first.length+'字');
  if(!source.trim().startsWith(first.replace(/[。！？!?]$/,'')))issues.push('首段未按原软件模板保留原文开头，请复核');
  issues.push(...negativeContradictions(source,output));
  for(const clause of negativeClauses(source))if(!constraintText(output).includes(constraintText(clause)))warnings.push('否定或限制条款写法已变化，请逐条核对：'+clause);
  const opening=referenceOpening(source),body=compact(output.slice(first.length)),originalBody=compact(source.slice(opening.replace(/[。！？!?]$/,'').length));
  const fragments=new Set(Array.from({length:Math.max(0,originalBody.length-7)},(_,i)=>originalBody.slice(i,i+8)));
  const covered=new Set();for(let i=0;i<=body.length-8;i++)if(fragments.has(body.slice(i,i+8)))for(let j=i;j<i+8;j++)covered.add(j);
  if(body.length>=30&&covered.size/body.length>.75)warnings.push('后文超过75%的文字位于原文连续8字片段中，重组程度需复核');
 }
 const requested=Number(target),deviation=requested>0?Math.abs(output.length-requested)/requested:null;
 const blocked=same||issues.length>0;if(deviation!==null&&deviation>.2)issues.push('输出字数与指定字数相差超过20%，请复核');
 return {status:blocked?'rejected':'needs-review',accepted:false,issues,warnings,sourceCharacters:source.length,outputCharacters:output.length,targetCharacters:requested,targetDeviation:deviation,scope:'字数、明显过程文字与有限原文约束检查，不代表事实或口播质量已通过'};
}
