const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {digest}=require('../integrations/musetalk-local/input.cjs');
const root=path.resolve('evidence/validation/voice-design-20261115');
if(fs.existsSync(path.join(root,'prepared.json')))throw Error('已有自主音色候选输入，不覆盖历史记录');
fs.mkdirSync(root,{recursive:true});
const previous=JSON.parse(fs.readFileSync('evidence/validation/musetalk-integration-20261115/prepared.json','utf8'));
const protection=previous.protectedFiles.map(item=>({...item,unchanged:digest(item.file)===item.sha256}));
if(protection.some(item=>!item.unchanged))throw Error('前次保护文件已变化，先核对变化原因');
const manifest=JSON.parse(fs.readFileSync('integrations/qwen-voice-design/manifest.json','utf8'));
const text='晚上出来走一走，刚好路边的灯都亮了。忙了一天，先给自己留几分钟，慢慢走，也慢慢聊。';
// 描述是待试听的设计选择，不据人物画面推断真实年龄、性格或原声音色。
const descriptions=[
 ['clear','成年女性，普通话，清亮柔和的中音，发声有支撑但不尖细。像晚上散步时和朋友面对面聊天，亲切松弛，咬字清楚，语速适中，句间有自然停顿，句尾轻轻落下。不要播音腔、广告推销腔、夹子音，不要刻意卖萌，不要夸张情绪。'],
 ['warm','成年女性，普通话，中音稍偏低，音色温暖圆润，只有少量自然气声，吐字清晰。夜晚街头轻声和朋友聊天，语气自然从容，语速适中，标点处自然换气，句尾平稳落下。不要沙哑，不要过重气声，不要朗诵或主持腔。'],
 ['lively','成年女性，普通话，中音清晰自然，音色明亮、有生活感。像下班后和熟悉的朋友聊天，轻松而带一点笑意，有自然的重音起伏，语速适中，停顿顺畅。不要尖细甜腻，不要舞台表演腔，不要逐字机械重读。'],
];
const candidates=descriptions.map(([id,instruct])=>{
 const job={text,instruct,language:'Chinese',seed:20261115,max_new_tokens:1024};
 const file=path.join(root,'job-'+id+'.json');fs.writeFileSync(file,JSON.stringify(job,null,2),{flag:'wx'});
 return {id,job:file,jobSha256:digest(file),description:instruct,referenceAudio:null,generated:false,qualityAccepted:false};
});
const report={at:new Date().toISOString(),scope:'同正文的三种独立虚构人物音色设计；待实际生成和试听',text,candidates,
 model:{repo:manifest.repo,revision:manifest.revision,files:manifest.files.length,bytes:manifest.bytes},
 characterVisualSource:path.resolve('evidence/validation/musetalk-integration-20261115/generated-grid.jpg'),
 protectedFiles:protection,voiceDesignModelDownloaded:false,modelInferencePerformed:false,productionIntegrationComplete:false,
 originalVoiceCloneUsed:false,naturalnessAccepted:false,characterMatchAccepted:false,qualityAccepted:false,completeReplica:false};
fs.writeFileSync(path.join(root,'prepared.json'),JSON.stringify(report,null,2),{flag:'wx'});
console.log(JSON.stringify({directory:root,candidates:candidates.map(c=>c.id),modelInferencePerformed:false,qualityAccepted:false}));
