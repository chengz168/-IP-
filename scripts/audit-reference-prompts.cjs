const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),asar=require('@electron/asar'),parser=require('@babel/parser');
// 只读扫描客户端静态中文提示词候选，不执行客户端，也不扫描或导出认证配置。
const root=path.resolve('evidence/reference/prompt-audit');fs.mkdirSync(root,{recursive:true});
const source='F:/Software/轻语IP智能体/aigc-human/resources/app.asar';
const files=asar.listPackage(source).filter(file=>/\.js$/.test(file)&&!file.includes('node_modules')&&!file.includes('chunk-vendors'));
const candidates=[],failures=[],scanned=[];
for(const file of files){
 const code=asar.extractFile(source,file.replace(/^[\\/]/,'')).toString('utf8');
 try{
  const ast=parser.parse(code,{sourceType:'unambiguous'});let strings=0;
  function visit(node){
   if(!node||typeof node!=='object')return;
   if(node.type==='StringLiteral'||node.type==='TemplateElement'){
    const value=node.type==='StringLiteral'?node.value:(node.value.cooked||node.value.raw);strings++;
    if(value.length>=65&&/[\u4e00-\u9fff]/.test(value)&&/提示词|你是.{0,20}(助手|专家|文案)|写作要求|请.{0,30}(生成|分析|改写)|仅.{0,8}(JSON|json)|口播文案/.test(value)&&!/Bearer\s|api[_-]?key\s*[:=]/i.test(value))candidates.push({file,start:node.start,length:value.length,sha256:crypto.createHash('sha256').update(value).digest('hex'),text:value,classification:'客户端静态字符串候选，调用与动态拼接未确认'});
   }
   for(const value of Object.values(node))if(Array.isArray(value))value.forEach(visit);else if(value&&typeof value==='object')visit(value);
  }
  visit(ast);scanned.push({file,bytes:Buffer.byteLength(code),strings});
 }catch(error){failures.push({file,error:error.message});}
}
const visible=[['copy-default.txt',577],['title-visible.txt',57]].map(([name,displayedLength])=>{const raw=fs.readFileSync(path.join(root,name),'utf8'),normalized=raw.replace(/\r\n/g,'\n');return {file:name,rawLength:raw.length,normalizedLength:normalized.length,displayedLength,displayLengthMatches:normalized.length===displayedLength,sha256:crypto.createHash('sha256').update(raw).digest('hex'),normalizedSha256:crypto.createHash('sha256').update(normalized).digest('hex'),source:'原软件当前可见字段完整复制',isCompleteCloudRequest:false};});
const tutorial=[];
for(const key of ['rewrite','voice','avatar']){const file=path.resolve('evidence/tutorial/audio-study/'+key+'-whisper.json'),data=JSON.parse(fs.readFileSync(file,'utf8'));tutorial.push({key,file,scope:data.scope,segments:data.segments.filter(segment=>/提示词|模型|配音|声音|音频|情绪|口型|视频生成/.test(segment.text))});}
fs.writeFileSync(path.join(root,'static-candidates.json'),JSON.stringify({checkedAt:new Date().toISOString(),source,executedReferenceCode:false,scanned,failures,candidates},null,2));
fs.writeFileSync(path.join(root,'visible-prompts.json'),JSON.stringify(visible,null,2));
fs.writeFileSync(path.join(root,'tutorial-locations.json'),JSON.stringify(tutorial,null,2));
console.log(JSON.stringify({files:scanned.length,failures,candidateCount:candidates.length,visible,tutorial: tutorial.map(item=>({key:item.key,segments:item.segments.length})),candidates:candidates.map(item=>({file:item.file,length:item.length,preview:item.text.slice(0,105)}))},null,2));
