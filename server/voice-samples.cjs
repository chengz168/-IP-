const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {runProcess}=require('./media.cjs');
const maxBytes=50*1024*1024;
class VoiceSamples{
 constructor(service){this.service=service;}
 source(sampleId){
  const source=this.service.store.asset(sampleId),stat=fs.statSync(source.path);
  if(!['audio','video'].includes(source.type))throw Error('请选择有音轨的音频或视频文件');
  if(!stat.isFile()||stat.size<=0||stat.size>maxBytes)throw Error('声音样本文件须大于0且不超过50MB');
  return {...source};
 }
 hash(source){return crypto.createHash('sha256').update(fs.readFileSync(source.path)).digest('hex');}
 checkSource(source,sourceHash){if(this.hash(this.source(source.id))!==sourceHash)throw Error('声音源文件已变化，请重新选择并准备样本');}
 duration(info){const duration=Number(info.format?.duration);if(!info.streams.some(s=>s.codec_type==='audio')||!Number.isFinite(duration)||duration<=0)throw Error('所选文件没有实际音轨或有效时长');return duration;}
 async prepare({id,sampleId}){
  const {runtime,media,store}=this.service,source=this.source(sampleId),sourceHash=this.hash(source);
  return runtime.run('voice-preview',id,{sampleId,sourceHash},async ctx=>{
   const duration=this.duration(await media.probe(source.path)),temp=path.join(store.outputDir(),'voice-waveform-'+crypto.randomUUID()+'.png');
   ctx.signal.throwIfAborted();this.checkSource(source,sourceHash);
   try{
    await runProcess(media.binaries().ffmpeg,['-y','-i',source.path,'-filter_complex','[0:a:0]aformat=channel_layouts=mono,showwavespic=s=960x80:colors=0xCF72E8:scale=sqrt:draw=full[wave]','-map','[wave]','-frames:v','1','-update','1',temp],{signal:ctx.signal});
    ctx.signal.throwIfAborted();this.checkSource(source,sourceHash);
    const image=fs.readFileSync(temp);if(!image.length||image.readUInt32BE(0)!==0x89504e47)throw Error('没有生成有效声音波形');
    return {sourceId:sampleId,sourceHash,duration,waveform:'data:image/png;base64,'+image.toString('base64')};
   }finally{fs.rmSync(temp,{force:true});}
  });
 }
 async trim({id,sampleId,sourceHash,start,end}){
  const {store,runtime,media}=this.service,source=this.source(sampleId);
  if(typeof sourceHash!=='string'||!/^[a-f0-9]{64}$/.test(sourceHash))throw Error('请先读取并准备声音样本');
  if(typeof start!=='number'||typeof end!=='number'||!Number.isFinite(start)||!Number.isFinite(end)||start<0||end-start<0.1-1e-9)throw Error('裁剪起止时间无效，选区至少为0.1秒');
  this.checkSource(source,sourceHash);
  if(store.data.runs.some(r=>r.type==='voice-trim'&&r.draftId===id&&r.status==='running'))throw Error('该任务的声音样本正在裁剪，请等待或停止后再试');
  return runtime.run('voice-trim',id,{sampleId,sourceHash,start,end},async ctx=>{
   const sourceDuration=this.duration(await media.probe(source.path));if(end>sourceDuration+0.000001)throw Error('裁剪结束时间超过实际音频时长');
   ctx.signal.throwIfAborted();this.checkSource(source,sourceHash);
   // 复用前仍核对源和裁后文件内容，丢失或改变的历史片段不能冒充当前选区。
   const prior=store.data.assets.find(a=>a.origin==='voice-trim'&&a.voiceTrim?.sourceId===sampleId&&a.voiceTrim.sourceSha256===sourceHash&&a.voiceTrim.start===start&&a.voiceTrim.end===end);
   if(prior?.voiceTrim.outputSha256){try{if(this.hash(this.source(prior.id))===prior.voiceTrim.outputSha256)return prior;}catch{}}
   const temp=path.join(store.outputDir(),'voice-trim-'+crypto.randomUUID()+'.wav');let created;
   try{
    await runProcess(media.binaries().ffmpeg,['-y','-i',source.path,'-map','0:a:0','-vn','-af',`atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS`,'-ac','1','-ar','24000','-c:a','pcm_s16le',temp],{signal:ctx.signal});
    const duration=this.duration(await media.probe(temp));if(Math.abs(duration-(end-start))>0.05)throw Error('裁剪输出时长与所选范围不符，请重新检查音轨');
    if(fs.statSync(temp).size>maxBytes)throw Error('裁剪后的声音样本超过50MB，请缩短选区');
    ctx.signal.throwIfAborted();this.checkSource(source,sourceHash);
    const outputSha256=this.hash({path:temp});
    created=store.addAsset(temp,{origin:'voice-trim',name:path.parse(source.name).name+'-裁剪样本.wav',duration,voiceTrim:{sourceId:sampleId,sourceSha256:sourceHash,start,end,sourceDuration,outputSha256}},{persist:false});
    store.save();return created;
   }catch(error){if(created){store.data.assets=store.data.assets.filter(a=>a.id!==created.id);fs.rmSync(created.path,{force:true});}throw error;}finally{fs.rmSync(temp,{force:true});}
  });
 }
 async save({id,name,sampleId}){
  const {store,runtime,media}=this.service;
  if(typeof name!=='string'||!name.trim()||name.trim().length>10)throw new Error('请填写10字以内的声音名称');
  const source=store.asset(sampleId);if(!['audio','video'].includes(source.type))throw new Error('请选择有音轨的音频或视频文件');
  const stat=fs.statSync(source.path);if(!stat.isFile()||stat.size<=0||stat.size>maxBytes)throw new Error('声音样本文件须大于0且不超过50MB');
  if(store.data.runs.some(run=>run.type==='voice-import'&&run.status==='running'&&run.parameters.sampleId===sampleId))throw new Error('该声音样本正在保存，请等待或停止后再试');
  const sourceHash=crypto.createHash('sha256').update(fs.readFileSync(source.path)).digest('hex');
  return runtime.run('voice-import',id,{name:name.trim(),sampleId,sourceHash},async ctx=>{
   const info=await media.probe(source.path);if(!info.streams.some(stream=>stream.codec_type==='audio')||!(Number(info.format.duration)>0))throw new Error('所选文件没有实际音轨或有效时长，请选择带声音的文件');
   let sample=source,created,temp;
   try{
    if(source.type==='video'){
     temp=path.join(store.outputDir(),'voice-sample-'+crypto.randomUUID()+'.wav');
     await runProcess(media.binaries().ffmpeg,['-y','-i',source.path,'-vn','-ac','1','-ar','24000','-c:a','pcm_s16le',temp],{signal:ctx.signal});
     const extracted=await media.probe(temp);if(!extracted.streams.some(stream=>stream.codec_type==='audio')||!(Number(extracted.format.duration)>0))throw new Error('视频提取后没有有效音频');
     ctx.signal.throwIfAborted();sample=created=store.addAsset(temp,{origin:'voice-sample',name:name.trim()+'-声音样本.wav',duration:Number(extracted.format.duration)},{persist:false});
    }
    ctx.signal.throwIfAborted();if(crypto.createHash('sha256').update(fs.readFileSync(source.path)).digest('hex')!==sourceHash)throw new Error('源文件在处理期间发生变化，请重新导入');
    const resource={id:crypto.randomUUID(),name:name.trim(),sampleId:sample.id,sourceId:source.id,createdAt:new Date().toISOString(),status:'sample-only'};
    store.data.voices.push(resource);try{store.save();}catch(error){store.data.voices=store.data.voices.filter(item=>item.id!==resource.id);throw error;}
    return {resource,sampleId:sample.id,duration:Number(info.format.duration),extracted:source.type==='video',trained:false};
   }catch(error){if(created){store.data.assets=store.data.assets.filter(asset=>asset.id!==created.id);fs.rmSync(created.path,{force:true});}throw error;}finally{if(temp)fs.rmSync(temp,{force:true});}
  });
 }
}
module.exports={VoiceSamples,maxBytes};
