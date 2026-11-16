const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const os=require('node:os');
const {toTemplateAss,templateOptions}=require('./template-subtitles.cjs');
const {subtitleEngineVersion,subtitlePreviewCount}=require('./subtitle-output.mjs');
const {runProcess}=require('./media.cjs');
const filterPath=p=>p.replace(/\\/g,'/').replace(/:/g,'\\:').replace(/'/g,"'\\''");

class SubtitleTemplatePreview {
  constructor(media){this.media=media;this.queue=Promise.resolve();this.pending=new Map();}
  render(id){
    const key=JSON.stringify([id,this.media.store.data.settings.subtitleFontsDir||'']);
    if(this.pending.has(key))return this.pending.get(key);
    // 缩略图顺序生成，避免22个FFmpeg进程并发占满本机。
    const job=this.queue.then(()=>this.generate(id));this.queue=job.catch(()=>{});this.pending.set(key,job);
    job.finally(()=>this.pending.delete(key)).catch(()=>{});return job;
  }
  async generate(id){
    const native=subtitleEngineVersion(id)>=2;
    const store=this.media.store,edit={subtitleTemplate:id,subtitleKeywords:false,...(native?{subtitleOffsetY:0}:{subtitleTemplateY:900})};
    const {template,font}=await templateOptions(edit,store),stat=fs.statSync(font.file);
    const key=crypto.createHash('sha256').update(JSON.stringify({template,font:font.id,mtime:stat.mtimeMs,size:stat.size,engine:7,templateEngine:subtitleEngineVersion(id)})).digest('hex');
    const cache=path.join(store.root,'.subtitle-template-cache');fs.mkdirSync(cache,{recursive:true});const file=path.join(cache,key+'.gif');
    if(fs.existsSync(file))return {dataUrl:'data:image/gif;base64,'+fs.readFileSync(file).toString('base64'),templateId:id,cached:true};
    const texts=id.endsWith('_bilingual')?['从重要的事情开始','认真做好每一步']:template.preview.length?template.preview:['认真做好每一步','现在开始'];
    const count=native?subtitlePreviewCount(id):4,duration=count*1.2;
    const rows=Array.from({length:count},(_,index)=>({start:index*1.2,end:(index+1)*1.2,text:texts[index%texts.length],auxiliary:{sourceText:texts[index%texts.length],translation:['Start with what matters.','Make every step count.'][index%2],keywords:[]}}));
    let temp;
    try{
      temp=fs.mkdtempSync(path.join(os.tmpdir(),'superip-template-'));const fonts=path.join(temp,'fonts');fs.mkdirSync(fonts);fs.copyFileSync(font.file,path.join(fonts,path.basename(font.file)));
      const result=await toTemplateAss(rows,540,960,edit,store),ass=path.join(temp,'sample.ass'),out=path.join(temp,'sample.gif');fs.writeFileSync(ass,result.ass);
      // 小样先按正式竖屏比例排字，再裁字幕区域，避免把字号缩成不可辨认的像素点。
      const crop=native?'crop=540:360:0:560,scale=225:150:flags=lanczos,pad=268:150:(ow-iw)/2:0':'crop=540:304:0:298,scale=268:150:flags=lanczos';
      const filter=`subtitles=filename='${filterPath(ass)}':fontsdir='${filterPath(fonts)}',${crop},split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer`;
      await runProcess(this.media.binaries().ffmpeg,['-y','-v','error','-f','lavfi','-i',`color=c=black:s=540x960:r=15:d=${duration}`,'-filter_complex',filter,'-loop','0',out],{signal:AbortSignal.timeout(30000)});
      fs.copyFileSync(out,file);return {dataUrl:'data:image/gif;base64,'+fs.readFileSync(file).toString('base64'),templateId:id,cached:false};
    }finally{if(temp)fs.rmSync(temp,{recursive:true,force:true});}
  }
}
module.exports={SubtitleTemplatePreview};
