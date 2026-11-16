const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {toCustomAss}=require('./custom-subtitles.cjs');
const {runProcess}=require('./media.cjs');
const {readPreviewBackground}=require('./preview-background.cjs');
const filterPath=p=>p.replace(/\\/g,'/').replace(/:/g,'\\:').replace(/'/g,"'\\''");
class SubtitlePreview{
  constructor(media,fonts){this.media=media;this.fonts=fonts;this.busy=false;}
  async validate(style){const {validateSubtitleStyle}=await import('./subtitle-style.mjs');const normalized=validateSubtitleStyle(style);this.fonts.resolve(normalized);return normalized;}
  async render(style){
    if(this.busy)throw new Error('字幕预览正在生成，请稍后重试');this.busy=true;let temp;
    try{
      const s=await this.validate(style),font=this.fonts.resolve(s),portrait=s.referenceHeight===1920,w=portrait?1080:1920,h=portrait?1920:1080;
      temp=fs.mkdtempSync(path.join(os.tmpdir(),'superip-subtitle-'));const fontsDir=path.join(temp,'fonts');fs.mkdirSync(fontsDir);fs.copyFileSync(font.file,path.join(fontsDir,path.basename(font.file)));
      const ass=path.join(temp,'preview.ass'),out=path.join(temp,'preview.png');fs.writeFileSync(ass,await toCustomAss([{start:0,end:2,text:'这个神仙锅刷'}],w,h,s));
      // 外部FFmpeg不能直接读取asar虚拟路径，预览图片与字体一同暂存到真实目录。
      const image=path.join(temp,'source.png');fs.writeFileSync(image,readPreviewBackground(s.referenceHeight));
      await runProcess(this.media.binaries().ffmpeg,['-y','-v','error','-i',image,'-vf',`subtitles=filename='${filterPath(ass)}':fontsdir='${filterPath(fontsDir)}'`,'-frames:v','1','-update','1',out],{signal:AbortSignal.timeout(15000)});
      return {dataUrl:'data:image/png;base64,'+fs.readFileSync(out).toString('base64'),style:s,width:w,height:h};
    }finally{if(temp)fs.rmSync(temp,{recursive:true,force:true});this.busy=false;}
  }
}
module.exports={SubtitlePreview};
