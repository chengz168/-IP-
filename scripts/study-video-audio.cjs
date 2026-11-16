const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {Readable}=require('node:stream');
const {pipeline}=require('node:stream/promises');
const {runProcess}=require('../server/media.cjs');
// 用户要求学习视频，此处保存公开教程媒体以离线分析音轨；不读取原软件账号数据。
async function main(){
  const key=process.argv[2]||'extract';const item=JSON.parse(fs.readFileSync('evidence/tutorial/desktop-video-inventory.json','utf8')).find(v=>v.key===key);if(!item)throw new Error('未知教程');
  const directory=path.resolve('evidence/tutorial/audio-study');fs.mkdirSync(directory,{recursive:true});
  const video=path.join(directory,key+'.mp4'),audio=path.join(directory,key+'.wav');
  if(!fs.existsSync(video)){const response=await fetch(item.src,{signal:AbortSignal.timeout(120000)});if(!response.ok)throw new Error('公开教程媒体返回HTTP '+response.status);const temp=video+'.part';try{await pipeline(Readable.fromWeb(response.body),fs.createWriteStream(temp));fs.renameSync(temp,video);}catch(error){fs.rmSync(temp,{force:true});throw error;}}
  const settings=JSON.parse(fs.readFileSync('data/studio.json','utf8')).settings;
  const probe=JSON.parse(await runProcess(settings.ffprobePath,['-v','error','-show_format','-show_streams','-of','json',video]));
  if(!probe.streams.some(s=>s.codec_type==='audio'))throw new Error('教程没有音轨');
  await runProcess(settings.ffmpegPath,['-y','-i',video,'-vn','-ar','16000','-ac','1','-c:a','pcm_s16le',audio]);
  const hash=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(video))hash.update(chunk);
  const report={key,name:item.name,sourceUrl:item.src,video,audio,duration:Number(probe.format.duration),sha256:hash.digest('hex'),scope:'媒体读取与音轨提取；不代表讲解已识别或已理解'};
  fs.writeFileSync(path.join(directory,key+'-media.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
