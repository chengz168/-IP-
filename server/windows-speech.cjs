const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {runProcess}=require('./media.cjs');

const listScript=`$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Add-Type -AssemblyName System.Speech; $speaker=New-Object System.Speech.Synthesis.SpeechSynthesizer; try { $voices=@($speaker.GetInstalledVoices() | Where-Object { $_.Enabled } | ForEach-Object { @{name=$_.VoiceInfo.Name;culture=$_.VoiceInfo.Culture.Name} }); ConvertTo-Json -InputObject $voices -Compress } finally { $speaker.Dispose() }`;
const speakScript=`$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Speech; $job=Get-Content -LiteralPath $env:SUPERIP_SPEECH_JOB -Raw -Encoding UTF8 | ConvertFrom-Json; $speaker=New-Object System.Speech.Synthesis.SpeechSynthesizer; try { $speaker.SelectVoice($job.voice); $speaker.SetOutputToWaveFile($job.output); $speaker.Speak($job.text) } finally { $speaker.Dispose() }`;
class WindowsSpeech{
  constructor(store,media){this.store=store;this.media=media;}
  async voices(ctx={}){if(process.platform!=='win32')throw new Error('系统朗读仅支持Windows');const result=await runProcess('powershell.exe',['-NoProfile','-NonInteractive','-Command',listScript],{signal:ctx.signal});return JSON.parse(result.replace(/^\uFEFF/,''));}
  async synthesize(draft,ctx={},config=structuredClone(this.store.data.settings.provider)){
    if(process.platform!=='win32')throw new Error('系统朗读仅支持Windows');
    if(draft.voice.profile)throw new Error('Windows系统朗读需使用系统音色，请先清空克隆音色选择');
    const {speechRequest,speechEvidence}=require('./speech-request.cjs'),request=speechRequest(draft,{provider:config,voices:[]});
    const {speechInput,speechDuration}=await import('./speech-config.mjs');const input=speechInput(draft,config),speed=input.speed,voice=input.systemVoice;
    if(!voice||(await this.voices()).every(v=>v.name!==voice))throw new Error('请在模型设置中选择本机实际安装的系统音色');
    const temp=path.join(this.store.outputDir(),'.speech-'+crypto.randomUUID());fs.mkdirSync(temp,{recursive:true});
    const output=path.join(this.store.outputDir(),'speech-'+crypto.randomUUID()+'.wav');
    try{
      const raw=path.join(temp,'source.wav'),job=path.join(temp,'job.json');
      // 文本只作为JSON数据读取，避免把用户文案拼接成PowerShell命令。
      fs.writeFileSync(job,JSON.stringify({voice,text:draft.finalText,output:raw}));
      await runProcess('powershell.exe',['-NoProfile','-NonInteractive','-Command',speakScript],{signal:ctx.signal,env:{...process.env,SUPERIP_SPEECH_JOB:job}});
      await runProcess(this.media.binaries().ffmpeg,['-y','-i',raw,'-af','atempo='+speed,'-c:a','pcm_s16le',output],{signal:ctx.signal});
      const probe=await this.media.probe(output),duration=speechDuration(probe);
      ctx.signal?.throwIfAborted();return this.store.addAsset(output,{origin:'windows-speech',name:'系统朗读-'+voice+'.wav',duration,speech:{engine:'windows',systemVoice:voice,speed,textLength:input.text.length,request:speechEvidence(request)}});
    }catch(error){fs.rmSync(output,{force:true});throw error;}finally{fs.rmSync(temp,{recursive:true,force:true});}
  }
}
module.exports={WindowsSpeech};
