const fs=require('node:fs'),path=require('node:path');
const root=path.resolve('evidence/research/generation-chain-20261115/comfy-h3');
async function main(){
 const base='http://127.0.0.1:8188';
 const response=await fetch(base+'/system_stats',{signal:AbortSignal.timeout(5000)});
 if(!response.ok)throw Error('ComfyUI 状态返回 '+response.status);
 const stats=await response.json();fs.writeFileSync(path.join(root,'system-stats.json'),JSON.stringify(stats,null,2));
 const info=await (await fetch(base+'/object_info',{signal:AbortSignal.timeout(20000)})).json();
 fs.writeFileSync(path.join(root,'object-info.json'),JSON.stringify(info,null,2));
 const names=['UNETLoader','CLIPLoader','VAELoader','MiniMaxH3ImageToVideo','MiniMaxH3ReferenceToVideo','MiniMaxH3AddGuide','LoraLoaderModelOnly','BasicGuider','SamplerCustomAdvanced','KSamplerSelect','BasicScheduler','RandomNoise','VAEDecode','VAEDecodeAudio','CreateVideo','SaveVideo','LoadAudio','LoadImage'];
 for(const name of names)console.log(JSON.stringify({name,exists:!!info[name],input:info[name]?.input,outputs:info[name]?.output}));
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
