// 仅静态读取原安装包公开封面样式和换行参数，不执行原厂模块。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),asar=require('@electron/asar'),parser=require('@babel/parser');
const archive='F:/Software/轻语IP智能体/aigc-human/resources/app.asar';
const entry=asar.listPackage(archive).find(file=>file.endsWith('951.2ef9483f.js'));assert(entry);
const source=asar.extractFile(archive,entry.slice(1)).toString(),ast=parser.parse(source,{sourceType:'unambiguous'});
const factory=ast.program.body.find(n=>n.type==='FunctionDeclaration'&&n.id.name==='a2_0x3a40');
const strings=factory.body.body.find(n=>n.type==='VariableDeclaration').declarations[0].init.elements.map(n=>n.value),offset=0xe9,rotation=(strings.indexOf('yellow_white_split')-(0xd44-offset)+strings.length)%strings.length;
const decode=n=>strings[(n-offset+rotation)%strings.length],snippets=[],aliases=new Set(['_0x3d9bc0']),declarations=[];
function walk(node){
 if(!node||typeof node!=='object')return;
 if((node.type==='VariableDeclarator'&&node.id?.name==='_0x1231c1')||(node.type==='FunctionDeclaration'&&node.id?.name==='_0x1231c1'))snippets.push({kind:'style-default-helper',start:node.start,end:node.end});
 if(node.type==='VariableDeclarator'&&node.id?.type==='Identifier'&&node.init?.type==='Identifier')declarations.push([node.id.name,node.init.name]);
 for(const value of Object.values(node)){if(Array.isArray(value))value.forEach(walk);else if(value&&typeof value==='object')walk(value);}
}
walk(ast);assert(snippets.length);
for(let i=0;i<20;i++)for(const [alias,target]of declarations)if(aliases.has(target))aliases.add(alias);
const readable=source.replace(/\b(_0x[\da-f]+)\((0x[0-9a-f]+|\d+)\)/gi,(all,name,num)=>aliases.has(name)?JSON.stringify(decode(Number(num))):all);
const result={at:new Date().toISOString(),archive,entry,executedReferenceCode:false,snippets:snippets.map(s=>({...s,source:source.slice(s.start,s.end).replace(/_0x3d9bc0\((0x[0-9a-f]+|\d+)\)/gi,(_,num)=>JSON.stringify(decode(Number(num))))}))};
const root=path.resolve('evidence/validation/caption-cover-readability-20261115');fs.mkdirSync(root,{recursive:true});
const target=path.join(root,'reference-style-helper.json');if(!fs.existsSync(target))fs.writeFileSync(target,JSON.stringify(result,null,2),{flag:'wx'});
fs.writeFileSync(path.join(root,'cover-renderer-readable.js'),readable,{flag:'wx'});
const matches=[];for(const term of ['letterSpacing','wrap','getTextNode','boxWidth']){let at=-1,count=0;while((at=readable.indexOf(term,at+1))>=0&&count++<5)matches.push({term,source:readable.slice(Math.max(0,at-200),at+300)});}console.log(JSON.stringify({aliases:[...aliases],matches}));
