const labels={queued:'等待提取',running:'正在提取',succeeded:'提取成功',failed:'提取失败',cancelled:'已停止',unknown:'结果待确认',duplicate:'重复链接，已跳过',interrupted:'执行已中断',stopping:'正在停止',completed:'提取完成',partial:'部分完成'};

export function extractionStatusLabel(status){return labels[status]||status||'状态未知';}
export function extractionBatchActive(batch){return ['queued','running','stopping'].includes(batch?.status);}
export function extractionBatchUnsettled(batch){return extractionBatchActive(batch)||batch?.status==='unknown'||batch?.items?.some(item=>item.status==='unknown');}
// 此处仅用于输入预览，服务端返回的批次和条数是最终依据。
export function previewExtractionLinks(text){
 const links=[],seen=new Set();let total=0,duplicates=0,invalid=0;
 for(const row of String(text||'').split(/\r?\n/).filter(row=>row.trim())){
  const found=row.match(/https?:\/\/[^\s<>"'`\u3000-\u303f\uff00-\uffef]+/gi)||[];
  const entries=found.length>1?found:[row];
  for(const entry of entries){
   total++;
   const foundLinks=[...new Set((entry.match(/https?:\/\/[^\s<>"'`\u3000-\u303f\uff00-\uffef]+/gi)||[]).map(link=>link.replace(/[,.!?;:)\]}]+$/gu,'')))];
   if(foundLinks.length!==1||entry.length>10000){invalid++;continue;}
   try{const url=new URL(foundLinks[0]);if(!url.hostname||url.username||url.password){invalid++;continue;}url.hash='';if(seen.has(url.href))duplicates++;else{seen.add(url.href);links.push(url.href);}}
   catch{invalid++;}
  }
 }
 return {links,total,unique:links.length,duplicates,invalid};
}
export function extractionProgress(value){return Math.max(0,Math.min(100,Number(value)||0));}
export function extractionItemMessage(item){
 if(item?.terminationReceipt)return item.message||'用户已核对原任务终止，保留人工回执';
 const message=item?.error||item?.message||'';
 // 中止异常保留在原任务证据中，操作列表使用清晰的中文状态。
 return item?.status==='cancelled'&&/^(?:This operation was aborted|The operation was aborted\.?|AbortError(?::.*)?)$/i.test(message.trim())?'已按请求停止提取，已有结果保留。':message;
}
export function batchOwnsOperationStatus({step,tab,draftId,batchId,run,busy}){
 return !busy&&step===0&&tab==='extract'&&!!batchId&&run?.type==='extract'&&run.draftId===draftId&&run.parameters?.batchId===batchId;
}
