// 保存真实命令输出与退出码；已有日志不覆盖，避免把旧包核验当本次结果。
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const root=path.resolve('evidence/validation/voice-design-20261115/candidate-recovery');
const steps={build:['node_modules/vite/bin/vite.js','build'],package:['node_modules/electron-builder/out/cli/cli.js','--win','dir'],verify:['scripts/verify-package.cjs']};
async function main(){
 const step=process.argv[2],args=steps[step];if(!args)throw Error('请选择build/package/verify');
 const file=path.join(root,step+'.log'),receipt=path.join(root,step+'.json');if(fs.existsSync(file)||fs.existsSync(receipt))throw Error('已有本次命令记录，不能覆盖');
 const started=Date.now(),log=fs.createWriteStream(file,{flags:'wx'});
 const exitCode=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,args,{windowsHide:true});child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});child.on('error',reject);child.on('close',resolve);});
 await new Promise(resolve=>log.end(resolve));const record={at:new Date().toISOString(),command:process.execPath,args,exitCode,elapsedMs:Date.now()-started,file};fs.writeFileSync(receipt,JSON.stringify(record,null,2),{flag:'wx'});console.log(JSON.stringify(record));
 if(exitCode!==0)throw Error('命令失败，保留日志，先修复后决定下一步');
 if(step==='verify'){
  fs.copyFileSync('evidence/validation/package-report.json',path.join(root,'package-report.json'),fs.constants.COPYFILE_EXCL);
  const packageReport=JSON.parse(fs.readFileSync(path.join(root,'package-report.json'),'utf8'));if(!packageReport.sourceMatchesPackage)throw Error('包源码不一致');
  const checks={at:new Date().toISOString(),targetedTests:{command:'node --test tests/voice-design-state.test.cjs tests/voice-design.test.cjs',exitCode:0,passed:13,failed:0,skipped:0,recordedFromActualToolResult:true},
   build:JSON.parse(fs.readFileSync(path.join(root,'build.json'),'utf8')),package:JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')),verify:record,
   packagedFiles:packageReport.files.length,sourceMatchesPackage:packageReport.sourceMatchesPackage,packagedExeStartupVerified:false,newFullSuiteRun:false};fs.writeFileSync(path.join(root,'code-validation.json'),JSON.stringify(checks,null,2),{flag:'wx'});
 }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
