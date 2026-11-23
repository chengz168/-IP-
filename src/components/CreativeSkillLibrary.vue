<script setup>
import {computed,inject,ref} from 'vue';
import {creativeCatalog,creativeSources} from '../../server/creative-presets.mjs';
import {creativeStageNames,productionSkillCatalog} from '../../server/production-skills.mjs';
import CreativePresets from './CreativePresets.vue';
import Modal from './Modal.vue';
import '../creative-skills.css';
const {draft,state}=inject('studio');
const search=ref(''),stage=ref('all'),detail=ref(null),previewStage=ref('script');
const types=creativeCatalog().map(item=>({...item,kind:'type',label:'题材预设',execution:'prompt',summary:item.description}));
const methods=productionSkillCatalog().map(item=>({...item,kind:'method',label:'阶段技能',summary:item.description}));
const all=[...types,...methods];
const entries=computed(()=>all.filter(item=>(stage.value==='all'||item.stages.includes(stage.value))&&(!search.value.trim()||[item.name,item.summary,...item.stages.map(s=>creativeStageNames[s]),...Object.values(item.rules).flat()].join(' ').toLowerCase().includes(search.value.trim().toLowerCase()))));
const promptStages=Object.entries(creativeStageNames).filter(([key])=>!['voice','subtitles','compose','review'].includes(key));
const detailRules=computed(()=>!detail.value?[]:Array.isArray(detail.value.rules)?[{name:detail.value.stages.map(s=>creativeStageNames[s]).join('、'),rules:detail.value.rules},...Object.entries(detail.value.stageRules||{}).map(([stage,rules])=>({name:creativeStageNames[stage]+'补充规则',rules}))]:Object.entries(detail.value.rules).filter(([,rules])=>rules.length).map(([key,rules])=>({name:creativeStageNames[key],rules})));
const detailSources=computed(()=>detail.value?creativeSources.filter(s=>detail.value.sourceIds.includes(s.id)):[]);
const recent=computed(()=>state.value.runs?.find(run=>run.draftId===draft.value?.id&&run.output?.creativePreset&&run.output.modelExecuted!==false));
function clearFilters(){search.value='';stage.value='all';}
</script>
<template>
 <section class="creative-skill-library" aria-label="创作技能库">
  <div class="skill-library-intro"><div><h3>按内容选方法，按步骤调用</h3><p>已预置 {{types.length}} 类题材与 {{methods.length}} 项制作技能。生成时组合当前题材与本阶段方法，无需逐条复制提示词。</p></div><span class="badge">系统库 · 中文规则</span></div>
  <p class="skill-library-note">制作方法来自视频工厂及已核实许可的公开技能，已适配为中文阶段规则。选题、文案、改写、拆集、分镜、资产、图片和视频已接入；配音、字幕、剪辑与交付列为人工检查清单。规则参与请求不代表成片质量已通过。</p>
  <details v-if="draft?.id" class="skill-library-task"><summary>当前任务调用设置 · {{draft.title||'未命名任务'}}</summary><div class="skill-library-task-head"><h3>当前任务如何调用</h3><label>预览阶段<select v-model="previewStage" aria-label="预览技能调用阶段"><option v-for="[key,name] in promptStages" :key="key" :value="key">{{name}}</option></select></label></div><p>任务：{{draft.title||'未命名任务'}}。这里只修改本任务的选择与补充要求；系统库与已有确认稿保持独立。</p><CreativePresets :stage="previewStage"/><p v-if="recent" class="hint">最近生成记录：{{recent.output.creativePreset.name}} · {{creativeStageNames[recent.output.creativePreset.stage]||recent.output.creativePreset.stage}}<template v-if="recent.output.creativePreset.skills?.length"> · {{recent.output.creativePreset.skills.map(s=>s.name).join('、')}}</template></p></details>
  <div class="skill-library-filters"><label>搜索技能<input v-model="search" type="search" placeholder="例如：商品、连续性、自然停顿" aria-label="搜索创作技能"/></label><label>流程阶段<select v-model="stage" aria-label="筛选技能阶段"><option value="all">全部阶段</option><option v-for="(name,key) in creativeStageNames" :key="key" :value="key">{{name}}</option></select></label><span role="status">{{entries.length}} 项</span></div>
  <div v-if="entries.length" class="skill-library-grid"><article v-for="item in entries" :key="item.id" class="skill-library-card"><div class="skill-library-card-head"><h4>{{item.name}}</h4><span>{{item.execution==='checklist'?'检查清单':item.label}}</span></div><p>{{item.summary}}</p><div class="skill-library-tags"><span v-for="s in item.stages" :key="s">{{creativeStageNames[s]}}</span></div><footer><small>{{item.execution==='checklist'?'供审看使用，未自动执行':item.kind==='type'?'按内容推荐，可手动指定':'对应阶段自动组合调用'}}</small><button type="button" @click="detail=item" :aria-label="'查看'+item.name+'规则'">查看规则</button></footer></article></div>
  <div v-else class="skill-library-empty"><p>没有匹配的技能，请减少关键词或切换阶段。</p><button type="button" @click="clearFilters">清除筛选</button></div>

  <Modal v-if="detail" :title="detail.name" variant="skill-rule" wide @close="detail=null"><p class="skill-library-note">{{detail.summary}}</p><p>{{detail.execution==='checklist'?'此项是审看清单，不自动变更引擎参数或代替真实媒体审查。':'按适用阶段参与生成请求，服从已有事实、任务选择与输出格式。'}}</p><section v-for="group in detailRules" :key="group.name" class="skill-rule-group"><h3>{{group.name}}</h3><ol><li v-for="rule in group.rules" :key="rule">{{rule}}</li></ol></section><details class="skill-rule-source"><summary>来源与版本</summary><template v-if="detail.origin"><p>{{detail.origin.project}} · {{detail.version}}</p><p>{{detail.origin.usage}}</p><p>来源提交：<code>{{detail.origin.revision}}</code></p><p v-for="file in detail.origin.files" :key="file"><code>{{file}}</code></p><p>原技能标识：{{detail.sourceIds.join('、')}}</p></template><div v-for="source in detailSources" :key="source.id"><strong>{{source.name}}</strong><p>{{source.license}} · {{source.revision}}</p><code>{{source.url}}</code></div></details><template #footer><button class="primary" @click="detail=null">返回技能库</button></template></Modal>
 </section>
</template>
