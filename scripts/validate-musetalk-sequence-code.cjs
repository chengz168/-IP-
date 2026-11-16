// 每个验证动作只执行一次并保存原始输出；媒体工具取自现有隔离配置。
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process'),assert=require('node:assert/strict');
const root=path.resolve('evidence/validation/musetalk-multi-20261115');fs.mkdirSync(root,{recursive:true});
const mode=process.argv[2],revision=process.argv[3]||'';assert(/^[a-z0-9-]*$/.test(revision));const label=mode+(revision?'-'+revision:''),file=path.join(root,label+'-code.json');assert(!fs.existsSync(file),'已有本项验证收据，请先检查旧结果');
const config=JSON.parse(fs.readFileSync('evidence/validation/musetalk-integration-20261115/workspace/studio.json','utf8')).settings;
const options={tests:[process.execPath,['--test',...fs.readdirSync('tests').filter(name=>name.endsWith('.test.cjs')).map(name=>'tests/'+name)]],build:[process.execPath,['node_modules/vite/bin/vite.js','build']],package:[process.execPath,['node_modules/electron-builder/cli.js','--win','dir']],verify:[process.execPath,['scripts/verify-package.cjs']]};
assert(options[mode],'未知验证动作');const [command,args]=options[mode],started=Date.now();
const out=fs.openSync(path.join(root,label+'-stdout.log'),'wx'),err=fs.openSync(path.join(root,label+'-stderr.log'),'wx');
const child=spawn(command,args,{windowsHide:true,stdio:['ignore',out,err],env:{...process.env,FFMPEG_PATH:config.ffmpegPath,FFPROBE_PATH:config.ffprobePath}});
child.on('error',error=>{console.error(error);process.exitCode=1;});
child.on('close',(code,signal)=>{fs.closeSync(out);fs.closeSync(err);const receipt={at:new Date().toISOString(),mode,command,args,exitCode:code,signal,elapsedSeconds:(Date.now()-started)/1000};fs.writeFileSync(file,JSON.stringify(receipt,null,2),{flag:'wx'});console.log(JSON.stringify(receipt));if(code!==0)process.exitCode=1;});
