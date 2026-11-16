// 只解出上一批已核验的自身前端，供同一源码后端加载对照；不启动打包EXE。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),asar=require('@electron/asar');
const archive=path.resolve('release/win-unpacked/resources/app.asar'),root=path.resolve('evidence/validation/cover-viewport-20261116/baseline-renderer'),receipt=path.resolve('evidence/validation/cover-viewport-20261116/baseline-renderer.json');
assert(!fs.existsSync(receipt),'已有旧前端收据，不重复提取');const expected=JSON.parse(fs.readFileSync('evidence/validation/local-account-connection-20261116/package-report.json','utf8')),files=[];
for(const file of asar.listPackage(archive).map(f=>f.replace(/^[\\/]+/,'')).filter(f=>/^dist[\\/]/.test(f))){
 const prior=expected.files.find(f=>path.normalize(f.file)===path.normalize(file));if(!prior)continue;const bytes=asar.extractFile(archive,file),sha256=crypto.createHash('sha256').update(bytes).digest('hex');assert.equal(sha256,prior.sha256);const target=path.join(root,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes,{flag:'wx'});files.push({file:target,sha256});
}
assert(files.some(f=>f.file===path.join(root,'dist/index.html')));fs.writeFileSync(receipt,JSON.stringify({at:new Date().toISOString(),archive,verifiedAgainst:'local-account-connection-20261116/package-report.json',files,packagedExeExecuted:false},null,2),{flag:'wx'});console.log(JSON.stringify({files:files.length,root,packagedExeExecuted:false}));
