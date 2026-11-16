const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawn}=require('node:child_process');

function prepareAudio(command,args,signal){
  signal?.throwIfAborted();
  return new Promise((resolve,reject)=>{
    const child=spawn(command,args,{windowsHide:true});let error,stderr='';
    const stop=()=>child.kill();signal?.addEventListener('abort',stop,{once:true});if(signal?.aborted)stop();
    child.stdout.resume();child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-2000);});
    child.on('error',e=>{error=e;});
    child.on('close',code=>{signal?.removeEventListener('abort',stop);if(signal?.aborted)return reject(new Error('本地语音识别已取消'));if(error)return reject(error);if(code!==0)return reject(new Error('识别音频准备失败：'+stderr));resolve();});
  });
}

function validateResult(data,duration){
  if(typeof data?.text!=='string'||!data.text.trim()||!Array.isArray(data.segments)||!data.segments.length)throw new Error('没有识别到可用语音，请检查音轨并试听原视频');
  let previousEnd=0;
  const segments=data.segments.map(row=>{
    if(!Number.isFinite(row.start)||!Number.isFinite(row.end)||row.start<0||row.end<=row.start||row.start<previousEnd-.001||row.end>duration+.15||typeof row.text!=='string'||!row.text.trim())throw new Error('本地识别返回无效时间轴，未写入字幕');
    previousEnd=row.end;const end=Math.min(row.end,duration);
    if(end<=row.start)throw new Error('本地识别字幕超出音视频时长');
    const words=require('./caption-recognition.mjs').validatedWords(row,duration);
    return {start:row.start,end,text:row.text.trim(),...(words?{words}:{})};
  });
  return {text:data.text.trim(),segments,language:data.language||'',engine:'faster-whisper',local:true};
}

// 取消后等待子进程真正退出，调用方才可清理它仍可能占用的音频。
function runWorker(python,args,ctx={},timeout=30*60*1000){
  ctx.signal?.throwIfAborted();
  return new Promise((resolve,reject)=>{
    const source=path.join(__dirname,'local-asr.py'),worker=source.includes('app.asar'+path.sep)?source.replace('app.asar'+path.sep,'app.asar.unpacked'+path.sep):source;
    const child=spawn(python,['-u',worker,...args],{windowsHide:true,env:{...process.env,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8',HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1'}});
    let pending='',stderr='',result,error,stopped=false;
    const stop=()=>{stopped=true;child.kill();};
    const timer=setTimeout(()=>{error=new Error('本地语音识别超过30分钟，已停止，请缩短媒体后重试');child.kill();},timeout);
    ctx.signal?.addEventListener('abort',stop,{once:true});
    if(ctx.signal?.aborted)stop();
    function line(text){
      if(!text.trim())return;
      try{
        const event=JSON.parse(text);
        if(event.event==='progress'&&Number.isFinite(event.value))ctx.progress?.(event.value,event.message);
        else if(event.event==='result')result=event.data;
        else if(event.event==='error')error=new Error('本地语音识别失败：'+event.message);
      }catch(e){error=e;child.kill();}
    }
    child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
    child.stdout.on('data',chunk=>{pending+=chunk;const lines=pending.split(/\r?\n/);pending=lines.pop();for(const value of lines)line(value);if(pending.length>16*1024*1024){error=new Error('本地识别输出超过限制');child.kill();}});
    child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-3000);});
    child.on('error',e=>{error=new Error(e.code==='ENOENT'?'未找到配置的Python解释器':'本地识别进程无法启动：'+e.message);});
    child.on('close',code=>{
      clearTimeout(timer);ctx.signal?.removeEventListener('abort',stop);if(pending)line(pending);
      if(stopped||ctx.signal?.aborted)return reject(new Error('本地语音识别已取消'));
      if(error)return reject(error);
      if(code!==0||!result)return reject(new Error('本地识别进程失败（退出码'+code+'）：'+stderr));
      resolve(result);
    });
  });
}

class LocalAsr{
  constructor(store,media){this.store=store;this.media=media;this.running=false;}
  options(){
    const config=this.store.data.settings.provider,python=config.asrPythonPath?.trim(),model=config.asrModelPath?.trim(),language=config.asrLanguage||'zh';
    if(!python||!path.isAbsolute(python)||!fs.existsSync(python)||!fs.statSync(python).isFile())throw new Error('请配置已有Python解释器的完整路径');
    if(!model||!path.isAbsolute(model))throw new Error('请配置已有Whisper模型目录的完整路径');
    for(const file of ['model.bin','config.json','tokenizer.json'])if(!fs.existsSync(path.join(model,file)))throw new Error('本地Whisper模型缺少 '+file+'；不会自动下载');
    if(!['zh','auto','en'].includes(language))throw new Error('本地识别语言无效');
    return {python,args:['--model',model,'--language',language]};
  }
  async check(ctx={}){return this.exclusive(async()=>{const {python,args}=this.options();return runWorker(python,[...args,'--check'],ctx);});}
  async exclusive(work){if(this.running)throw new Error('本地语音识别正在运行，请先结束或停止当前识别');this.running=true;try{return await work();}finally{this.running=false;}}
  async transcribe(assetId,ctx={}){
    return this.exclusive(async()=>{
      const {python,args}=this.options(),asset=this.store.asset(assetId);
      if(!['audio','video'].includes(asset.type))throw new Error('请选择音频或视频文件进行语音识别');
      ctx.signal?.throwIfAborted();
      const info=await this.media.probe(asset.path),audio=info.streams.find(s=>s.codec_type==='audio');
      if(!audio)throw new Error('所选文件没有音轨，无法识别语音');
      const duration=Number(info.format.duration);
      if(!Number.isFinite(duration)||duration<=0)throw new Error('无法读取音视频的有效时长');
      ctx.signal?.throwIfAborted();
      const directory=fs.mkdtempSync(path.join(os.tmpdir(),'superip-asr-')),input=path.join(directory,'audio.wav');
      try{
        ctx.progress?.(4,'正在准备本地识别音频');
        await prepareAudio(this.media.binaries().ffmpeg,['-v','error','-y','-i',asset.path,'-map','0:a:0','-vn','-ac','1','-ar','16000','-c:a','pcm_s16le',input],ctx.signal);
        const data=await runWorker(python,[...args,'--input',input],ctx);
        ctx.signal?.throwIfAborted();
        return {...validateResult(data,duration),sourceAssetId:assetId,duration};
      }finally{fs.rmSync(directory,{recursive:true,force:true});}
    });
  }
}
module.exports={LocalAsr,validateResult,runWorker};
