const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..'),directory=path.join(root,'evidence/validation/reference-sample-20261115'),workspace=path.join(directory,'workspace');
const write=(name,data)=>fs.writeFileSync(path.join(directory,name),JSON.stringify(data,null,2));
async function main(){
 const {Store}=require('../server/store.cjs');
 const saved=JSON.parse(fs.readFileSync(path.join(workspace,'studio.json'),'utf8'));
 if(saved.runs.some(run=>run.status==='running'&&(run.type==='avatar'||!process.argv.includes('--resume'))))throw Error('原生成任务尚未完成，禁止打开第二个Store');
 if(!saved.drafts[0].video.assetId)throw Error('尚无真实新视频，未准备剪辑');
 if(!process.argv.includes('--resume')){
  if(fs.existsSync(path.join(directory,'editor-prepared.json')))throw Error('已有剪辑准备记录，必须resume');
  const store=new Store(workspace),draft=structuredClone(store.draft()),source=JSON.parse(fs.readFileSync(path.join(directory,'reference-task-content.json'),'utf8'));
  store.data.settings.subtitleFontsDir='F:/Software/轻语IP智能体/aigc-human/resources/fonts';
  const {SubtitleFonts}=require('../server/subtitle-fonts.cjs'),fonts=new SubtitleFonts(store).list();
  const subtitleFont=fonts.find(font=>font.label===source.subtitleConfig.fontFamily),titleFont=fonts.find(font=>font.label===source.viralStudioConfig.title.style.fontFamily);
  if(!subtitleFont||!titleFont)throw Error('没有与原版相同的标题或字幕字体');
  const {simplified,normalize}=require('./verify-indextts-output.cjs'),asr=JSON.parse(fs.readFileSync(path.join(directory,'driver-asr.json'),'utf8')).asr;
  const compact=value=>normalize(value).replace(/麽/g,'么');
  const words=asr.segments.flatMap(segment=>segment.words).filter(word=>word.end>word.start);
  const recognized=compact(simplified(words.map(word=>word.word).join(''))),script=source.voiceRewriteSourceContent||source.rewrittenContent;
  if(!compact(script).startsWith(recognized))throw Error('实际识别与原文前缀不一致，不能直接套原稿字幕');
  // 断句使用已识别词的真实边界，仅规范简繁和“麽/么”；不伪造时间。
  const groups=[[0,5],[5,11],[11,17],[17,21],[21,24],[24,27],[27,32],[32,36],[36,40]];
  const captions=groups.map(([start,end])=>{const part=words.slice(start,end);return {start:part[0].start,end:part.at(-1).end,text:simplified(part.map(word=>word.word).join('')).replace(/麽/g,'么')};});
  if(compact(captions.map(row=>row.text).join(''))!==recognized)throw Error('分组没有完整覆盖实际识别文字');
  const {subtitleDefaults}=await import('../server/subtitle-style.mjs'),{titleStyle,titleTemplates}=await import('../server/title-model.mjs');
  const originalTitle=source.viralStudioConfig.title,s=originalTitle.style;
  const probe=await new (require('../server/media.cjs').Media)(store).probe(store.asset(draft.video.assetId).path),picture=probe.streams.find(stream=>stream.codec_type==='video');
  const scaleX=picture.width/1080,scaleY=picture.height/1920;
  draft.step=4;draft.edit={...draft.edit,sourceId:draft.video.assetId,subtitlesEnabled:true,subtitleMode:'custom',captions,subtitleCustom:{...subtitleDefaults,version:2,fontId:subtitleFont.id,fontFamily:subtitleFont.family,fontSize:50,bold:true,lineHeight:1.2,presetId:'',bottomMargin:420,referenceHeight:1920},titleEnabled:true,title:originalTitle.text.h1,subtitle:originalTitle.text.h2,titleDesign:{version:1,mode:'custom',templateId:titleTemplates[0].id,displayMode:'seconds',duration:originalTitle.duration,offsetX:0,offsetY:0,custom:titleStyle({fontId:titleFont.id,fontFamily:titleFont.family,fontSize:s.fontSize*scaleX,color:s.color,secondaryColor:s.secondaryColor,bold:s.bold,top:s.offsetY*scaleY,stroke:{enabled:s.enableStroke,color:s.strokeColor,width:s.strokeWidth},shadow:{enabled:s.enableShadow,color:s.shadowColor,opacity:s.shadowOpacity,distance:s.shadowDistance},background:{enabled:s.enableBackground,color:'#000000',opacity:.38,paddingX:s.backgroundPaddingX*scaleX,paddingY:s.backgroundPaddingY*scaleX,radius:s.backgroundRadius*scaleX}})},resultId:''};
  store.updateDraft(draft);write('editor-prepared.json',{at:new Date().toISOString(),draftId:draft.id,sourceVideoId:draft.video.assetId,subtitleFont,titleFont,captions,originalScriptPrefixMatched:true,normalization:'Windows简繁转换及麽/么规范；时间保持原ASR边界',edit:draft.edit});
 }
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.STUDIO_DEV_URL;
 const child=spawn(require('electron'),[__filename,'--remote-debugging-port=9347','--studio-data-dir='+workspace],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
 write('launch.json',{at:new Date().toISOString(),pid:child.pid,port:9347,workspace});const log=fs.createWriteStream(path.join(directory,'electron.log'),{flags:'a'});child.stdout.pipe(log);child.stderr.pipe(log);child.on('exit',code=>{log.end();if(code)process.exitCode=code;});console.log(JSON.stringify({pid:child.pid,port:9347}));
}
if(process.versions.electron&&!process.env.ELECTRON_RUN_AS_NODE){require('electron').app.setPath('userData',path.join(directory,'electron-profile'));require('../electron/main.cjs');}
else main().catch(error=>{console.error(error);process.exitCode=1;});
