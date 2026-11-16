const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),parser=require('@babel/parser');
// 对已解码AST白名单解释声明和addStyle参数，绝不加载或执行原厂模块。
const root=path.resolve('evidence/validation/title-template-layout/reference-backend');
function extract(file,width=1920,height=1080){
 const ast=parser.parse(fs.readFileSync(path.join(root,file+'.readable.cjs'),'utf8')),cls=ast.program.body.find(n=>n.type==='ClassDeclaration'),method=cls.body.body.find(n=>n.key.value==='render'||n.key.name==='render');assert.ok(method);
 const env=new Map([[method.params[0].name,{subtitles:[],params:{},fontsDir:null,resolution:{width,height}}],[method.params[1].name,{builder:true}]]),styles=[],fonts=[];
 const name=n=>n.computed?value(n.property):n.property.name;
 function bind(pattern,v){if(pattern.type==='Identifier')env.set(pattern.name,v);else if(pattern.type==='ObjectPattern')for(const p of pattern.properties)bind(p.value,v[p.key.name||p.key.value]);else throw new Error('不支持的绑定：'+pattern.type);}
 function value(n){
  if(['NumericLiteral','StringLiteral','BooleanLiteral'].includes(n.type))return n.value;if(n.type==='NullLiteral')return null;
  if(n.type==='Identifier')return env.get(n.name);
  if(n.type==='ObjectExpression')return Object.fromEntries(n.properties.map(p=>[p.key.value||p.key.name,value(p.value)]));
  if(n.type==='AwaitExpression')return value(n.argument);
  if(n.type==='LogicalExpression'){const a=value(n.left);if(n.operator==='||')return a||value(n.right);if(n.operator==='&&')return a&&value(n.right);if(n.operator==='??')return a??value(n.right);}
  if(n.type==='UnaryExpression'){const a=value(n.argument);if(n.operator==='-')return -a;if(n.operator==='!')return !a;}
  if(n.type==='BinaryExpression'){const a=value(n.left),b=value(n.right);switch(n.operator){case '+':return a+b;case '-':return a-b;case '*':return a*b;case '/':return a/b;}}
  if(n.type==='MemberExpression')return value(n.object)?.[name(n)];
  if(n.type==='SequenceExpression'){let result;for(const e of n.expressions)result=value(e);return result;}
  if(n.type==='CallExpression'&&n.callee.type==='MemberExpression'){
   const call=n.callee,key=name(call);
   if(call.object.type==='ThisExpression'){
    if(key==='getResolution')return {width,height,centerX:width/2,centerY:height/2,isPortrait:height>width};
    if(key==='scaleValue')return Math.round(value(n.arguments[0])*(value(n.arguments[2])==='y'?height/1080:width/1920));
   }
   if(call.object.name==='fontHelper'&&key==='resolveFontFamily'){const font=value(n.arguments[0]);fonts.push(font);return font;}
   if(call.object.name==='Math'&&key==='round')return Math.round(value(n.arguments[0]));
   if(call.object.name===method.params[1].name&&key==='addStyle'){styles.push(value(n.arguments[0]));return;}
   if(key==='forEach')return;
  }
  throw new Error(file+' AST白名单外：'+n.type);
 }
 for(const statement of method.body.body){if(statement.type==='VariableDeclaration')for(const d of statement.declarations)bind(d.id,value(d.init));else if(statement.type==='ExpressionStatement')value(statement.expression);else throw new Error('不支持的声明：'+statement.type);}
 return {width,height,fonts,styles};
}
const report={source:'原安装包模板模块默认参数，编译主进程main.jsc实际调用参数尚未确认',method:'AST白名单静态解释；未执行原厂模块；fontname暂以文件名记录，实际family须由字体表解析',templates:[]};
for(const file of fs.readdirSync(root).filter(f=>/^template_.*\.js$/.test(f)))report.templates.push({id:file.replace(/^template_/,'title_').replace(/\.js$/,''),source:file,defaults:extract(file),portrait:extract(file,360,640)});
fs.writeFileSync(path.join(root,'default-contract.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report.templates.map(t=>({id:t.id,font:t.defaults.fonts,styles:t.defaults.styles.map(s=>({name:s.name,color:s.primaryColour,size:s.fontsize,y:s.marginV,bold:s.bold,italic:s.italic,stroke:s.outline,shadow:s.shadow}))})),null,2));
