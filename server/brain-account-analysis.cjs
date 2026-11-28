const crypto=require('node:crypto');
const {studyPrompt}=require('./brain-study-prompt.cjs');
const version='account-text-batches-v1';
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');

// 每段原文都进入一个有来源的批次；长作品切段而不截断，分析摘录仍须能定位原文。
function batches(sources,{maxChars=10000,maxSources=12,maxBytes=24000}={}){
 const result=[];let current={text:'',segments:[]};
 const flush=()=>{if(current.segments.length){current.hash=hash(JSON.stringify(current));result.push(current);current={text:'',segments:[]};}};
 for(const [sourceIndex,source] of sources.entries()){
  const text=String(source.text||'');
  for(let start=0;start<text.length;){
   if(current.segments.length>=maxSources||current.text.length>=maxChars-2||Buffer.byteLength(current.text)>maxBytes-6)flush();
   const separator=current.text?'\n\n':'';let size=Math.min(text.length-start,maxChars-current.text.length-separator.length);
   const available=maxBytes-Buffer.byteLength(current.text+separator);let low=0,high=size;
   while(low<high){const middle=Math.ceil((low+high)/2);if(Buffer.byteLength(text.slice(start,start+middle))<=available)low=middle;else high=middle-1;}size=low;
   if(size<=0){flush();continue;}
   let end=start+size;
   // 避免在代理对中间切断表情字符。
   if(end<text.length&&/[\uD800-\uDBFF]/.test(text[end-1]))end--;
   current.text+=separator+text.slice(start,end);current.segments.push({sourceIndex,url:source.url||'',start,end});start=end;
   if(start<text.length)flush();
  }
 }
 flush();return result;
}
function cachedAnalyses(store,configuration,mode,basis){
 const found=new Map();
 for(const run of store.data.runs){if(run.type!=='brain-study'||['running','queued','unknown'].includes(run.status))continue;
  const records=run.output?.evidence?.profileAnalyses||run.failureOutput?.profileAnalyses||run.checkpoint?.profileAnalyses;
  for(const item of records||[])if(item.configuration===configuration&&item.version===version&&item.mode===mode&&item.basis===basis&&!found.has(item.hash))found.set(item.hash,{...item,reusedRunId:run.id});
 }return found;
}
async function analyzeAccount({sources,mode,basis,configuration,providers,store,ctx,evidence,validate,parse}){
 const config=providers.config(),context=Number(config.textContextTokens)||32768,output=Number(config.textMaxTokens)||8192;
 const empty=studyPrompt(mode,''),available=context-output-512-Buffer.byteLength(empty.system+empty.user)-1600;
 if(available<256)throw Error('当前文本模型的上下文与输出预算不足以分析账号文案，请调整模型设置后继续；采集结果已保留');
 const chunks=batches(sources,{maxBytes:Math.min(24000,available)}),cache=cachedAnalyses(store,configuration,mode,basis),records=[];
 evidence.profileAnalyses=records;
 const collection=evidence.profileCollection;collection.analysisComplete=false;collection.analysisBatchCount=chunks.length;collection.analyzedBatchCount=0;
 const checkpoint=()=>ctx.checkpoint?.({profileCollection:collection,profileAnalyses:records});checkpoint();
 for(const [index,chunk] of chunks.entries()){
  ctx.signal.throwIfAborted();ctx.progress(70+index/chunks.length*27,`正在分析全部有效文案：第 ${index+1}/${chunks.length} 批，已完成 ${index} 批`);
  let saved=cache.get(chunk.hash),analysis,response;
  if(saved){try{analysis=validate(saved.analysis,chunk.text);}catch{saved=null;}}
  if(!saved){const prompt=studyPrompt(mode,chunk.text);prompt.user=`这是账号文案第 ${index+1} 批，仅概括本批实际文字，不代表账号全貌。\n`+(basis==='caption'?'资料是作者发布的标题与配文，不是视频口播、字幕或画面。\n':'资料是实际音轨转写，可能含错字，不包含画面分析。\n')+prompt.user;response=await providers.text(prompt.system,prompt.user,ctx,{schema:prompt.schema});evidence.pendingAnalysis={batch:index+1,response};analysis=validate(parse(response.text),chunk.text);}
  if(analysis.evidence.some(item=>!chunk.segments.some(segment=>sources[segment.sourceIndex].text.slice(segment.start,segment.end).includes(item.quote))))throw Error('分批分析摘录跨越作品边界，未作为真实单作品证据保存');
  records.push({version,hash:chunk.hash,configuration,mode,basis,segments:chunk.segments,analysis,...(saved?{reusedRunId:saved.reusedRunId}:{response})});delete evidence.pendingAnalysis;collection.analyzedBatchCount=records.length;checkpoint();
 }
 // 汇总只组合已核验的分批发现，不再把全部原文塞进一次模型上下文。
 const fields=['tone','structure','strengths','avoid','topicAngles'];
 const analysis={summary:`已分析 ${sources.length} 条有效文案，共 ${records.length} 批。分批要点如下；各批详细结果和原文依据可逐批查看。\n`+records.slice(0,5).map((r,i)=>`第${i+1}批：${r.analysis.summary.slice(0,480)}`).join('\n'),evidence:[]};
 for(const field of fields){const items=[];for(let pos=0;items.length<15;pos++){let present=false;for(const r of records){const value=r.analysis[field][pos];if(value){present=true;if(!items.includes(value))items.push(value);}if(items.length>=15)break;}if(!present)break;}analysis[field]=items;}
 for(const r of records){for(const item of r.analysis.evidence){if(analysis.evidence.length>=8)break;analysis.evidence.push(item);}if(analysis.evidence.length>=8)break;}
 collection.analysisComplete=true;collection.complete=collection.complete&&collection.analysisComplete;checkpoint();
 return {analysis,records,batches:records.map(({analysis,segments})=>({analysis,segments}))};
}
// 创作阶段只引用有明确来源的有限原文，不让整账号文本撑爆模型上下文。
function creationContext(brain,config={}){
 const maxBytes=Math.max(512,Math.min(10000,(Number(config.textContextTokens)||32768)-(Number(config.textMaxTokens)||8192)-512-Buffer.byteLength(JSON.stringify(brain.analysis||{}))-6500)),maxChars=Math.max(100,Math.floor(maxBytes/4));
 if(Buffer.byteLength(String(brain.sampleText||''))<=maxBytes)return brain.sampleText||'';
 const sources=brain.sources||[],parts=[],used=new Set();let length=0;
 for(const batch of brain.analysisBatches||[])for(const item of batch.analysis.evidence||[]){const source=sources.find(s=>s.text.includes(item.quote));if(!source||used.has(item.quote))continue;const block=`来源：${source.url||source.title}\n${item.quote}`;if(length+block.length>maxChars)continue;used.add(item.quote);parts.push(block);length+=block.length+2;}
 if(!parts.length)for(const source of sources){const block=`来源：${source.url||source.title}\n${source.text.slice(0,Math.min(1000,maxChars-length-100))}`;if(block.length+length>maxChars||maxChars-length<100)break;parts.push(block);length+=block.length+2;}
 return '以下是已学习资料中供本次创作引用的原文摘录，不是整账号全文。样本宣传不代表已验证事实；不能据此新增商品数据。\n'+parts.join('\n\n');
}
module.exports={batches,analyzeAccount,creationContext,version};
