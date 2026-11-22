import {rewriteRequest} from './rewrite-request.mjs';
import {negativeClauses} from './content-quality.mjs';
import {rewriteUnits,unitSchema,assembleUnits} from './rewrite-units.mjs';
import {creativePresetPrompt} from './creative-presets.mjs';

export async function generateRewrite(providers,input,ctx){
 const request=rewriteRequest(input),reference=input.template.source?.kind==='reference-visible';
 if(!reference)return {...await providers.text(request.system,request.user+creativePresetPrompt(input.creativePreset),ctx,{model:input.generation.model}),wrapperSource:request.wrapperSource,creativePreset:input.creativePreset};
 const plan=rewriteUnits(input.fields.sourceText,input.fields.wordLimit),protectedClauses=negativeClauses(input.fields.sourceText),wrapperSource='local-reference-rewrite-units-v2';
 // 原厂可见system模板保持原文；本地只请求后文，最终首段由应用按既有规则单独拼接。
 const user=`本次只改写后文，不生成第一段。输出JSON对象units，每个编号对应一段可口播正文，全部编号必须返回。不要写提纲、标题或创作说明。\n应用已完成模板的首段保留步骤；你的JSON不是完整稿件，应用会按“固定首段＋units按编号排列的后文”生成最终稿。units只对应下方各编号的source，不得返回opening字段，也不得在任何单元前添加或重写问候首段。\n第一段已固定，不要重复：${plan.opening}\n每个单元的对象、具体动作、限定条件、时间地点、数字型号和先后顺序都必须完整保留。数字与型号沿用原写法。逐项用不同句式讲清原有行为，不整段照搬，不以概括省略动作。每项长度按给定区间，合稿目标${plan.target}字符（参考${plan.targetRange.min}至${plan.targetRange.max}），不靠添加参数、经历、因果、功效或空话凑长。\n否定或限制条款不得变成肯定，开头已保留的不用重复：${JSON.stringify(protectedClauses)}\n待改写有序单元（不含固定首段）：\n${JSON.stringify(plan.units.map(unit=>({id:unit.id,source:unit.source,lengthRange:[unit.minCharacters,unit.maxCharacters]})))}${input.fields.analysis?'\n仅参考表达方式，不新增事实：\n'+JSON.stringify(input.fields.analysis):''}`;
 const result=await providers.text(request.system,user+creativePresetPrompt(input.creativePreset),ctx,{model:input.generation.model,schema:unitSchema(plan)});
 try{
  const value=JSON.parse(result.text.replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));
  const assembled=assembleUnits(plan,value);
  return {...result,...assembled,rawText:result.text,wrapperSource,creativePreset:input.creativePreset,assembly:{...assembled.assembly,protectedClauses}};
 }catch(error){error.evidence={...result,rawText:result.text,input,unitPlan:plan,wrapperSource};throw error;}
}
