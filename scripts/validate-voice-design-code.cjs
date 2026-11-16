// 验证真实退出码并保留原输出；本收据不替代音频或画面质量验收。
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const root=path.resolve('evidence/validation/voice-design-20261115/code-validation');fs.mkdirSync(root,{recursive:true});
async function run(name,command,args){
 const file=path.join(root,name+'.log');if(fs.existsSync(file))throw Error('已有验证输出，不能覆盖：'+file);
 const started=Date.now(),log=fs.createWriteStream(file,{flags:'wx'});
 const code=await new Promise((resolve,reject)=>{const child=spawn(command,args,{windowsHide:true,env:{...process.env,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8'}});child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});child.on('error',reject);child.on('close',resolve);});
 await new Promise(resolve=>log.end(resolve));const result={name,command,args,exitCode:code,elapsedMs:Date.now()-started,file};fs.writeFileSync(path.join(root,name+'.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));if(code!==0)throw Error(name+'验证失败，请查看真实日志');
}
async function main(){
 if(process.argv.includes('--supplemental-media')){
  const data=JSON.parse(fs.readFileSync('evidence/validation/musetalk-integration-20261115/workspace/studio.json','utf8'));
  const {Media}=require('../server/media.cjs'),binaries=new Media({data}).binaries();
  process.env.FFMPEG_PATH=binaries.ffmpeg;process.env.FFPROBE_PATH=binaries.ffprobe;
  process.env.PATH=path.dirname(binaries.ffmpeg)+path.delimiter+process.env.PATH;
  process.env.LINK_PYTHON=data.settings.provider.extractPythonPath||'C:/Python314/python.exe';process.env.YTDLP_PACKAGE=data.settings.provider.extractPackagePath||'D:/AI-Runtimes/super-ip/link-extractor/2026.10.26/package';
  for(const file of [binaries.ffmpeg,binaries.ffprobe,process.env.LINK_PYTHON,path.join(process.env.YTDLP_PACKAGE,'yt_dlp','__main__.py')])if(!fs.existsSync(file))throw Error('补测所需工具不存在：'+file);
  return run('supplemental-media',process.execPath,['--test','tests/comfy-h3-mux.test.cjs','tests/local-link-extractor.test.cjs','tests/musetalk-input.test.cjs']);
 }
 const tests=fs.readdirSync('tests').filter(file=>file.endsWith('.test.cjs')).map(file=>path.join('tests',file));
 await run('node-tests',process.execPath,['--test',...tests]);
 await run('python-tests','python',['-m','unittest','discover','-s','tests','-p','voice_design_worker_test.py','-v']);
 await run('build',process.execPath,['node_modules/vite/bin/vite.js','build']);
 await run('package',process.execPath,['node_modules/electron-builder/out/cli/cli.js','--win','dir']);
 await run('package-verification',process.execPath,['scripts/verify-package.cjs']);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
