const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {Providers}=require('../server/providers.cjs'),{generateAuxiliary}=require('../server/subtitle-auxiliary.cjs');
async function main(){
 const root=path.resolve('evidence/validation/subtitle-color-bilingual-runtime'),output=path.join(root,'local-translation.json');assert.ok(!fs.existsSync(output),'已有模型结果，拒绝重复调用');
 const referenceRoot=path.resolve('evidence/validation/subtitle-template-runtime/reference/templates/subtitle'),prompts=[];
 for(const id of ['black_white_bilingual','yellow_white_bilingual','red_white_bilingual']){
  const file=path.join(referenceRoot,'template_'+id+'.js.readable.cjs'),source=fs.readFileSync(file,'utf8'),match=source.match(/`(\\u4F60[\s\S]*?)`\s*\+/);assert.ok(match,'缺少静态提示词');
  const user=match[1].replace(/\\u([0-9a-f]{4})/gi,(_,hex)=>String.fromCharCode(parseInt(hex,16)));prompts.push({templateId:id,file,sha256:crypto.createHash('sha256').update(source).digest('hex'),system:'You are a professional subtitle translator. Output translations line by line with index numbers.',user,modelLiteral:'deepseek-v3-2-251201',temperature:.7,mainCallVerified:false});
 }
 assert.ok(prompts.every(p=>p.user===prompts[0].user));fs.writeFileSync(path.join(root,'reference-translation-prompts.json'),JSON.stringify(prompts,null,2));
 const settings=JSON.parse(fs.readFileSync(path.join(root,'workspace-before.json'),'utf8')).settings,store={data:{settings}},providers=new Providers(store,null,{get:async()=>''}),requests=[];
 const original=providers.text.bind(providers);providers.text=async(system,user,ctx,options)=>{const record={system,user,schema:options?.schema};requests.push(record);const result=await original(system,user,ctx,options);record.result=result;return result;};
 const texts=['重点来了','请认真核对每一步','保留所有原始内容，不要删减'],draft={id:'local-bilingual-verification',video:{assetId:''},edit:{subtitleLanguage:'英语',captions:texts.map((text,i)=>({start:i,end:i+1,text}))}};
 const startedAt=new Date().toISOString();let report;
 try{const result=await generateAuxiliary(providers,draft,'translation',{signal:AbortSignal.timeout(150000)});assert.equal(result.rows.length,texts.length);assert.ok(result.rows.every((r,i)=>r.auxiliary.sourceText===texts[i]));report={startedAt,endedAt:new Date().toISOString(),success:true,requests,result,referencePromptContentOnly:true,sameModelAsVendor:false,qualityAccepted:false};}
 catch(error){report={startedAt,endedAt:new Date().toISOString(),success:false,requests,error:error.message,qualityAccepted:false};process.exitCode=1;}
 fs.writeFileSync(output,JSON.stringify(report,null,2));console.log(JSON.stringify({success:report.success,model:settings.provider.model,requests:requests.length,error:report.error}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
