const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const asar=require('@electron/asar');
const parser=require('@babel/parser');

// 仅解析公开模板标签与参数字面量；不执行原软件模块或任意表达式。
const source=asar.extractFile('F:/Software/轻语IP智能体/aigc-human/resources/app.asar','electron\\renderer\\dist\\static\\js\\951.2ef9483f.js').toString();
const ast=parser.parse(source,{sourceType:'unambiguous'});
const factory=ast.program.body.find(n=>n.type==='FunctionDeclaration'&&n.id.name==='a2_0x3a40');
const strings=factory.body.body.find(n=>n.type==='VariableDeclaration').declarations[0].init.elements.map(n=>{assert.equal(n.type,'StringLiteral');return n.value;});
const offset=0xe9,rotation=(strings.indexOf('yellow_white_split')-(0xd44-offset)+strings.length)%strings.length;
const decode=number=>strings[(number-offset+rotation)%strings.length];
assert.equal(decode(0xbcf),'yellow_white_italic');assert.equal(decode(0x150),'yellow_white_calligraphy');assert.equal(decode(0x547),'simple_blue_white');
const declarations=new Map();
function walk(node){if(!node||typeof node!=='object')return;if(node.type==='VariableDeclarator'&&node.id.type==='Identifier')declarations.set(node.id.name,node.init);for(const value of Object.values(node)){if(Array.isArray(value))value.forEach(walk);else if(value&&typeof value==='object')walk(value);}}
walk(ast);
function literal(node){
  if(['StringLiteral','NumericLiteral','BooleanLiteral'].includes(node.type))return node.value;
  if(node.type==='NullLiteral')return null;
  if(node.type==='UnaryExpression'&&['-','+','!'].includes(node.operator)){const v=literal(node.argument);return node.operator==='-'?-v:node.operator==='+'?+v:!v;}
  if(node.type==='ArrayExpression')return node.elements.map(literal);
  if(node.type==='ObjectExpression')return Object.fromEntries(node.properties.map(p=>{assert.equal(p.type,'ObjectProperty');assert.equal(p.computed,false);return [p.key.name||p.key.value,literal(p.value)];}));
  if(node.type==='CallExpression'&&node.callee.type==='Identifier'&&node.callee.name==='_0x3d9bc0'&&node.arguments.length===1)return decode(literal(node.arguments[0]));
  throw new Error('元数据含未允许表达式：'+node.type);
}
const defaults=literal(declarations.get('_0x5c3fa5'));
const templates=declarations.get('_0x57f174').elements.map(call=>{assert.equal(call.type,'CallExpression');assert.equal(call.callee.name,'_0x11c8c3');const [id,name,description,preview,config={}]=call.arguments.map(literal);return {id,name,description,preview,config:{...defaults,...config}};});
assert.equal(templates.length,22);assert.equal(new Set(templates.map(t=>t.id)).size,22);
const keywordExpression=declarations.get('_0x5a95ca');
const keywordTemplates=keywordExpression?.type==='NewExpression'&&keywordExpression.callee.name==='Set'?literal(keywordExpression.arguments[0]):null;
const root=path.resolve('evidence/reference/dynamic-subtitles');fs.mkdirSync(root,{recursive:true});
const metadata={source:'原软件renderer公共模板标签/配置的静态字面量',parsedWithoutExecution:true,defaults,templates,keywordTemplates};
fs.writeFileSync(path.join(root,'catalog.json'),JSON.stringify(metadata,null,2));
console.log(JSON.stringify({file:path.join(root,'catalog.json'),count:templates.length,keywordTemplates,templates:templates.map(({id,name})=>({id,name}))},null,2));
