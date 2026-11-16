const fs=require('node:fs');
const path=require('node:path');
// 只改CSS界面字号声明，封面Canvas和媒体字幕参数不参与转换。
const exact={11:'micro',12:'micro',13:'meta',14:'caption',15:'secondary',16:'body',18:'card-title',22:'section-title',28:'page-title'};
const files=['style.css','legacy.css','resources.css','layout.css','task-center.css'];
const report=[];
for(const name of files){
  const file=path.join(__dirname,'../src',name);let count=0;
  const before=fs.readFileSync(file,'utf8');
  let after=before.replace(/([^{}]+)\{([^{}]+)\}/g,(rule,selector,body)=>{
    if(/mini-cover/.test(selector))return rule;
    return selector+'{'+body.replace(/font-size:\s*(\d+(?:\.\d+)?)px/g,(declaration,value)=>{
      const size=Number(value);if(size<11||size>44)return declaration;count++;
      if(exact[size])return 'font-size:var(--app-font-size-'+exact[size]+')';
      const base=size<20?18:size<24?22:28,token=base===18?'card-title':base===22?'section-title':'page-title',offset=size-base;
      return 'font-size:calc(var(--app-font-size-'+token+') '+(offset<0?'-':'+')+' '+Math.abs(offset)+'px)';
    })+'}';
  });
  after=after.replace(/\.app\[data-size=large\]\{font-size:[^}]+\}/g,'');
  if(after!==before)fs.writeFileSync(file,after);report.push({file:name,declarations:count});
}
console.log(JSON.stringify(report,null,2));
