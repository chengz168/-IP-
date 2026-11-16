const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {Store}=require('../server/store.cjs'),{Media,runProcess}=require('../server/media.cjs');
const {toTemplateAss,templateOptions}=require('../server/template-subtitles.cjs');
const {SubtitleTemplatePreview}=require('../server/subtitle-template-preview.cjs');

// 只在本轮独立数据根生成测试媒体；不调用模型或原厂服务。
async function main(){
 const root=path.resolve('evidence/validation/subtitle-template-runtime'),work=path.join(root,'interactive-workspace');
 assert.ok(!fs.existsSync(path.join(work,'studio.json')),'隔离数据根已存在，避免重复真实提交');
 const baseline=JSON.parse(fs.readFileSync(path.join(root,'original-baseline.json'),'utf8')),store=new Store(work);
 for(const key of ['subtitleFontsDir','subtitlePythonPath','ffmpegPath','ffprobePath'])store.data.settings[key]=baseline.settings[key];
 store.data.settings.view='new';store.data.settings.fontSize='standard';store.data.settings.outputDir=path.join(work,'outputs');store.save();
 const media=new Media(store),bin=media.binaries(),report={reference:'原厂只读静态规则，不是原厂同源最终视频',modelRequests:0,media:[],previews:[],checks:[]};
 const save=()=>fs.writeFileSync(path.join(root,'media-runtime.json'),JSON.stringify(report,null,2));
 const texts=['认真做好每一步','从重要的事情开始','现在开始行动','坚持打磨细节','真实逐字显示','完成字幕循环'];
 const captions=texts.map((text,i)=>({start:.4+i*1.1,end:1.2+i*1.1,text}));
 const sources=[];
 for(const [width,height]of [[360,640],[640,360]]){
  const file=path.join(root,`source-${width}x${height}.mp4`);
  await runProcess(bin.ffmpeg,['-y','-v','error','-f','lavfi','-i',`color=c=0x20202b:s=${width}x${height}:r=25:d=8`,'-f','lavfi','-i','sine=frequency=440:sample_rate=44100:duration=8','-c:v','libx264','-preset','veryfast','-pix_fmt','yuv420p','-c:a','aac','-shortest',file]);
  sources.push({width,height,asset:store.addAsset(file,{origin:'synthetic-runtime-source'})});
 }
 const templates=['simple_yellow_white','simple_blue_white','simple_brown_white'];
 const scenarios=sources.flatMap(source=>templates.map(id=>({...source,id,offset:0,speed:1})));
 scenarios.push({...sources[0],id:templates[0],offset:200,speed:1},{...sources[0],id:templates[0],offset:-200,speed:1},{...sources[1],id:templates[2],offset:0,speed:1.25});
 for(const scenario of scenarios){
  const {width,height,asset,id,offset,speed}=scenario,draft=structuredClone(store.draft());
  Object.assign(draft.edit,{sourceId:asset.id,resultId:'',speed,volume:1,titleEnabled:false,subtitlesEnabled:true,subtitleMode:'template',subtitleTemplate:id,subtitleOffsetY:offset,subtitleKeywords:false,cardEnabled:false,sfxEnabled:false,bgmEnabled:false,pipEnabled:false,cutSilence:false,captions});
  const name=`${id}-${width}x${height}-offset${offset}-speed${speed}`,native=await toTemplateAss(captions,width,height,draft.edit,store,{speed});
  fs.writeFileSync(path.join(root,name+'.ass'),native.ass);
  const result=await media.render(draft,{signal:AbortSignal.timeout(60000)}),probe=await media.probe(result.path),video=probe.streams.find(s=>s.codec_type==='video');
  assert.equal(result.renderedSubtitleTemplate.engineVersion,2);assert.equal(video.width,width);assert.equal(video.height,height);assert.ok(probe.streams.some(s=>s.codec_type==='audio'));assert.ok(Math.abs(Number(probe.format.duration)-8/speed)<.15);
  await runProcess(bin.ffmpeg,['-v','error','-i',result.path,'-f','null','-']);
  const frames=path.join(root,name);fs.mkdirSync(frames,{recursive:true});
  const times=[.2,.52,1.1,2.8,3.85,4.83,5.93,6.5,7.2].map(t=>t/speed);
  for(const [i,t]of times.entries())await runProcess(bin.ffmpeg,['-y','-v','error','-ss',String(t),'-i',result.path,'-frames:v','1','-update','1',path.join(frames,i+'.png')]);
  report.media.push({name,sourceId:asset.id,assetId:result.id,path:result.path,width,height,duration:Number(probe.format.duration),bytes:fs.statSync(result.path).size,audio:true,decodeExitCode:0,frames:times.map((time,i)=>({time,path:path.join(frames,i+'.png')})),metadata:result.renderedSubtitleTemplate});save();console.log('RENDERED '+name);
 }
 const preview=new SubtitleTemplatePreview(media);
 for(const id of templates){const r=await preview.render(id),file=path.join(root,id+'.gif');fs.writeFileSync(file,Buffer.from(r.dataUrl.split(',')[1],'base64'));const info=await media.probe(file);report.previews.push({id,path:file,cached:r.cached,bytes:fs.statSync(file).size,frames:Number(info.streams[0].nb_frames),duration:Number(info.format.duration)});assert.ok(Number(info.streams[0].nb_frames)>=100);save();console.log('PREVIEW '+id);}
 await assert.rejects(templateOptions({subtitleTemplate:'simple_blue_white',subtitleOffsetY:0,subtitleKeywords:false},{data:{settings:{}}}),/喜脉体.ttf/);report.checks.push({name:'缺实际模板字体时明确失败，不静默回退',passed:true});
 const legacy=await toTemplateAss(captions,360,640,{subtitleTemplate:templates[0],subtitleTemplateY:900,subtitleKeywords:false},store);assert.equal(legacy.metadata.offsetY,333.75);report.checks.push({name:'旧绝对位置900只读换算offset333.75',passed:true});
 const draft=store.draft();Object.assign(draft.edit,{sourceId:sources[0].asset.id,resultId:'',speed:1,volume:1,titleEnabled:false,subtitlesEnabled:true,subtitleMode:'template',subtitleTemplate:templates[0],subtitleOffsetY:0,subtitleKeywords:false,cardEnabled:false,sfxEnabled:false,bgmEnabled:false,pipEnabled:false,cutSilence:false,captions});draft.step=4;draft.title='字幕模板实际生成验收';store.save();
 report.isolatedRoot=work;report.taskId=draft.id;report.sourceId=draft.edit.sourceId;save();console.log(JSON.stringify({renders:report.media.length,previews:report.previews.length,work,taskId:draft.id}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
