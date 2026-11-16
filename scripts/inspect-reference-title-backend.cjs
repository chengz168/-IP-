const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const parser=require('@babel/parser'),{transformSync}=require('esbuild');
// 只对白名单表达式做静态求值，不运行原厂模块或原厂混淆引导程序。
const requested=process.argv[2]?path.resolve(process.argv[2]):null,root=requested?path.dirname(requested):path.resolve('evidence/validation/title-template-layout/reference-backend');
function walk(node,visit){if(!node||typeof node!=='object')return;visit(node);for(const [key,value] of Object.entries(node)){if(['loc','start','end','extra'].includes(key))continue;if(Array.isArray(value))value.forEach(n=>walk(n,visit));else if(value&&typeof value==='object')walk(value,visit);}}
function decode(source){
 const ast=parser.parse(source,{sourceType:'unambiguous'}),functions=ast.program.body.filter(n=>n.type==='FunctionDeclaration');
 let factory,strings;
 for(const fn of functions)walk(fn,n=>{if(n.type==='ArrayExpression'&&n.elements.length>5&&n.elements.every(e=>e?.type==='StringLiteral')){assert.ok(!factory,'发现多个字符串表');factory=fn;strings=n.elements.map(e=>e.value);}});
 if(!factory)return {text:source,replaced:0,unobfuscated:true};
 const decoder=functions.find(fn=>fn!==factory&&fn.body.body.some(n=>n.type==='ExpressionStatement'&&n.expression.type==='AssignmentExpression'&&n.expression.right.type==='BinaryExpression'&&n.expression.right.operator==='-'));
 assert.ok(decoder,'未找到解码偏移');
 const subtraction=decoder.body.body.find(n=>n.type==='ExpressionStatement'&&n.expression.type==='AssignmentExpression'&&n.expression.right.type==='BinaryExpression'&&n.expression.right.operator==='-').expression.right;
 assert.equal(subtraction.right.type,'NumericLiteral');const offset=subtraction.right.value,aliases=new Set([decoder.id.name]);
 for(let i=0;i<8;i++)walk(ast,n=>{if(n.type==='VariableDeclarator'&&n.init?.type==='Identifier'&&aliases.has(n.init.name))aliases.add(n.id.name);});
 const rotationStatement=ast.program.body.find(n=>n.type==='ExpressionStatement'&&n.expression.type==='CallExpression'&&n.expression.callee.type==='FunctionExpression'&&n.expression.arguments[0]?.name===factory.id.name);
 assert.ok(rotationStatement,'未找到字符串表旋转校验');const target=rotationStatement.expression.arguments[1].value;
 let checksum;walk(rotationStatement.expression.callee,n=>{if(n.type==='TryStatement'){checksum=n.block.body.find(s=>s.type==='VariableDeclaration')?.declarations[0].init;}});assert.ok(checksum);
 let rotation=0;
 function evaluate(n){
  if(n.type==='NumericLiteral'||n.type==='StringLiteral')return n.value;
  if(n.type==='UnaryExpression'){const a=evaluate(n.argument);if(n.operator==='-')return -a;if(n.operator==='+')return +a;}
  if(n.type==='BinaryExpression'){const a=evaluate(n.left),b=evaluate(n.right);switch(n.operator){case '+':return a+b;case '-':return a-b;case '*':return a*b;case '/':return a/b;case '%':return a%b;}}
  if(n.type==='CallExpression'&&n.callee.type==='Identifier'){
   if(n.callee.name==='parseInt')return parseInt(evaluate(n.arguments[0]),n.arguments[1]?evaluate(n.arguments[1]):undefined);
   if(aliases.has(n.callee.name)){const index=evaluate(n.arguments[0])-offset;assert.ok(index>=0&&index<strings.length,'解码索引越界');return strings[(index+rotation)%strings.length];}
  }
  throw new Error('不在静态白名单内：'+n.type);
 }
 for(;rotation<strings.length;rotation++)if(evaluate(checksum)===target)break;
 assert.ok(rotation<strings.length,'旋转校验未匹配');let replaced=0;const edits=[];
 for(const statement of ast.program.body)if(![factory,decoder,rotationStatement].includes(statement))walk(statement,n=>{if(n.type==='CallExpression'&&aliases.has(n.callee?.name)&&n.arguments.length===1){const value=evaluate(n);assert.equal(typeof value,'string');edits.push({start:n.start,end:n.end,text:JSON.stringify(value)});replaced++;}});
 for(const n of [factory,decoder,rotationStatement])edits.push({start:n.start,end:n.end,text:''});
 let decoded=source;for(const edit of edits.sort((a,b)=>b.start-a.start))decoded=decoded.slice(0,edit.start)+edit.text+decoded.slice(edit.end);
 return {text:transformSync(decoded,{loader:'js',minify:false,legalComments:'none'}).code,replaced,rotation,offset,checksum:target};
}
const report={parsedWithoutExecution:true,files:[]};
for(const name of requested?[path.basename(requested)]:fs.readdirSync(root).filter(n=>n.endsWith('.js'))){const source=fs.readFileSync(path.join(root,name),'utf8'),result=decode(source);fs.writeFileSync(path.join(root,name+'.readable.cjs'),result.text);report.files.push({file:name,sha256:crypto.createHash('sha256').update(source).digest('hex'),...result,text:undefined});}
fs.writeFileSync(path.join(root,'decode-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
