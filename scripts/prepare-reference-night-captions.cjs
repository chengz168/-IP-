const fs=require('node:fs'),path=require('node:path');
const {Media}=require('../server/media.cjs'),{LocalAsr}=require('../server/local-asr.cjs');
const {simplified}=require('./verify-indextts-output.cjs');
const directory=path.resolve('evidence/validation/reference-sample-20261115');
async function main(){
 const output=path.join(directory,'driver-asr.json');if(fs.existsSync(output))throw Error('已保存识别结果，不重复识别');
 // 只读快照避免重建Store时把仍在生成的视频任务恢复为中断。
 const data=JSON.parse(fs.readFileSync(path.join(directory,'workspace/studio.json'),'utf8'));
 const input=JSON.parse(fs.readFileSync(path.join(directory,'inputs.json'),'utf8'));
 const store={data,asset:id=>{const asset=data.assets.find(item=>item.id===id);if(!asset)throw Error('素材不存在');return asset;}};
 const asr=await new LocalAsr(store,new Media(store)).transcribe(input.audio.id,{progress:(_n,message)=>console.log(message)});
 fs.writeFileSync(output,JSON.stringify({at:new Date().toISOString(),asr,sourceAudioSha256:input.audio.sha256},null,2));
 const converted={...asr,text:simplified(asr.text),segments:asr.segments.map(row=>({...row,text:simplified(row.text),words:row.words?.map(word=>({...word,word:simplified(word.word)}))}))};
 const captions=(await import('../server/caption-recognition.mjs')).recognitionRows(converted,8,{maxChars:8});
 fs.writeFileSync(path.join(directory,'captions.json'),JSON.stringify({at:new Date().toISOString(),text:converted.text,captions,normalization:'仅Windows简繁转换；保留原始ASR及真实词级边界',humanTranscriptReviewed:false},null,2));
 console.log(JSON.stringify({text:converted.text,captions}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
