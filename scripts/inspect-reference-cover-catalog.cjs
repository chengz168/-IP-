const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const asar=require('@electron/asar');
const parser=require('@babel/parser');
// 仅静态读取公开模板的标签与配置字面量，不执行原厂函数或模块。
const archive='F:/Software/轻语IP智能体/aigc-human/resources/app.asar';
const entry=asar.listPackage(archive).find(file=>file.endsWith('951.2ef9483f.js'));
const source=asar.extractFile(archive,entry.slice(1)).toString();
const ast=parser.parse(source,{sourceType:'unambiguous'});
const factory=ast.program.body.find(n=>n.type==='FunctionDeclaration'&&n.id.name==='a2_0x3a40');
const strings=factory.body.body.find(n=>n.type==='VariableDeclaration').declarations[0].init.elements.map(n=>{assert.equal(n.type,'StringLiteral');return n.value;});
const offset=0xe9,rotation=(strings.indexOf('yellow_white_split')-(0xd44-offset)+strings.length)%strings.length;
const decode=number=>strings[(number-offset+rotation)%strings.length];
const declarations=new Map();
function walk(node){if(!node||typeof node!=='object')return;if(node.type==='VariableDeclarator'&&node.id.type==='Identifier')declarations.set(node.id.name,node.init);for(const value of Object.values(node)){if(Array.isArray(value))value.forEach(walk);else if(value&&typeof value==='object')walk(value);}}
walk(ast);
function literal(node){
  if(['StringLiteral','NumericLiteral','BooleanLiteral'].includes(node.type))return node.value;
  if(node.type==='NullLiteral')return null;
  if(node.type==='Identifier'&&['_0x15721a','_0x134a25'].includes(node.name))return literal(declarations.get(node.name));
  if(node.type==='UnaryExpression'&&['-','+','!'].includes(node.operator)){const v=literal(node.argument);return node.operator==='-'?-v:node.operator==='+'?+v:!v;}
  if(node.type==='BinaryExpression'&&['+','-','*','/'].includes(node.operator)){const a=literal(node.left),b=literal(node.right);return node.operator==='+'?a+b:node.operator==='-'?a-b:node.operator==='*'?a*b:a/b;}
  if(node.type==='ArrayExpression')return node.elements.map(literal);
  if(node.type==='ObjectExpression')return Object.fromEntries(node.properties.map(p=>{assert.equal(p.type,'ObjectProperty');assert.equal(p.computed,false);return [p.key.name||p.key.value,literal(p.value)];}));
  if(node.type==='CallExpression'&&node.callee.type==='Identifier'&&node.callee.name==='_0x3d9bc0'&&node.arguments.length===1)return decode(literal(node.arguments[0]));
  if(node.type==='CallExpression'&&node.callee.type==='Identifier'&&node.callee.name==='_0x1231c1'&&node.arguments.length===1)return {styleOverrides:literal(node.arguments[0])};
  if(node.type==='CallExpression'&&node.callee.type==='MemberExpression'&&node.callee.object.name==='Math'){const name=node.callee.computed?literal(node.callee.property):node.callee.property.name;assert.ok(['round','floor','ceil','min','max'].includes(name));return Math[name](...node.arguments.map(literal));}
  throw new Error('配置含未允许表达式：'+node.type+' '+source.slice(node.start,node.end).slice(0,120));
}
const templates=literal(declarations.get('_0x22c50b'));
assert.ok(templates.length>=10);assert.equal(new Set(templates.map(t=>t.id)).size,templates.length);
const root=path.resolve('evidence/reference/cover-editor');fs.mkdirSync(root,{recursive:true});
fs.writeFileSync(path.join(root,'catalog.json'),JSON.stringify({source:'原厂公开封面模板配置的静态字面量；styleOverrides不含原厂默认样式',parsedWithoutExecution:true,width:1080,height:1920,templates},null,2));
console.log(JSON.stringify({count:templates.length,templates:templates.map(({id,name,textLayers})=>({id,name,layers:textLayers.length}))},null,2));
