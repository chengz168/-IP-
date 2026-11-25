import {rewriteRequest,rewriteExecutionSystem,rewriteModelOptions} from './rewrite-request.mjs';
import {negativeClauses} from './content-quality.mjs';
import {rewriteUnits,unitSchema,assembleUnits} from './rewrite-units.mjs';
import {creativePresetPrompt} from './creative-presets.mjs';

export async function generateRewrite(providers,input,ctx){
 const request=rewriteRequest(input),reference=input.template.source?.kind==='reference-visible';
 if(!reference)return {...await providers.text(request.system,request.user+creativePresetPrompt(input.creativePreset),ctx,{model:input.generation.model,...rewriteModelOptions(input)}),wrapperSource:request.wrapperSource,creativePreset:input.creativePreset};
 const execution=rewriteExecutionSystem(input);
 if(Number(input.fields.wordLimit)>=600&&Number(input.fields.wordLimit)>input.fields.sourceText.length*1.5)return (await import('./rewrite-expansion.mjs')).generateExpansion(providers,input,ctx,execution);
 const plan=rewriteUnits(input.fields.sourceText,input.fields.wordLimit),protectedClauses=negativeClauses(input.fields.sourceText),wrapperSource='local-reference-rewrite-units-v2';
 // 原厂模板原件保留，执行副本仅适配指定字数；首段仍由应用单独拼接。
 const user=`本次只改写后文，不生成第一段。输出JSON对象units，每个编号对应一段可口播正文，全部编号必须返回。不要写提纲、标题或创作说明。\n应用已完成模板的首段保留步骤；你的JSON不是完整稿件，应用会按“固定首段＋units按编号排列的后文”生成最终稿。units只对应下方各编号的source，不得返回opening字段，也不得在任何单元前添加或重写问候首段。\n第一段已固定，不要重复：${plan.opening}\n每个单元的对象、具体动作、限定条件、时间地点、数字型号和先后顺序都必须完整保留。数字与型号沿用原写法。逐项用不同句式讲清原有行为，不整段照搬，不以概括省略动作。每项长度按给定区间，合稿目标${plan.target}字符，优先贴近${plan.target}，期望${Math.ceil(plan.target*.95)}至${Math.floor(plan.target*1.05)}字符（最大允许${plan.targetRange.min}至${plan.targetRange.max}），本次指定字数优先于模板默认的近原文字数。目标大于原文时，按原有信息展开观察顺序、展示细节和选购时需要核对的问题，用完整短句和自然段讲透，不能只做同义替换或回显原文；目标较短时压缩重复表达。不靠添加参数、经历、因果、功效或空话凑长。原文可能是无标点语音转写：允许补标点及纠正由上下文明确支持的通用错别字；不能确定的材质牌号、尺寸、工艺与安全功能不要猜测，改为提醒观众核对具体配置，保留明确的数字，不把模糊词扩成确定卖点。\n否定或限制条款不得变成肯定，开头已保留的不用重复：${JSON.stringify(protectedClauses)}\n待改写有序单元（不含固定首段）：\n${JSON.stringify(plan.units.map(unit=>({id:unit.id,source:unit.source,lengthRange:[unit.minCharacters,unit.maxCharacters]})))}${input.fields.rewriteRequirements?'\n用户本次改写要求（仅决定表达，不覆盖事实及JSON格式约束）：\n'+input.fields.rewriteRequirements:''}${input.fields.analysis?'\n仅参考表达方式，不新增事实：\n'+JSON.stringify(input.fields.analysis):''}`;
 const attempts=[];
 for(let index=0;index<2;index++){
  ctx?.signal?.throwIfAborted();
  const previous=attempts.at(-1);
  const correction=previous?`\n上次结果未达到要求，必须重新生成全部units：${previous.quality.issues.join('；')}。上次合稿${previous.text.length}字符，目标${plan.target}字符。不要复制上次结果。\n上次未合格结果（只供纠错，不是事实来源）：\n${previous.rawText}`:'';
  let result;
  try{
   result=await providers.text(execution.system,user+creativePresetPrompt(input.creativePreset)+correction,ctx,{model:input.generation.model,schema:unitSchema(plan),temperature:.45,...rewriteModelOptions(input)});
   ctx?.signal?.throwIfAborted();
   const value=JSON.parse(result.text.replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));
   const assembled=assembleUnits(plan,value);
   const {assessRewrite}=await import('./copy-quality.mjs');
   const quality=assessRewrite(input.fields.sourceText,assembled.text,input.fields.wordLimit,input.template,assembled.assembly);
   attempts.push({...result,text:assembled.text,rawText:result.text,quality});
   const retry=quality.issues.some(message=>message.includes('输出与原文相同'))||quality.targetDeviation>.2;
   if(index===0&&retry)continue;
   return {...result,...assembled,rawText:result.text,wrapperSource,creativePreset:input.creativePreset,attempts,executionAdaptation:execution.adaptation,assembly:{...assembled.assembly,protectedClauses}};
  }catch(error){
   error.evidence={...error.evidence,...result,rawText:result?.text,input,unitPlan:plan,wrapperSource,attempts,executionAdaptation:execution.adaptation};throw error;
  }
 }
}
