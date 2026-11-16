// 仅核对改写前后明确量化表达的原写法，不据此判断源资料本身是否真实。
const normalize=value=>String(value??'').normalize('NFKC').replace(/\s/gu,'');
const unitFamilies={ '%':'percentage','‰':'per-mille','股':'shares','万股':'shares','亿股':'shares','元':'money','万元':'money','亿元':'money','组合':'account',
 '毫米':'length','厘米':'length','米':'length','千米':'length','克':'weight','千克':'weight','公斤':'weight','毫升':'volume','升':'volume','瓦':'power','千瓦':'power'};

export function numericExpressions(value){
 const text=normalize(value),pattern=/(?<![A-Za-z0-9_.])[-+]?\d+(?:\.\d+)?(亿股|万股|股|亿元|万元|元|组合|毫米|厘米|千米|米|千克|公斤|克|毫升|升|千瓦|瓦|%|‰)/gu;
 return [...text.matchAll(pattern)].map(match=>({text:match[0],family:unitFamilies[match[1]]}));
}

export function rewriteNumericFidelity(source,output){
 const before=numericExpressions(source),after=numericExpressions(output);
 const sourceTokens=new Set(before.map(item=>item.text)),outputTokens=new Set(after.map(item=>item.text));
 const families=new Set(before.map(item=>item.family));
 // 同类单位已有原文依据时，新增或替换的数值可明确定位；仅漏写交人工复核，不猜测数字对应哪项事实。
 const unsupported=[...new Set(after.filter(item=>families.has(item.family)&&!sourceTokens.has(item.text)).map(item=>item.text))];
 const missing=[...new Set(before.filter(item=>!outputTokens.has(item.text)).map(item=>item.text))];
 return {
  issues:unsupported.map(token=>'改写出现原文没有的同类量化数字或单位：'+token+'，请核对原文，当前候选已拒绝'),
  warnings:missing.map(token=>'原文量化表达未原样保留：'+token+'，请核对是否遗漏或改变写法'),
 };
}
