// 只准备受控输入和历史状态，不修改生产默认或覆盖已生成候选。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {digest}=require('../integrations/musetalk-local/input.cjs');
const root=path.resolve('evidence/validation/voice-design-20261115');
const read=name=>JSON.parse(fs.readFileSync(path.join(root,name),'utf8'));
const write=(name,value)=>fs.writeFileSync(path.join(root,name),JSON.stringify(value,null,2),{flag:'wx'});
const warm=read('job-warm.json'),generated=read('qwen-warm-generated.json'),playback=read('qwen-warm-playback.json');
assert.equal(digest(generated.file),generated.sha256);assert(playback.fullNativePlaybackToEnded);
const instruct='成年女性，普通话，中音稍偏低，音色温暖圆润，只有少量自然气声。正在边走边和身旁熟悉的朋友说话，把整段话连贯地说出来，语气松弛，有自然的轻重和快慢，停顿跟着意思走，句尾有细微变化。';
const jobs={chat:{...warm,instruct},oral:{...warm,instruct,text:'出来走走吧，你看，路边的灯都亮了。今天忙了一天，总算能歇会儿了。咱们就慢慢走，聊会儿天。'}};
for(const kind of Object.keys(jobs))assert(!fs.existsSync(path.join(root,'job-'+kind+'.json')),'已有候选输入，先查原任务');
assert(!fs.existsSync(path.join(root,'naturalness-plan.json')),'已有本批记录');
for(const [kind,job] of Object.entries(jobs))write('job-'+kind+'.json',job);
write('naturalness-plan.json',{at:new Date().toISOString(),userFeedback:'需要跟真人的声音一样，听不出来是AI生成的',baseline:{kind:'warm',runId:generated.run.id,file:generated.file,sha256:generated.sha256},
 hypotheses:['简短的正向聊天情境及连贯语流描述可能改善听感，尚未验证','口语正文可能减少朗读感，尚未验证；正文变化也可能改变音色，不能强行归因于韵律'],
 comparisons:[{from:'warm',to:'chat',changed:['instruct'],held:['text','language','seed','max_new_tokens','model','worker']},{from:'chat',to:'oral',changed:['text'],held:['instruct','language','seed','max_new_tokens','model','worker']}],
 candidates:Object.entries(jobs).map(([kind,job])=>({kind,job,jobSha256:digest(path.join(root,'job-'+kind+'.json'))})),
 negativePromptSupportVerified:false,samplingParametersChanged:false,postProcessing:false,referenceAudio:null,naturalnessAccepted:false,characterMatchAccepted:false,qualityAccepted:false});
const additions={
 'task_plan.md':'\n本批只读核查发现当前工作区不是Git仓库（git status返回fatal），不据此声称版本或diff已核验。首次混合文档补丁的findings锚点不存在，整次未应用；改为唯一计划锚点并单独追加日志。模型官方固定源码的generate_voice_design支持采样参数，但本次维持原参数，未添加未经验证的韵律控制接口。\n',
 'findings.md':'\n## 2026-11-15 声音自然度纠偏\n\n此前下载中记录为历史；当前模型11文件全部校验、88依赖已安装，clear/warm真实候选存在。warm播放回执确认9.2秒完整不静音播放、刷新恢复、无pageErrors，仍listeningAccepted=false。用户明确拒绝现有AI听感，不能将播放或ASR成功当成质量。此次chat只改instruct，oral再只改text；保留模型、种子和工作器，不下载、不后处理、不修改生产默认。提示词改进只是待验证假设；输入变化也会影响生成音色，不能宣称严格声线一致。\n',
 'progress.md':'\n## 2026-11-15 自然度受控对照\n\n恢复原warm播放会话16846，实际退出0；qwen-warm-playback.json已存在，未重提交。用户要求达到真人听感，现有候选自然度继续判未通过。新增chat/oral实验输入及脚本支持，均通过已有真实产品按钮填写，不添加生产预设。未下载或重装模型。首次混合补丁因findings锚点失败未应用，改唯一锚点；git只读确认不是仓库，不能声称Git状态。\n',
 'docs/自主音色设计接入与验收.md':'\n## 2026-11-15 实际状态与自然度纠偏\n\n此前安装中及未接按钮的表述仅为历史阶段。当前11项模型全部校验、88项依赖安装完成，产品按钮已生成clear和warm两条新音频。warm9.2秒，完整解码、ASR正文一致、完整不静音播放与刷新恢复通过；不代表自然度通过。用户再次要求真人听感，本轮停止长视频及原三音色机械扩展，进行chat同稿改描述、oral沿描述改口语正文的对照。受控输入及实际记录在voice-design-20261115/naturalness-plan.json；不自动切换生产默认、不以技术指标保证无法辨别AI。\n'
};
for(const [file,text] of Object.entries(additions))fs.appendFileSync(path.resolve(file),text);
console.log(JSON.stringify({candidates:Object.keys(jobs),productionDefaultsChanged:false,qualityAccepted:false}));
