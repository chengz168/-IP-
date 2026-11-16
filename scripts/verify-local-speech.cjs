const fs=require('node:fs');
const path=require('node:path');
const {createService}=require('../server/service.cjs');
async function main(){
  const service=createService(path.resolve('evidence/validation/local-speech-workspace'));
  const localSettings=JSON.parse(fs.readFileSync('data/studio.json','utf8')).settings;
  const voices=await service.invoke('systemVoices');
  const voice=voices.find(v=>v.culture==='zh-CN');if(!voice)throw new Error('没有检测到中文系统音色');
  await service.invoke('saveSettings',{outputDir:'',ffmpegPath:localSettings.ffmpegPath,ffprobePath:localSettings.ffprobePath,provider:{ttsProtocol:'windows',systemVoice:voice.name}});
  const text=JSON.parse(fs.readFileSync('evidence/validation/local-text-report.json','utf8')).result.text;
  const draft=service.store.draft();draft.title='真实Windows朗读验证';draft.finalText=text;draft.voice.speed=1.1;service.store.save();
  const start=Date.now(),audio=await service.invoke('speech',{id:draft.id}),probe=await service.media.probe(audio.path);
  const report={checkedAt:new Date().toISOString(),voice:voice.name,engine:'Windows System.Speech',text,source:'本地文本模型实际输出',elapsedMs:Date.now()-start,result:audio.path,duration:Number(probe.format.duration),streams:probe.streams.map(s=>({type:s.codec_type,codec:s.codec_name,sampleRate:s.sample_rate})),runId:service.store.data.runs[0].id,status:service.store.data.runs[0].status,temporaryDirectories:fs.readdirSync(service.store.outputDir()).filter(n=>n.startsWith('.speech-')),scope:'真实系统朗读；未验证克隆音色相似度、数字人口型或主观音质'};
  fs.writeFileSync('evidence/validation/local-speech-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
