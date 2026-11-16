const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {Store}=require('../server/store.cjs'),{Media,runProcess}=require('../server/media.cjs');
const {toTemplateAss}=require('../server/template-subtitles.cjs');
const {SubtitleTemplatePreview}=require('../server/subtitle-template-preview.cjs');
const {motionSubtitleIds}=require('../server/motion-template-subtitles.cjs');

// 使用独立数据根和确定性音画验证字幕；不请求模型或原厂服务。
async function main(){
 const root=path.resolve('evidence/validation/subtitle-motion-runtime'),work=path.join(root,'interactive-workspace');
 assert.ok(!fs.existsSync(path.join(work,'studio.json')),'隔离数据已存在，拒绝重复真实提交');
 const baseline=JSON.parse(fs.readFileSync(path.join(root,'original-baseline.json'),'utf8')),store=new Store(work);
 for(const key of ['subtitleFontsDir','subtitlePythonPath','ffmpegPath','ffprobePath'])store.data.settings[key]=baseline.settings[key];
 Object.assign(store.data.settings,{view:'new',fontSize:'standard',outputDir:path.join(work,'outputs')});store.save();
 const media=new Media(store),bin=media.binaries(),report={reference:'仅对照原厂只读静态规则，未做原厂同源最终成片验收',modelRequests:0,media:[],previews:[],checks:[]};
 const save=()=>fs.writeFileSync(path.join(root,'media-runtime.json'),JSON.stringify(report,null,2));
 const texts=['认真做好每一步','从重要的事情开始','现在开始行动','坚持打磨细节','真实逐字显示','完成字幕循环','保持节奏与耐心','每次都核对结果','最后一组仍有后景'];
 const captions=texts.map((text,i)=>({start:.4+i*1.1,end:1.2+i*1.1,text,auxiliary:{sourceText:text,keywords:[text.slice(0,2)]}}));
 const sources=[];
 for(const [width,height]of [[360,640],[640,360]]){
  const file=path.join(root,`source-${width}x${height}.mp4`);
  await runProcess(bin.ffmpeg,['-y','-v','error','-f','lavfi','-i',`color=c=0x20202b:s=${width}x${height}:r=25:d=16`,'-f','lavfi','-i','sine=frequency=440:sample_rate=44100:duration=16','-c:v','libx264','-preset','veryfast','-pix_fmt','yuv420p','-c:a','aac','-shortest',file]);
  sources.push({width,height,asset:store.addAsset(file,{origin:'synthetic-motion-runtime-source'})});
 }
 const scenarios=sources.flatMap(source=>motionSubtitleIds.map(id=>({...source,id,offset:0,speed:1,rows:captions,keywords:false,suffix:'cycle'})));
 scenarios.push({...sources[0],id:'scrolling_3lines',offset:200,speed:1,rows:captions,keywords:true,suffix:'keyword'},
  {...sources[0],id:'3d_flip',offset:-200,speed:1,rows:captions,keywords:false,suffix:'tail'},
  {...sources[1],id:'3d_flip',offset:0,speed:1.25,rows:captions,keywords:true,suffix:'speed'},
  {...sources[0],id:'scrolling_4lines',offset:0,speed:1,rows:[{start:.4,end:1,text:'十秒空档前一句'},{start:11,end:11.8,text:'十秒后才出现'},{start:12,end:12.8,text:'短空档连续显示'}],keywords:false,suffix:'gaps'},
  {...sources[0],id:'purple_slide',offset:0,speed:1,rows:[{start:.4,end:3,text:'认真 核对 ABC，长句每个字的紫色底块与空格位置。',auxiliary:{sourceText:'认真 核对 ABC，长句每个字的紫色底块与空格位置。',keywords:['认真','紫色']}}],keywords:true,suffix:'long-space'});
 for(const scenario of scenarios){
  const {width,height,asset,id,offset,speed,rows,keywords,suffix}=scenario,draft=structuredClone(store.draft());
  Object.assign(draft.edit,{sourceId:asset.id,resultId:'',speed,volume:1,titleEnabled:false,subtitlesEnabled:true,subtitleMode:'template',subtitleTemplate:id,subtitleOffsetY:offset,subtitleKeywords:keywords,cardEnabled:false,sfxEnabled:false,bgmEnabled:false,pipEnabled:false,cutSilence:false,captions:rows});
  const name=`${id}-${width}x${height}-offset${offset}-speed${speed}-${suffix}`,native=await toTemplateAss(rows,width,height,draft.edit,store,{speed});
  fs.writeFileSync(path.join(root,name+'.ass'),native.ass);
  const result=await media.render(draft,{signal:AbortSignal.timeout(90000)}),probe=await media.probe(result.path),video=probe.streams.find(s=>s.codec_type==='video');
  assert.equal(result.renderedSubtitleTemplate.engineVersion,2);assert.equal(video.width,width);assert.equal(video.height,height);assert.ok(probe.streams.some(s=>s.codec_type==='audio'));assert.ok(Math.abs(Number(probe.format.duration)-16/speed)<.15);
  await runProcess(bin.ffmpeg,['-v','error','-i',result.path,'-f','null','-']);
  const frames=path.join(root,name);fs.mkdirSync(frames,{recursive:true});
  const sample=suffix==='gaps'?[.2,.8,1.5,5,10.8,11.5,11.9,12.5,13.5]:[.2,.52,.9,1.9,3.9,6,7.4,9.6,11.2,12.5,14.5];
  const times=sample.map(t=>t/speed);
  for(const [i,t]of times.entries())await runProcess(bin.ffmpeg,['-y','-v','error','-ss',String(t),'-i',result.path,'-frames:v','1','-update','1',path.join(frames,i+'.png')]);
  report.media.push({name,templateId:id,sourceId:asset.id,assetId:result.id,path:result.path,width,height,speed,offset,keywords,duration:Number(probe.format.duration),bytes:fs.statSync(result.path).size,audio:true,decodeExitCode:0,frames:times.map((time,i)=>({time,path:path.join(frames,i+'.png')})),metadata:result.renderedSubtitleTemplate});save();console.log('RENDERED '+name);
 }
 const preview=new SubtitleTemplatePreview(media),counts={'3d_flip':9,red_yellow:7,red_blue_science:5};
 for(const id of motionSubtitleIds){const r=await preview.render(id),file=path.join(root,id+'.gif');fs.writeFileSync(file,Buffer.from(r.dataUrl.split(',')[1],'base64'));const info=await media.probe(file),count=counts[id]??6;assert.equal(Number(info.streams[0].nb_frames),count*18);assert.ok(Math.abs(Number(info.format.duration)-count*1.2)<.1);report.previews.push({id,path:file,cached:r.cached,bytes:fs.statSync(file).size,frames:Number(info.streams[0].nb_frames),duration:Number(info.format.duration)});save();console.log('PREVIEW '+id);}
 const draft=store.draft();Object.assign(draft.edit,{sourceId:sources[0].asset.id,resultId:'',speed:1,volume:1,titleEnabled:false,subtitlesEnabled:true,subtitleMode:'template',subtitleTemplate:'scrolling_3lines',subtitleOffsetY:0,subtitleKeywords:false,cardEnabled:false,sfxEnabled:false,bgmEnabled:false,pipEnabled:false,cutSilence:false,captions});draft.step=4;draft.title='滚动与立体字幕实际生成验收';store.save();
 report.isolatedRoot=work;report.taskId=draft.id;report.sourceId=draft.edit.sourceId;save();console.log(JSON.stringify({renders:report.media.length,previews:report.previews.length,work,taskId:draft.id}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
