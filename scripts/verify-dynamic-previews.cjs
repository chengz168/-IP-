const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {createService}=require('../server/service.cjs');
const {runProcess}=require('../server/media.cjs');
async function main(){
  const root=path.resolve('evidence/validation/dynamic-subtitles/media'),service=createService(path.join(root,'workspace')),report={checkedAt:new Date().toISOString(),previews:[]};
  const ffmpeg=service.media.binaries().ffmpeg;
  for(const template of (await import('../server/subtitle-templates.mjs')).subtitleTemplates){
    const preview=await service.invoke('previewSubtitleTemplate',{templateId:template.id}),file=path.join(root,template.id+'.gif');fs.writeFileSync(file,Buffer.from(preview.dataUrl.split(',')[1],'base64'));const info=await service.media.probe(file);assert.equal(info.streams[0].width,268);assert.equal(Number(info.streams[0].nb_frames),72);
    const frame=path.join(root,template.id+'-preview.png');await runProcess(ffmpeg,['-y','-v','error','-ss','0.6','-i',file,'-frames:v','1','-update','1',frame]);const cached=await service.invoke('previewSubtitleTemplate',{templateId:template.id});assert.equal(cached.cached,true);report.previews.push({id:template.id,file,frame,cached:true,frames:72});console.log(template.name+'：72帧，实际竖屏排字后裁取字幕区域');
  }
  fs.writeFileSync(path.join(root,'preview-report.json'),JSON.stringify(report,null,2));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
