async function generateCoverTitle(providers,draft,data,ctx){
 const {textInput}=await import('./text-input.mjs'),input=textInput(draft,'title',data),content=input.fields.text;
 if(!content?.trim())throw Error('请先填写文案再生成标题');
 const titleLimit=input.template.titleLimit||100,descriptionLimit=input.template.descriptionLimit||500;
 const absentNumerals=[...'0123456789零一二三四五六七八九十百千万'].filter(char=>!content.includes(char));
 const pattern=limit=>'^[^'+absentNumerals.join('')+'\\r\\n]{0,'+limit+'}$';
 const schema={type:'object',additionalProperties:false,properties:{title:{type:'string',minLength:1,maxLength:titleLimit,pattern:pattern(titleLimit)},description:{type:'string',maxLength:descriptionLimit,pattern:pattern(descriptionLimit)}},required:['title','description']};
 const result=await providers.text(input.template.content.replaceAll('{content}',content),'只根据以下正文生成标题和描述。概括原文主题与具体动作，使用原文已有的事物和措辞，不增加原文未列出的步骤数量、经历、事实或效果保证。以JSON返回title和description，不要前言或代码块；标题最多'+titleLimit+'字，描述最多'+descriptionLimit+'字。\n正文：\n'+content,ctx,{schema,model:input.generation.model});
 const invalid=message=>{const error=Error(message);error.evidence={rawText:result.text,request:result.request,input};throw error;};
 let value;try{value=JSON.parse(result.text.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''));}catch{invalid('标题模型未返回有效JSON，原标题保留');}
 if(typeof value.title!=='string'||!value.title.trim()||value.title.trim().length>titleLimit||/[\r\n]/.test(value.title)||typeof value.description!=='string'||value.description.length>descriptionLimit)invalid('标题或描述不符合模板长度与格式，原标题保留');
 const numbers=(value.title+'\n'+value.description).match(/\d+(?:\.\d+)?|[零一二三四五六七八九十百千万]+(?=步|招|个方法|天|年|倍|元|%)/g)||[];
 const issues=[...new Set(numbers.filter(number=>!content.includes(number)))].map(number=>'标题或描述新增正文没有的数字：'+number);
 return {...result,rawText:result.text,text:value.title.trim(),description:value.description,input,quality:{status:issues.length?'rejected':'needs-review',accepted:false,issues,scope:'数字和格式检查不等同于标题事实与吸引力验收'}};
}
module.exports={generateCoverTitle};
