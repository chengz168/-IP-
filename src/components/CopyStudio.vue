<script setup>
import {computed,inject,ref,watch,useId,nextTick} from 'vue';
import I from './Icon.vue';
import Modal from './Modal.vue';
import WordLimit from './WordLimit.vue';
import DropdownSelect from './DropdownSelect.vue';
import {call} from '../api';
import {promptsFor,resolvePrompt} from '../../server/prompt-catalog.mjs';
import {copyInputMatches} from '../../server/copy-input.mjs';
import {assessCandidates} from '../../server/content-quality.mjs';
const props=defineProps({kind:String});
const {state,draft:d,busy,act,refresh,notify}=inject('studio');
const dialog=ref(''),selectedTopic=ref(null),selectedCopy=ref(0),error=ref(''),topicsPanel=ref(null);
const errorId=useId();
const topicGroupId=useId();
const marketingTemplate=computed({get:()=>resolvePrompt('marketing',state.value,d.value.template).id,set:id=>d.value.template=id});
const marketingTemplates=computed(()=>promptsFor('marketing',state.value).map(p=>({value:p.id,label:p.name})));
const results=computed(()=>d.value.copyStudio?.[props.kind]);
const topics=computed(()=>results.value?.topics);
const candidates=computed(()=>results.value?.candidates);
const topicsValid=computed(()=>copyInputMatches(topics.value,d.value,'topic',state.value));
const candidatesValid=computed(()=>copyInputMatches(candidates.value,d.value,props.kind,state.value,true)&&(props.kind!=='topic'||candidates.value?.topicId===topics.value?.id));
const topicItem=computed(()=>topics.value?.items[selectedTopic.value]);
const candidateQuality=computed(()=>candidates.value?assessCandidates(candidates.value.input,candidates.value.items)[selectedCopy.value]:null);
const personas=['老板型IP','专家型IP','顾问型IP','创始人IP','创业者IP','从业者经验派','普通人逆袭','避坑顾问型','知识科普型','测评种草型'];
watch([()=>d.value.id,()=>props.kind],()=>{dialog.value='';selectedTopic.value=null;selectedCopy.value=0;error.value='';});
watch(()=>topics.value?.id,()=>{selectedTopic.value=null;});
function valid(){error.value='';if(props.kind==='topic'&&!d.value.topic.industry.trim()){error.value='请填写行业或产品';return false;}if(props.kind==='marketing'&&!d.value.marketing.name.trim()&&!d.value.marketing.selling.trim()){error.value='产品名称或卖点至少填写一项';return false;}return true;}
function wordValid(){if(!Number.isSafeInteger(Number(d.value.wordLimit))||Number(d.value.wordLimit)<=0){error.value='字数限制请输入正整数';return false;}return true;}
function failed(){const run=state.value.runs.find(r=>r.draftId===d.value.id&&r.type.startsWith('copy-'));error.value=run?.error||'操作未完成，请查看提示后重试';}
async function showTopics(){await nextTick();topicsPanel.value?.scrollIntoView({block:'nearest'});}
async function generateTopics(){if(!valid())return;const id=d.value.id,r=await act('生成五个爆款选题',()=>call('copyTopics',{id}));if(d.value.id!==id||props.kind!=='topic')return;if(r?.stale){error.value='创作资料或原文已经变化，本次结果保留在执行记录中，请重新生成';return;}if(!r){failed();return;}selectedTopic.value=null;await showTopics();}
async function generateCopies(){if(!valid()||!wordValid())return;if(props.kind==='topic'&&!topicsValid.value){error.value='创作资料已经变化，请先重新生成选题';return;}if(props.kind==='topic'&&!topicItem.value){error.value='请先勾选一个选题';return;}const id=d.value.id,kind=props.kind,r=await act(kind==='topic'?'生成两份选题文案':'生成三份营销文案',()=>call('copyCandidates',{id,kind,topicId:topics.value?.id,index:selectedTopic.value}));if(d.value.id!==id||props.kind!==kind)return;if(r?.stale){error.value='创作资料或原文已经变化，本次文案未覆盖已有候选，请重新生成';return;}if(!r){failed();return;}error.value='';selectedCopy.value=0;dialog.value='copies';}
function reopen(){error.value='';selectedCopy.value=0;if(props.kind==='topic'){if(candidates.value)selectedTopic.value=candidates.value.index;showTopics();}else dialog.value='copies';}
function backToTopics(){dialog.value='';error.value='';showTopics();}
async function useCopy(){const id=d.value.id,r=await act('使用候选文案',()=>call('useCopyCandidate',{id,kind:props.kind,candidateId:candidates.value.id,index:selectedCopy.value}));if(r){await refresh(d.value.id===id);dialog.value='';notify(['story','product'].includes(r.video.mode)?'文案已确认，已进入对应视频制作流程；如需修改可返回第二步。':'文案已确认，可直接生成声音；如需修改可返回第二步。','success');}}
function moveCopy(event){if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const count=candidates.value.items.length;selectedCopy.value=event.key==='Home'?0:event.key==='End'?count-1:(selectedCopy.value+(event.key==='ArrowRight'?1:count-1))%count;event.currentTarget.parentElement.children[selectedCopy.value]?.focus();}
</script>
<template>
 <div class="creation-section copy-studio">
  <article v-if="kind==='topic'" class="card creation-form topic-form">
   <label><span><b class="required">*</b> 行业或产品</span><input v-model="d.topic.industry" aria-label="行业或产品" :aria-invalid="!!error&&!d.topic.industry.trim()" :aria-describedby="error?errorId:undefined" maxlength="3000" placeholder="如：口腔诊所、装修公司、儿童护眼台灯"/></label>
   <div class="two-fields"><label><span>人设方向</span><DropdownSelect v-model="d.topic.persona" aria-label="人设方向" :options="personas"/></label><label><span>目标人群</span><input v-model="d.topic.audience" aria-label="选题目标人群" maxlength="3000" placeholder="选填，如：宝妈、中小企业老板"/></label></div>
   <label><span>我的人设</span><textarea v-model="d.topic.bio" aria-label="我的人设" maxlength="500" placeholder="介绍你的人设，比如身份、行业经验、表达风格等，最多500字。"/><small class="creation-field-count">{{d.topic.bio.length}} / 500</small></label>
   <p v-if="error" :id="errorId" class="copy-error" role="alert">{{error}}</p>
   <div class="creation-actions"><button v-if="topics" class="text-button copy-reopen" :disabled="!!busy" @click="reopen">查看上次选题</button><button class="primary" :disabled="!!busy" @click="generateTopics"><I name="Lightbulb" :size="16"/>生成爆款选题</button></div>
   <section v-if="topics" ref="topicsPanel" class="copy-topics-results" aria-label="爆款选题结果">
    <section class="copy-opportunity"><h3><I name="Lightbulb" :size="16"/>内容机会</h3><p>{{topics.opportunity}}</p></section>
    <div class="copy-topic-heading"><h3>爆款选题 <small>勾选一个选题，生成对应文案</small></h3><button class="text-button" :disabled="!!busy" @click="generateTopics"><I name="RefreshCw" :size="15"/>换一批</button></div>
    <p v-if="!topicsValid" class="copy-error" role="alert">创作资料或模板已经变化，请重新生成选题。</p>
    <div class="copy-topic-list" role="group" aria-label="五个爆款选题"><label v-for="(item,index) in topics.items" :key="index" class="copy-topic-card" :class="{selected:selectedTopic===index,disabled:!!busy||!topicsValid}"><input v-model="selectedTopic" type="radio" :name="topicGroupId" :value="index" :aria-label="item.title" :disabled="!!busy||!topicsValid"/><span class="copy-topic-content"><strong>{{index+1}}. {{item.title}}</strong><small>开头钩子：{{item.hook}}</small><small>人设角度：{{item.personaAngle}}</small></span><span class="copy-topic-select">{{selectedTopic===index?'已选中':'选择'}}</span></label></div>
    <div class="copy-topics-actions"><p class="copy-selected-topic" :title="topicItem?.title"><span>已选选题</span><strong>{{topicItem?.title||'请先勾选一个选题'}}</strong></p><WordLimit v-model="d.wordLimit"/><button v-if="candidates" :disabled="!!busy" @click="dialog='copies';selectedCopy=0">查看已生成文案</button><button class="primary" :disabled="!!busy||!topicsValid||!topicItem" @click="generateCopies"><I name="FileText" :size="16"/>生成该选题文案</button></div>
   </section>
  </article>
  <article v-else class="card creation-form marketing-form">
   <div class="two-fields"><label><span>写作模板</span><DropdownSelect v-model="marketingTemplate" aria-label="营销写作模板" :options="marketingTemplates"/></label><WordLimit v-model="d.wordLimit"/></div>
   <div class="two-fields"><label><span>产品名称</span><input v-model="d.marketing.name" aria-label="产品名称" maxlength="3000" :aria-describedby="error?errorId:undefined" placeholder="请输入产品名称"/></label><label><span>适用人群</span><input v-model="d.marketing.audience" aria-label="适用人群" maxlength="3000" placeholder="请输入适用人群"/></label></div>
   <div class="two-fields marketing-short-row"><label><span>产品卖点</span><textarea v-model="d.marketing.selling" aria-label="产品卖点" maxlength="3000" :aria-describedby="error?errorId:undefined" placeholder="请输入产品卖点"/></label><label><span>人设内容</span><input v-model="d.marketing.persona" aria-label="人设内容" maxlength="3000" placeholder="请输入人设内容"/></label></div>
   <label><span>优惠活动</span><input v-model="d.marketing.offer" aria-label="优惠活动" maxlength="3000" placeholder="请输入优惠活动"/></label>
   <p v-if="error" :id="errorId" class="copy-error" role="alert">{{error}}</p>
   <div class="creation-actions"><button v-if="candidates" class="text-button copy-reopen" :disabled="!!busy" @click="reopen">查看上次文案</button><button class="primary" :disabled="!!busy" @click="generateCopies"><I name="FileText" :size="16"/>创作文案</button></div>
  </article>
 </div>
 <Modal v-if="dialog==='copies'&&candidates" :title="kind==='topic'?'爆款选题文案':'自由创作文案'" variant="copy-candidates" wide @close="dialog=''">
  <p v-if="!candidatesValid" class="copy-error" role="alert">创作资料、模板或字数已经变化，当前候选仅供查看，请重新生成。</p>
  <div class="copy-candidate-grid" :style="{'--copy-count':candidates.items.length}" role="group" aria-label="候选文案"><button v-for="(item,index) in candidates.items" :key="index" class="copy-candidate-card" :class="{selected:selectedCopy===index}" :aria-pressed="selectedCopy===index" @click="selectedCopy=index" @keydown="moveCopy"><strong>方案 {{index+1}}</strong><span class="copy-candidate-text">{{item.text}}</span></button></div>
  <p v-if="candidateQuality?.issues.length" class="copy-error" role="alert">当前方案未通过检查：{{candidateQuality.issues.join('；')}}。请重新生成。</p><p v-else-if="candidateQuality?.warnings.length" class="copy-error" role="status">当前方案需复核：{{candidateQuality.warnings.join('；')}}</p>
  <p v-if="error" class="copy-error" role="alert">{{error}}</p>
  <template #footer><span class="copy-use-hint">选用后直接进入声音生成，可返回第二步修改</span><button v-if="kind==='topic'" @click="backToTopics">返回选题</button><button v-else :disabled="!!busy" @click="generateCopies">重新生成</button><button class="primary" :disabled="!!busy||!candidatesValid||candidateQuality?.status==='rejected'" @click="useCopy">使用此文案</button></template>
 </Modal>
</template>
