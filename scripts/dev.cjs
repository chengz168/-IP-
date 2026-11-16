const {spawn} = require('node:child_process');
const path=require('node:path');
const processes=[];
// 开发时同时启动本地能力服务和界面，退出时只清理本次启动的子进程。
const run=(file,args)=>{const child=spawn(file,args,{stdio:'inherit',cwd:path.join(__dirname,'..'),windowsHide:true});processes.push(child);return child;};
run(process.execPath,['server/http.cjs']);
run(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1']);
const close=()=>{for(const child of processes)child.kill();process.exit();};
process.on('SIGINT',close);process.on('SIGTERM',close);
