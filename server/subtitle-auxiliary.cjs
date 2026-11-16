function captionSignature(draft) {return JSON.stringify({id:draft.id,sourceId:draft.edit.sourceId||draft.video.assetId,captions:draft.edit.captions,language:draft.edit.subtitleLanguage||'英语'});}
function parseAuxiliary(text, rows, kind) {
  const clean=text.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');let value;
  try{value=JSON.parse(clean);}catch{throw new Error('本地模型没有返回有效JSON，未修改字幕，请重试或手工填写');}
  if(!Array.isArray(value)||value.length!==rows.length)throw new Error('本地模型返回的字幕数量不符，未修改字幕');
  return rows.map((row,index)=>{
    const result=value[index];if(result?.index!==index)throw new Error('本地模型返回的字幕序号不符，未修改字幕');
    const previous=row.auxiliary?.sourceText===row.text?row.auxiliary:{};
    const auxiliary={...previous,sourceText:row.text};
    if(kind==='translation') {
      if(typeof result.translation!=='string'||!result.translation.trim()||result.translation.length>3000)throw new Error('本地模型返回空译文或译文过长，未修改字幕');
      auxiliary.translation=result.translation.trim();
    } else {
      if(!Array.isArray(result.keywords)||result.keywords.length>5||result.keywords.some(word=>typeof word!=='string'||!word.trim()||!row.text.includes(word)))throw new Error('本地模型返回的关键词不是原文中的词语，未修改字幕');
      auxiliary.keywords=[...new Set(result.keywords)];
      delete auxiliary.keywordsInput;
    }
    return {...row,auxiliary};
  });
}
async function generateAuxiliary(providers,draft,kind,ctx) {
  if(!['translation','keywords'].includes(kind))throw new Error('字幕辅助文本类型无效');
  const config=providers.config();let url;try{url=new URL(config.baseUrl);}catch{throw new Error('请在模型设置配置已有本地文本模型，或手工填写字幕译文和关键词');}
  if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||!config.model)throw new Error('字幕辅助文本当前仅调用已配置的本机文本服务，请配置本地模型或手工填写');
  const source=draft.edit.captions;
  if(!source.length||source.some(row=>typeof row.text!=='string'||!row.text.trim()))throw new Error('请先确认非空字幕，再生成辅助文本');
  if(source.length>2000||source.some(row=>row.text.length>500))throw new Error('字幕过多或单句过长，请拆分视频后处理');
  const rows=[];
  for(let offset=0;offset<source.length;offset+=8){
    ctx.signal?.throwIfAborted();const batch=source.slice(offset,offset+8);
    // 内容要求来自已核实的三套双语模板translateBatch；输出仍使用本机严格JSON协议。
    const requirement=kind==='translation'?`你是一个专业的字幕翻译专家。将每条字幕翻译为${draft.edit.subtitleLanguage||'英语'}。严格保持数量和顺序，每句单独翻译，不合并也不拆句。译文简洁、自然、口语化，适合短视频字幕，避免过长。译文保留事实且非空；英文译文不要包含任何标点符号。每项仅含index和translation，只输出译文数据，不要解释或注释。`:'从每条字幕中提取0至3个值得强调的连续词语。每项仅含index和keywords数组，关键词必须逐字出现在原文中，没有合适词语时返回空数组。';
    const property=kind==='translation'?'translation':'keywords';
    const schema={type:'array',minItems:batch.length,maxItems:batch.length,items:{type:'object',additionalProperties:false,properties:{index:{type:'integer',minimum:0,maximum:batch.length-1},[property]:kind==='translation'?{type:'string',minLength:1}:{type:'array',maxItems:5,items:{type:'string',minLength:1}}},required:['index',property]}};
    // 使用本机模型的结构化输出约束，格式仍需在本地逐项校验。
    const prompt='你是字幕编辑。只输出一个JSON数组，不要解释、Markdown或思考过程。保持条目数量和index顺序。'+requirement+'\nJSON Schema：'+JSON.stringify(schema);
    const result=await providers.text(prompt,JSON.stringify(batch.map((row,index)=>({index,text:row.text}))),ctx,{schema});
    rows.push(...parseAuxiliary(result.text,batch,kind));ctx.progress?.(Math.round((offset+batch.length)/source.length*100),'正在处理字幕辅助文本');
  }
  return {rows,signature:captionSignature(draft),kind,local:true,model:config.model};
}
module.exports={captionSignature,parseAuxiliary,generateAuxiliary};
