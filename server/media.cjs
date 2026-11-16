const fs=require('node:fs');
const path=require('node:path');
const {spawn}=require('node:child_process');
const crypto=require('node:crypto');

const runProcess=(command,args,{signal,onProgress,onStderr,env}={})=>new Promise((resolve,reject)=>{const child=spawn(command,args,{windowsHide:true,signal,env});let stdout='',stderr='';child.stdout.on('data',b=>{stdout+=b;onProgress?.(b.toString());});child.stderr.on('data',b=>{stderr=(stderr+b).slice(-12000);try{onStderr?.(b.toString());}catch(error){child.kill();reject(error);}});child.on('error',reject);child.on('close',code=>code===0?resolve(stdout):reject(new Error('媒体处理失败（退出码'+code+'）：'+stderr.slice(-2000))));});
const stamp=t=>{t=Math.max(0,Number(t));return new Date(t*1000).toISOString().slice(11,23).replace('.',',');};
const toSrt=rows=>rows.map((r,i)=>`${i+1}\n${stamp(r.start)} --> ${stamp(r.end)}\n${String(r.text).replace(/\r?\n/g,' ')}\n`).join('\n');
function parseSrt(text){return text.replace(/^\uFEFF/,'').trim().split(/\r?\n\s*\r?\n/).map(block=>{const lines=block.split(/\r?\n/);const i=lines.findIndex(l=>l.includes('-->'));if(i<0)return null;const parts=lines[i].split('-->');const seconds=s=>{const match=s.trim().match(/(\d+):(\d+):(\d+)[,.](\d+)/);if(!match)return NaN;return Number(match[1])*3600+Number(match[2])*60+Number(match[3])+Number('0.'+match[4]);};return {start:seconds(parts[0]),end:seconds(parts[1]),text:lines.slice(i+1).join('\n')};}).filter(r=>r&&Number.isFinite(r.start)&&r.end>r.start&&r.text);}
const filterPath=p=>p.replace(/\\/g,'/').replace(/:/g,'\\:').replace(/'/g,"'\\''");
function wrapTitle(text,maxUnits){const rows=[];for(const paragraph of String(text).split(/\r?\n/)){let line='',units=0;for(const ch of paragraph){const width=/[\u0000-\u007f]/.test(ch)?.6:1;if(units+width>maxUnits&&line){rows.push(line);line='';units=0;}line+=ch;units+=width;}if(line)rows.push(line);}return rows;}
const {toAss}=require('./subtitles.cjs');
class Media{
  constructor(store){this.store=store;}
  binaries(){const config=this.store.data.settings;let ffmpeg=config.ffmpegPath||process.env.FFMPEG_PATH;let ffprobe=config.ffprobePath||process.env.FFPROBE_PATH;if(!ffmpeg){try{ffmpeg=require('ffmpeg-static');}catch{ffmpeg='ffmpeg';}}if(!ffprobe){try{ffprobe=require('ffprobe-static').path;}catch{ffprobe='ffprobe';}}return {ffmpeg,ffprobe};}
  async probe(file){const {ffprobe}=this.binaries();let data;try{data=await runProcess(ffprobe,['-v','error','-show_format','-show_streams','-of','json',file]);}catch(e){if(e.code==='ENOENT')throw new Error('未找到FFprobe，请在设置中配置媒体工具路径');throw e;}const parsed=JSON.parse(data);if(!parsed.streams?.length)throw new Error('文件没有可解析的音视频流');return parsed;}
  async check(){const b=this.binaries();return {ffmpeg:(await runProcess(b.ffmpeg,['-version'])).split('\n')[0],ffprobe:(await runProcess(b.ffprobe,['-version'])).split('\n')[0]};}
  async render(draft,ctx){
    const music=await this.music?.prepare(draft,ctx),asset=await require('./render.cjs').render(this,music?.draft||draft,ctx,{runProcess,toAss,filterPath,wrapTitle});
    if(!music)return asset;
    try{music.check();asset.backgroundMusic=music.record;this.store.save();return asset;}
    catch(error){this.store.data.assets=this.store.data.assets.filter(item=>item.id!==asset.id);fs.rmSync(asset.path,{force:true});this.store.save();throw error;}
  }
  async analyzeSilence(id,edit,ctx){return require('./silence.cjs').detectSilence(this,id,edit,ctx,runProcess);}
  async frame(id,time=0,ctx={}){const source=this.store.asset(id);const out=path.join(this.store.outputDir(),'frame-'+Date.now()+'.png');await runProcess(this.binaries().ffmpeg,['-y','-ss',String(Math.max(0,Number(time)||0)),'-i',source.path,'-frames:v','1','-update','1',out],ctx);if(!fs.existsSync(out)||!fs.statSync(out).size)throw new Error('截取封面失败');return this.store.addAsset(out,{origin:'frame'});}
  async extractAudio(id,ctx){const source=this.store.asset(id);const out=path.join(this.store.outputDir(),'audio-'+Date.now()+'.wav');await runProcess(this.binaries().ffmpeg,['-y','-i',source.path,'-vn','-ac','1','-ar','16000',out],ctx);await this.probe(out);return this.store.addAsset(out,{origin:'extract-audio'});}
  async coverVideo(draft,ctx){
    const source=this.store.asset(draft.edit.resultId||draft.edit.sourceId||draft.video.assetId),cover=this.store.asset(draft.cover.assetId);
    const info=await this.probe(source.path),video=info.streams.find(s=>s.codec_type==='video'),audio=info.streams.find(s=>s.codec_type==='audio');
    if(!video||!video.width||!video.height)throw new Error('封面视频需要有效的视频源');
    if(cover.type!=='image')throw new Error('请选择已经生成的封面图片');
    const file=path.join(this.store.outputDir(),'cover-video-'+Date.now()+'.mp4'),temp=file+'.part.mp4';
    // 封面只覆盖首帧，后续帧沿用原视频时间轴；音轨不增加片头静音。
    const scale=`scale=${video.width}:${video.height}:force_original_aspect_ratio=decrease,pad=${video.width}:${video.height}:(ow-iw)/2:(oh-ih)/2,setsar=1`;
    const filters=`[1:v]${scale}[cover];[0:v][cover]overlay=0:0:enable='eq(n,0)':eof_action=pass:repeatlast=0,format=yuv420p[out]`;
    const args=['-y','-i',source.path,'-i',cover.path,'-filter_complex',filters,'-map','[out]'];
    if(audio)args.push('-map','0:a:0','-c:a',['aac','mp3'].includes(audio.codec_name)?'copy':'aac');else args.push('-an');
    args.push('-c:v','libx264','-preset','veryfast','-crf','21','-fps_mode','passthrough','-movflags','+faststart',temp);
    try{
      await runProcess(this.binaries().ffmpeg,args,{signal:ctx.signal});
      const result=await this.probe(temp),output=result.streams.find(s=>s.codec_type==='video');
      const duration=Number(result.format.duration),sourceDuration=Number(info.format.duration);
      if(!output||output.width!==video.width||output.height!==video.height||!Number.isFinite(duration)||duration<=0||Math.abs(duration-sourceDuration)>.12)throw new Error('封面视频校验失败：尺寸或时长与源视频不一致');
      if(video.nb_frames&&output.nb_frames&&Number(video.nb_frames)!==Number(output.nb_frames))throw new Error('封面视频校验失败：帧数与源视频不一致');
      fs.renameSync(temp,file);return this.store.addAsset(file,{origin:'cover-video',duration});
    }finally{fs.rmSync(temp,{force:true});}
  }
}
module.exports={Media,runProcess,toSrt,parseSrt,toAss};
