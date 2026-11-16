function parseTitle(text){
 const raw=String(text).trim();let value;
 // 正式请求沿用原版中文字段两行，保留旧JSON调用结果的兼容读取。
 if(raw.startsWith('{')||raw.startsWith('```')){try{value=JSON.parse(raw.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''));}catch{throw new Error('模型没有返回有效主副标题，原内容已保留');}}
 else{const field=name=>raw.match(new RegExp(name+'[：:][^\\S\\r\\n]*(.+?)(?=\\r?\\n|主标题[：:]|副标题[：:]|$)'))?.[1]?.trim()||'';value={title:field('主标题'),subtitle:field('副标题')};}
 if(!value||typeof value.title!=='string'||!value.title.trim()||value.title.length>100||typeof value.subtitle!=='string'||!value.subtitle.trim()||value.subtitle.length>100)throw new Error('模型返回的主副标题为空或过长，原内容已保留');
 return {title:value.title.trim(),subtitle:value.subtitle.trim()};
}
async function generateTitle(providers,draft,ctx){
 const config=providers.config();let url;try{url=new URL(config.baseUrl);}catch{throw new Error('请先配置已有本地文本模型');}
 if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||!config.model)throw new Error('剪辑标题仅调用已配置的本机模型，请配置后重试');
 const {canGenerateEditTitle,editTitlePrompt,editTitleSignature}=await import('./edit-title-request.mjs');if(!canGenerateEditTitle(draft))throw new Error('缺少可用于生成标题的视频或文案');
 const prompt=editTitlePrompt(draft),result=await providers.text('',prompt,ctx,{temperature:.8,maxTokens:300});
 let title;try{title=parseTitle(result.text);}catch(error){error.evidence={rawText:result.text,request:result.request,promptSource:'reference-viral-title-v840'};throw error;}
 return {...result,...title,rawText:result.text,signature:editTitleSignature(draft),local:true,model:config.model,promptSource:'reference-viral-title-v840',quality:{accepted:false,status:'needs-review',scope:'已解析主副标题；事实、吸引力、口播效果及原厂同模型效果仍需人工核对'},parity:{visiblePrompt:true,referenceCloudModel:false,streaming:false}};
}
module.exports={generateTitle,parseTitle};
