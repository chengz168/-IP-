const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const root=path.resolve('evidence/research/generation-chain-20261115/comfy-h3');
const comfy='D:/Comfy-Desktop/ComfyUI-Installs/test-1/ComfyUI';
const python=path.join(comfy,'.venv/Scripts/python.exe');
// 使用现有环境和模型，验证数据单独存放，不改用户的工作流、输入和输出目录。
async function main(){
 const baseUrl='http://127.0.0.1:8188';
 try{const response=await fetch(baseUrl+'/system_stats',{signal:AbortSignal.timeout(2000)});if(response.ok){console.log('已有 ComfyUI 服务在8188，保留现有进程。');return;}}catch{}
 for(const name of ['input','output','user'])fs.mkdirSync(path.join(root,name),{recursive:true});
 const log=fs.openSync(path.join(root,'comfy-startup.log'),'a');
 const args=['-u','main.py','--listen','127.0.0.1','--port','8188','--disable-auto-launch','--disable-assets','--reserve-vram','2',
  '--input-directory',path.join(root,'input'),'--output-directory',path.join(root,'output'),'--user-directory',path.join(root,'user')];
 const child=spawn(python,args,{cwd:comfy,env:{...process.env,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8'},windowsHide:true,detached:true,stdio:['ignore',log,log]});child.unref();fs.closeSync(log);
 fs.writeFileSync(path.join(root,'launch.json'),JSON.stringify({startedAt:new Date().toISOString(),pid:child.pid,python,args,baseUrl,existingModels:true,modelInferenceVerified:false},null,2));
 console.log(JSON.stringify({pid:child.pid,baseUrl,log:path.join(root,'comfy-startup.log')}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
