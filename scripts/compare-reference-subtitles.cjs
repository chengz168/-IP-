const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const assert=require('node:assert/strict');
const {createService}=require('../server/service.cjs');
const {runProcess}=require('../server/media.cjs');
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const root=path.resolve('evidence/validation/subtitle-reference-match');
const referenceAss='F:/Software/轻语IP智能体/aigc-human/temp/ass/viral-ass-1794575981517-y6htf8.ass';
function time(text){const [h,m,s]=text.split(':').map(Number);return h*3600+m*60+s;}
async function main(){
  fs.mkdirSync(root,{recursive:true});const prior=JSON.parse(fs.readFileSync('evidence/private-reference-backup/subtitle-controlled-before.json','utf8'));
  const pipeline=JSON.parse(prior.tasks[0].pipeline_data),source=pipeline.sourceVideoPath,reference=pipeline.previewVideoPath;
  assert.ok(fs.existsSync(source));assert.ok(fs.existsSync(reference));assert.ok(fs.existsSync(referenceAss));
  const ass=fs.readFileSync(referenceAss,'utf8');fs.copyFileSync(referenceAss,path.join(root,'reference.ass'));
  const styleLine=ass.split(/\r?\n/).find(line=>line.startsWith('Style: ')).slice(7).split(',');
  const rows=ass.split(/\r?\n/).filter(line=>line.startsWith('Dialogue: ')).map(line=>{const fields=line.slice(10).split(',');return {start:time(fields[1]),end:time(fields[2]),text:fields.slice(9).join(',').replace(/\\N/g,'\n')};});
  const service=createService(path.join(root,'workspace'));const base=JSON.parse(fs.readFileSync('evidence/validation/pip-desktop-workspace/studio.json','utf8'));
  service.store.data.settings.ffmpegPath=base.settings.ffmpegPath;service.store.data.settings.ffprobePath=base.settings.ffprobePath;
  service.store.data.settings.subtitleFontsDir='F:/Software/轻语IP智能体/aigc-human/resources/fonts';service.store.data.settings.outputDir=path.join(root,'outputs');service.store.save();
  const font=(await service.invoke('listSubtitleFonts')).find(font=>font.family===styleLine[1]);assert.ok(font,'参考字体必须真实存在');
  const {subtitleDefaults}=await import('../server/subtitle-style.mjs');
  const style={...subtitleDefaults,fontId:font.id,fontFamily:font.family,fontSize:pipeline.viralStudioConfig.subtitle.customConfig.fontSize,bold:styleLine[7]==='-1',bottomMargin:Number(styleLine[21])};
  const draft=service.store.draft(),asset=service.store.addAsset(source);draft.title='原厂字幕真实输出同源对比';
  Object.assign(draft.edit,{sourceId:asset.id,subtitlesEnabled:true,subtitleCustom:style,captions:rows,cutSilence:false,speed:1,titleEnabled:false,namecardEnabled:false,bgmEnabled:false,effectsEnabled:false,pipEnabled:false});service.store.save();
  const rendered=await service.invoke('render',{id:draft.id}),ffmpeg=service.media.binaries().ffmpeg;
  for(const stamp of [0.5,1.6])for(const [name,file]of [['reference',reference],['current',rendered.path],['source',source]])await runProcess(ffmpeg,['-y','-v','error','-ss',String(stamp),'-i',file,'-frames:v','1','-update','1',path.join(root,`${name}-${stamp}.png`)]);
  const report={checkedAt:new Date().toISOString(),source:{path:source,sha256:hash(source)},reference:{path:reference,sha256:hash(reference),ass:referenceAss,assSha256:hash(referenceAss),font:styleLine[1],fontSize:Number(styleLine[2]),marginV:Number(styleLine[21]),marginL:Number(styleLine[19]),marginR:Number(styleLine[20])},current:{path:rendered.path,sha256:hash(rendered.path),style},rows,limits:['使用原软件已生成成片与留下的实际ASS，尚未重新在独立任务中生成新字幕成片','原任务步骤输入仅存空对象，实际ASS与成片命名时间一致，不能据此覆盖所有版本和所有样式行为','本次按实际ASS的底部80对比；编辑器显示420与此不同，需要继续核对参数传递']};
  fs.writeFileSync(path.join(root,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({report:path.join(root,'report.json'),referenceFontSize:report.reference.fontSize,referenceMargin:report.reference.marginV,rendered:rendered.path,rows:rows.length}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
