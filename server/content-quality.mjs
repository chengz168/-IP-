// 仅判断有明确文本证据的问题；这些检查不代替事实、语义和口播效果验收。
export const compact=value=>String(value??'').replace(/[\s\p{P}\p{S}]/gu,'');
export function processIssues(source,output){
 const issues=[],patterns=[/(?:以下是|下面是|这是为你|我为你)[^\n。！？]{0,25}(?:改写|文案)/g,/(?:资料里|资料中|资料未)[^\n。！？]{0,12}(?:没提|没有提供|未提供|未提及)/g,/根据(?:你的|您的)(?:要求|提示词)/g];
 for(const pattern of patterns)for(const match of String(output).matchAll(pattern))if(!String(source).includes(match[0]))issues.push('正文含创作过程说明：'+match[0]);
 return [...new Set(issues)];
}
export function negativeClauses(source){
 const clauses=String(source).match(/[^，,。.!！?？;；\n]+/gu)||[];
 return [...new Set(clauses.map(value=>value.trim()).filter(value=>value.length<=100&&/(?:不(?:提供|支持|内置|防水|收|代为|代|包含|具备|能|允许|得|要|适合|是|构成|代表|保证|意味)|^(?:也|并)?没有|禁止|不得|无需|无须)/u.test(value)))];
}
// 仅接受这些有明确否定对应的常见写法，不进行宽泛的同义改写或语义判定。
export function constraintText(value){return compact(String(value).replace(/([^，,。；;！？\n]+)一律不收/gu,'不收$1').replace(/千万别|别急着|切勿|不要/gu,'不要').replace(/不提供邮寄/gu,'不邮寄').replace(/代为保管|代管/gu,'代保管').replace(/剩下的书|剩余书籍/gu,'剩余书').replace(/破书/gu,'破损书'));}
export function negativeContradictions(source,output){
 // 只拦截已支持的动作明确从否定变成肯定；其余写法不一致交给复核，不能假装理解全部语义。
 const rules=[[/不(?:提供|支持)?邮寄/u,/邮寄/gu],[/不(?:代为保管|代保管|代管)/u,/(?:代为保管|代保管|代管)/gu],[/不内置电池/u,/内置电池/gu],[/不(?:具备|支持)?防水/u,/防水/gu],[/不要(?:直接)?删/u,/(?:直接)?删(?:掉|除)?/gu]],issues=[];
 const parts=String(output).split(/[，,。；;！？\n]|也|但是|但仍|却/gu);
 for(const [condition,action]of rules){if(!condition.test(source))continue;for(const part of parts)for(const match of part.matchAll(action)){const prefix=part.slice(0,match.index).replace(/\s/g,'');if(!/(?:不(?:要|得|能|会|可|可以|再)?(?:允许|支持|提供|具备)?(?:直接|代为|再|随意)?|没有|没|别(?:直接|随意)?|禁止|切勿|无需)$/u.test(prefix))issues.push('原文的否定限制在输出中变成肯定：'+part.trim());}}
 return [...new Set(issues)];
}

// 只提示明确的相邻重复片段：片段至少4个字，两次出现之间仅允许少量标点或空白。
// 这是文案质量提醒，不推断语义，也不自动删除文本。
export function adjacentRepetitionWarnings(output){
 const text=String(output??'');
 const warnings=[];
 for(const match of text.matchAll(/([\p{Script=Han}A-Za-z0-9]{4,24})([，,、；;：:\s]{0,3})\1/gu)){
  const phrase=match[1];
  warnings.push('检测到相邻重复片段“'+phrase+'”，请人工确认是否为口误或有意排比');
 }
 return [...new Set(warnings)];
}
export function referenceOpening(source){
 const text=String(source).trim(),sentence=text.match(/^[\s\S]*?[。！？!?](?:[”」』])?/u)?.[0]||text;
 if(sentence.length<=30)return sentence;
 const bounded=text.slice(0,29),boundaries=[...bounded.matchAll(/[，,；;：:]/gu)];
 const cut=boundaries.at(-1)?.index;
 return (cut!==undefined&&cut>0?bounded.slice(0,cut):bounded)+'。';
}
export function assessCandidate(input,output,otherTexts=[]){
 const source=Object.values(input.fields||{}).join('\n'),issues=processIssues(source,output),warnings=[];
 if(otherTexts.some(text=>compact(text)===compact(output)))issues.push('本方案与同批其他方案完全重复');
 const target=Number(input.wordLimit),deviation=target>0?Math.abs(String(output).length-target)/target:null;
 if(deviation!==null&&deviation>.2)warnings.push('正文长度与目标相差超过20%，请核对完整性与节奏');
 // 数字仅核对明确量化表达；“三种建议”等创作结构不冒认产品事实。
 const quantities=String(output).match(/\d+(?:\.\d+)?\s*(?:元|厘米|毫米|千克|公斤|毫升|升|瓦|小时|分钟|天|年|%)/gu)||[];
 for(const value of quantities)if(!source.replace(/\s/g,'').includes(value.replace(/\s/g,'')))warnings.push('资料未直接支持的量化表述：'+value);
 for(const match of String(output).matchAll(/不显拥挤|多数桌面|占用空间相对有限|减少翻找时间|(?:提升|提高)[^。！？]{0,8}(?:效率|记忆)|不是[^。！？]{1,12}(?:而是|是)[^。！？]{1,16}/gu))if(!source.includes(match[0]))warnings.push('资料未直接支持的适配、效果或原因表述：'+match[0]);
 return {status:issues.length?'rejected':'needs-review',accepted:false,issues,warnings,outputCharacters:String(output).length,targetCharacters:target,targetDeviation:deviation,scope:'后台过程、重复与有限量化检查；未证明事实或口播质量通过'};
}
export function assessCandidates(input,items){return items.map((item,index)=>assessCandidate(input,item.text,items.filter((_,i)=>i!==index).map(item=>item.text)));}
