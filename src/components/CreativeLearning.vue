<script setup>
import {computed,inject,onBeforeUnmount,ref,watch} from 'vue';
import {call} from '../api';
import {learningStages} from '../../server/creative-learning.mjs';
const props=defineProps({stage:{type:String,default:''},global:Boolean});
const {draft,notify}=inject('studio');
const data=ref(null),loading=ref(false),pending=ref(false),error=ref(''),message=ref('');
const tab=ref('feedback'),runId=ref(''),rating=ref('improve'),rule=ref(''),editing=ref(null),deleting=ref('');
let token=0;
const selected=computed(()=>data.value?.runs.find(run=>run.id===runId.value));
const entries=computed(()=>(data.value?.entries||[]).filter(entry=>!props.stage||entry.scope.stage===props.stage).slice().reverse());
const applied=computed(()=>data.value?.history||[]);
const statusName=status=>({running:'执行中',succeeded:'已返回结果，待核对',failed:'请求失败',cancelled:'已停止',interrupted:'已中断',unknown:'结果待确认'}[status]||'查看原任务状态');
const example=computed(()=>['shots','episodes','assets'].includes(selected.value?.scope.stage)?'每个镜头只安排一个主要动作，写清起点和结束状态，保持角色服装和道具连续。':'开头直接进入具体问题，不用空泛问候；段落减少同义重复，句子采用自然口语。');
const time=value=>new Date(value).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
const scopeText=scope=>scope?[scope.presetName,scope.profileName,learningStages[scope.stage]].join(' · '):'未匹配类型';
async function load(){
 const request=++token;loading.value=true;
 try{const value=await call('creativeLearningState',{...(props.global?{}:{id:draft.value.id}),...(props.stage?{stage:props.stage}:{})});if(request!==token)return;data.value=value;if(!value.runs.some(run=>run.id===runId.value))runId.value=value.runs[0]?.id||'';}
 catch(e){if(request===token)error.value=e.message;}
 finally{if(request===token)loading.value=false;}
}
async function mutate(action,payload,success){
 if(pending.value||!data.value)return false;pending.value=true;error.value='';message.value='';
 try{await call(action,{revision:data.value.revision,...payload});await load();message.value=success;notify(success,'success');return true;}
 catch(e){error.value=e.message;await load();return false;}
 finally{pending.value=false;}
}
async function add(){if(await mutate('saveCreativeFeedback',{runId:runId.value,rating:rating.value,rule:rule.value},'经验已保存，后续匹配任务会使用；请继续核对实际效果。')){rule.value='';tab.value='entries';}}
async function update(entry,patch){return mutate('updateCreativeFeedback',{entryId:entry.id,entryRevision:entry.revision,...patch},'经验已更新，只影响之后开始的任务。');}
async function saveEdit(){if(await update(editing.value,{rule:editing.value.rule}))editing.value=null;}
async function remove(entry){if(await mutate('deleteCreativeFeedback',{entryId:entry.id,entryRevision:entry.revision},'经验已删除，历史任务中的调用快照仍保留。'))deleting.value='';}
watch([()=>draft.value?.id,()=>props.stage,()=>props.global],()=>{token++;rule.value='';editing.value=null;deleting.value='';error.value='';message.value='';load();},{immediate:true});
onBeforeUnmount(()=>token++);
</script>

<template>
 <section class="creative-learning" aria-label="创作反馈学习" :aria-busy="pending||loading">
  <div class="learning-intro"><div><h3>让下次创作记住你的要求</h3><p>从明确反馈积累表达与镜头经验，按相同题材、内容类型和阶段调用。无需额外训练模型。</p></div><button type="button" :disabled="pending||loading||!data" @click="mutate('updateCreativeFeedback',{enabled:!data.enabled},data.enabled?'已暂停经验调用。':'已恢复经验调用。')">{{data?.enabled?'暂停经验调用':'恢复经验调用'}}</button></div>
  <p class="learning-boundary">只学习你确认的偏好；生成成功、选用或未选用均不自动判为优劣。经验不会覆盖当前要求、原文事实或输出格式，也不修改模型权重。画面建议用于下一轮分镜设计，不自动更改已审核镜头。</p>
  <div class="learning-summary" role="status"><span>{{data?.enabled?'经验调用已开启':'经验调用已暂停'}}</span><span>已保存 {{data?.entries.length||0}} 条</span><span v-if="stage">当前阶段匹配 {{data?.preview.entries.length||0}} 条</span><span>每次最多调用最近 4 条</span></div>
  <nav class="learning-tabs" aria-label="创作学习分类"><button v-for="[id,label] in [['feedback','添加反馈'],['entries','已学经验'],['history','调用记录']]" :key="id" type="button" :aria-pressed="tab===id" :class="{active:tab===id}" @click="tab=id">{{label}}</button><button type="button" class="learning-refresh" :disabled="pending||loading" @click="error='';load()">{{loading?'读取中…':'刷新'}}</button></nav>
  <p v-if="error" class="learning-error" role="alert">{{error}}</p><p v-if="message" class="learning-message" role="status">{{message}}</p>
  <form v-if="tab==='feedback'" class="learning-form" @submit.prevent="add">
   <template v-if="data?.runs.length">
    <label>针对哪次创作反馈<select v-model="runId" aria-label="反馈来源结果" :disabled="pending"><option v-for="run in data.runs" :key="run.id" :value="run.id">{{time(run.createdAt)}} · {{learningStages[run.scope.stage]}} · {{run.title}}</option></select></label>
    <p class="learning-scope">适用范围：{{scopeText(selected?.scope)}}。按当次生成的资料匹配；范围不合适时请先核对创作预设。</p>
    <details v-if="selected"><summary>核对来源结果摘录</summary><pre>{{selected.source.excerpt||'结果没有文本摘录，请在原创作页面核对。'}}</pre><small>来源任务：{{selected.id}}</small></details>
    <fieldset :disabled="pending"><legend>反馈方向</legend><label><input v-model="rating" type="radio" value="improve"/>纠正问题</label><label><input v-model="rating" type="radio" value="keep"/>保留优点</label></fieldset>
    <label>下次应该怎样创作<textarea v-model="rule" aria-label="可复用创作经验" rows="3" minlength="4" maxlength="300" :disabled="pending" placeholder="写可复用的表达或镜头偏好，例如：减少同义重复，每段只推进一个信息。不填写具体商品参数。" required/></label>
    <div class="learning-form-help"><button type="button" class="text-button" :disabled="pending" @click="rule=example">填入示例再修改</button><span>{{rule.trim().length}} / 300 字</span></div>
    <div class="learning-submit"><p>保存后在后续匹配任务中调用。任务开始时固定经验版本；停用不改变正在执行的任务。</p><button type="submit" class="primary" :disabled="pending||loading||!selected||rule.trim().length<4">{{pending?'保存中…':'保存并用于下次创作'}}</button></div>
   </template>
   <div v-else class="learning-empty"><p>{{loading?'正在读取创作结果…':'暂时没有可反馈的模型创作结果。'}}</p><p>先生成选题、文案、拆集、分镜或资产描述，再回来添加经验。取证、校对、失败或过期结果不会作为本入口的反馈来源。</p></div>
  </form>
  <div v-else-if="tab==='entries'" class="learning-entries">
   <p v-if="!entries.length" class="learning-empty">暂无经验。对生成结果添加反馈后，会在这里显示。</p>
   <article v-for="entry in entries" :key="entry.id" class="learning-entry" :class="{paused:!entry.enabled}">
    <header><strong>{{entry.rating==='keep'?'保留优点':'纠正问题'}} <small>v{{entry.revision}} · {{entry.enabled?'启用':'停用'}}</small></strong><span>{{time(entry.updatedAt)}}</span></header>
    <p class="learning-scope">{{scopeText(entry.scope)}}</p>
    <template v-if="editing?.id===entry.id"><label>修改经验<textarea v-model="editing.rule" rows="3" minlength="4" maxlength="300" aria-label="修改创作经验" :disabled="pending"/></label><div class="learning-entry-actions"><button type="button" :disabled="pending" @click="editing=null">取消修改</button><button type="button" class="primary" :disabled="pending||editing.rule.trim().length<4" @click="saveEdit">保存新版</button></div></template>
    <p v-else class="learning-rule">{{entry.rule}}</p>
    <details><summary>来源和历史版本</summary><p>{{entry.source.excerpt}}</p><small>来源：{{entry.source.runId}}</small><div v-for="history in entry.history.slice().reverse()" :key="history.revision" class="learning-history-row"><span>v{{history.revision}}：{{history.rule}}</span><button v-if="history.rule!==entry.rule" type="button" :disabled="pending" @click="update(entry,{rule:history.rule})">恢复这版内容</button></div></details>
    <div v-if="deleting===entry.id" class="learning-delete-confirm"><p>确认删除这条经验？历史任务的调用快照仍会保留。</p><button type="button" :disabled="pending" @click="deleting=''">保留</button><button type="button" :disabled="pending" @click="remove(entry)">确认删除经验</button></div>
    <div v-else class="learning-entry-actions"><button type="button" :disabled="pending" @click="update(entry,{enabled:!entry.enabled})">{{entry.enabled?'停用':'启用'}}</button><button type="button" :disabled="pending||!!editing" @click="editing={...entry}">修改</button><button type="button" :disabled="pending" @click="deleting=entry.id">删除</button></div>
   </article>
  </div>
  <div v-else class="learning-entries"><p class="learning-boundary">记录表示经验附加到了模型请求，不代表服务已收到、模型遵循或作品质量通过。这里保留最近30次含经验的任务记录，包括失败或停止的任务。</p><p v-if="!applied.length" class="learning-empty">暂无经验调用记录。</p><article v-for="run in applied" :key="run.id" class="learning-entry"><header><strong>{{run.title}}</strong><span>{{time(run.createdAt)}}</span></header><p class="learning-scope">{{scopeText(run.scope)}} · {{statusName(run.status)}} · {{run.used.length}} 次请求附加记录</p><p v-for="entry in run.appliedEntries" :key="entry.id">v{{entry.revision}} · {{entry.rule}}</p><small>任务记录：{{run.id}}</small></article></div>
 </section>
</template>

<style scoped>
.creative-learning{display:flex;flex-direction:column;gap:16px;min-width:0;font-size:var(--app-font-size-body,14px)}
.learning-intro{display:flex;align-items:flex-start;justify-content:space-between;gap:20px}.learning-intro h3{margin:0 0 8px}.learning-intro p,.learning-intro button{margin:0}.learning-intro p{line-height:1.7;color:var(--muted,#aaa8b7)}.learning-intro>button{flex-shrink:0}
.learning-boundary,.learning-scope{margin:0;line-height:1.75;color:var(--muted,#aaa8b7);font-size:var(--app-font-size-meta,12px)}
.learning-summary{display:flex;gap:10px 20px;flex-wrap:wrap;padding:12px 14px;border:1px solid var(--border,#454251);border-radius:8px}.learning-summary span:first-child{color:var(--accent,#c49aff)}
.learning-tabs{display:flex;flex-wrap:wrap;gap:8px;border-bottom:1px solid var(--border,#454251);padding-bottom:12px}.learning-tabs .active{border-color:var(--accent,#c49aff);color:var(--accent,#c49aff)}.learning-tabs .learning-refresh{margin-left:auto}
.learning-form{display:flex;flex-direction:column;gap:16px}.learning-form>label,.learning-entry label{display:flex;flex-direction:column;gap:8px;line-height:1.5}.learning-form select,.learning-form textarea,.learning-entry textarea{width:100%;min-width:0;box-sizing:border-box}.learning-form textarea,.learning-entry textarea{resize:vertical;line-height:1.7;min-height:100px}.learning-form fieldset{display:flex;gap:20px;flex-wrap:wrap;border:1px solid var(--border,#454251);border-radius:8px;padding:12px 14px}.learning-form fieldset label{display:flex;align-items:center;gap:8px}.learning-form fieldset legend{padding:0 6px}.learning-form input[type=radio]{width:auto;margin:0}
.learning-form-help,.learning-submit{display:flex;align-items:center;justify-content:space-between;gap:16px}.learning-form-help span{color:var(--muted,#aaa8b7);font-size:12px}.learning-submit{border-top:1px solid var(--border,#454251);padding-top:16px}.learning-submit p{margin:0;color:var(--muted,#aaa8b7);font-size:12px;line-height:1.7;flex:1}.learning-submit>button{flex-shrink:0}
.learning-entries{display:flex;flex-direction:column;gap:14px}.learning-entry{display:flex;flex-direction:column;gap:12px;border:1px solid var(--border,#454251);border-radius:10px;padding:18px;min-width:0}.learning-entry.paused{background:rgba(128,128,128,.04)}.learning-entry header{display:flex;justify-content:space-between;gap:14px;align-items:baseline;flex-wrap:wrap}.learning-entry small,.learning-entry header>span{font-size:12px;color:var(--muted,#aaa8b7);overflow-wrap:anywhere}.learning-entry header small{margin-left:8px}.learning-entry p{margin:0;line-height:1.8;white-space:pre-wrap;overflow-wrap:anywhere}.learning-entry-actions{display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap}.learning-rule{font-weight:500}.learning-delete-confirm{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.learning-delete-confirm p{flex-basis:100%}
.creative-learning details{padding:12px 14px;border:1px solid var(--border,#454251);border-radius:8px;min-width:0}.creative-learning summary{cursor:pointer}.creative-learning pre{white-space:pre-wrap;overflow-wrap:anywhere;font-family:inherit;font-size:12px;line-height:1.8;max-height:220px;overflow:auto}.creative-learning details>p{font-size:12px;margin:12px 0}.learning-history-row{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;margin-top:12px;font-size:12px;line-height:1.7}.learning-history-row span{overflow-wrap:anywhere}.learning-history-row button{flex-shrink:0}
.learning-empty{padding:24px 16px;text-align:center;color:var(--muted,#aaa8b7);line-height:1.8;border:1px dashed var(--border,#454251);border-radius:8px}.learning-error{color:#ffb5b5;margin:0;line-height:1.7}.learning-message{color:#a9ddc9;margin:0;line-height:1.7}.creative-learning button:focus-visible,.creative-learning select:focus-visible,.creative-learning textarea:focus-visible{outline:2px solid var(--accent,#c49aff);outline-offset:3px}
@media(max-width:850px){.learning-intro,.learning-submit{align-items:stretch;flex-direction:column}.learning-intro>button{align-self:flex-start}.learning-submit>button{align-self:flex-end}.learning-history-row{flex-wrap:wrap}}
</style>
