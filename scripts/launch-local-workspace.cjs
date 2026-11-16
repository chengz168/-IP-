// 日常入口只读取已初始化工作区，不读取验收目录或重新导入用户数据。
const fs=require('node:fs'),path=require('node:path'),{spawn,execFileSync}=require('node:child_process');
const {inspectWorkspace}=require('../server/local-workspace.cjs');
const root=path.resolve(__dirname,'..');
async function main(){
 const argument=process.argv.find(value=>value.startsWith('--workspace='));
 const workspace=argument?argument.slice(12):path.join(root,'workspaces/local-studio');
 inspectWorkspace(workspace);
 if(!fs.existsSync(path.join(root,'dist/index.html')))throw Error('缺少界面构建文件，请先运行 npm run build');
 const electron=require('electron'),args=[path.join(__dirname,'local-workspace-entry.cjs'),'--studio-data-dir='+workspace];
 const serviceLock=path.join(workspace,'active-service.lock');
 if(process.platform==='win32'&&fs.existsSync(serviceLock)){
  const owner=JSON.parse(fs.readFileSync(serviceLock,'utf8'));if(!Number.isInteger(owner.pid)||owner.pid<=0)throw Error('已有会话锁无效，未启动第二个工作台');
  let alive=true;try{process.kill(owner.pid,0)}catch(error){if(error.code==='ESRCH')alive=false;else throw error}
  if(alive){
   // 先核对进程可执行文件和工作区参数，再请求唤起，避免重复创建Electron进程。
   const script=`$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false)
$taskPid=[int]$env:STUDIO_SESSION_PID
$taskProcess=Get-CimInstance Win32_Process -Filter ('ProcessId='+$taskPid)
if(-not $taskProcess){throw '已有会话刚刚退出，请重新打开'}
if(-not [string]::Equals($taskProcess.ExecutablePath,$env:STUDIO_SESSION_EXE,[System.StringComparison]::OrdinalIgnoreCase)){throw '会话进程身份不匹配，未打开其他进程'}
if($taskProcess.CommandLine.IndexOf($env:STUDIO_SESSION_ENTRY,[System.StringComparison]::OrdinalIgnoreCase) -lt 0 -or $taskProcess.CommandLine.IndexOf('--studio-data-dir='+$env:STUDIO_SESSION_WORKSPACE,[System.StringComparison]::OrdinalIgnoreCase) -lt 0){throw '会话工作区身份不匹配'}
$taskWindow=Get-Process -Id $taskPid
$taskForeground=$false
if($taskWindow.MainWindowHandle -ne [IntPtr]::Zero){
 Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class LocalStudioWindow { [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h); [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr h,int c); [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h); }'
 if([LocalStudioWindow]::IsIconic($taskWindow.MainWindowHandle)){[LocalStudioWindow]::ShowWindowAsync($taskWindow.MainWindowHandle,9)|Out-Null}
 $taskForeground=[LocalStudioWindow]::SetForegroundWindow($taskWindow.MainWindowHandle)
}
@{pid=$taskPid;existingInstance=$true;foregroundRequested=($taskWindow.MainWindowHandle -ne [IntPtr]::Zero);foregroundResult=$taskForeground} | ConvertTo-Json -Compress`;
   const focused=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-Command',script],{windowsHide:true,encoding:'utf8',env:{...process.env,STUDIO_SESSION_PID:String(owner.pid),STUDIO_SESSION_EXE:electron,STUDIO_SESSION_ENTRY:args[0],STUDIO_SESSION_WORKSPACE:workspace}}));
   const record={at:new Date().toISOString(),...focused,workspace,newProcessStarted:false};
   fs.appendFileSync(path.join(workspace,'launch-history.jsonl'),JSON.stringify(record)+'\n');console.log(JSON.stringify(record));return;
  }
 }
 const verification=process.argv.find(value=>value.startsWith('--verify-port='));
 if(verification){const port=Number(verification.slice(14));if(!Number.isInteger(port)||port<1024||port>65535)throw Error('验证端口无效');args.push('--remote-debugging-address=127.0.0.1','--remote-debugging-port='+port)}
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.STUDIO_DEV_URL;
 // 通过桌面 Explorer 启动，避免继承开发工具的管理员权限而失去文件拖放。
 const normalLaunch=process.platform==='win32'?JSON.parse(execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'windows-normal-launch.ps1')],{windowsHide:true,encoding:'utf8',env:{...env,STUDIO_NORMAL_EXE:electron,STUDIO_NORMAL_ARGS:JSON.stringify(args),STUDIO_NORMAL_CWD:root}})):null;
 if(normalLaunch?.launchedViaExplorer){
  const record={at:new Date().toISOString(),pid:normalLaunch.pid,workspace,verificationPort:verification?Number(verification.slice(14)):null,sourceElectron:true,packagedExeStarted:false,launchedViaExplorer:true};
  fs.appendFileSync(path.join(workspace,'launch-history.jsonl'),JSON.stringify(record)+'\n');console.log(JSON.stringify(record));return;
 }
 const log=fs.openSync(path.join(workspace,'launcher.log'),'a');
 let child;
 try{
  child=spawn(electron,args,{cwd:root,env,windowsHide:true,detached:true,stdio:['ignore',log,log]});
  await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject)});
 }finally{fs.closeSync(log)}
 const record={at:new Date().toISOString(),pid:child.pid,workspace,verificationPort:verification?Number(verification.slice(14)):null,sourceElectron:true,packagedExeStarted:false};
 fs.appendFileSync(path.join(workspace,'launch-history.jsonl'),JSON.stringify(record)+'\n');
 child.unref();console.log(JSON.stringify(record));
}
main().catch(error=>{console.error('启动失败：'+error.message);process.exitCode=1});
