<script setup>
import {computed,inject,ref,watch} from 'vue';
import I from './Icon.vue';
import Modal from './Modal.vue';
import {call} from '../api';
import {promptCatalog,resolvePrompt} from '../../server/prompt-catalog.mjs';
const {state,busy,act,notify}=inject('studio');
const type=ref('copy'),editing=ref(null),deleting=ref(null),error=ref(''),titleText=ref('');
const all=computed(()=>promptCatalog(state.value));
const entries=computed(()=>all.value.filter(p=>p.type===type.value));
const current=computed(()=>resolvePrompt(type.value==='title'?'title':'rewrite',state.value));
watch([()=>type.value,()=>current.value.id,()=>current.value.content],()=>{titleText.value=current.value.content;error.value='';},{immediate:true});
function open(item){error.value='';editing.value=item?JSON.parse(JSON.stringify({...item,...(item.builtin?{id:undefined,name:item.name+'（副本）',active:false,derivedFrom:{id:item.id,...item.source}}:{})})):{name:'',description:'',type:type.value,content:'',model:'',active:false};delete editing.value.builtin;}
async function operation(label,action,payload){error.value='';return act(label,async()=>{try{return await call(action,payload);}catch(e){error.value=e.message.replace(/^Error invoking remote method '[^']+': Error: /,'');throw Error(error.value);}});}
async function save(){const item=editing.value;if(!item.name?.trim()||!item.content?.trim()){error.value='请填写提示词名称和内容';return;}if(await operation('保存提示词','saveResource',{type:'prompt',item})){editing.value=null;notify('提示词已保存','success');}}
async function activate(item){if(await operation('设置当前提示词','activatePrompt',{id:item.id}))notify('当前'+(item.type==='copy'?'文案':'标题')+'提示词已切换','success');}
async function remove(){if(await operation('删除提示词','deleteResource',{type:'prompt',id:deleting.value.id})){deleting.value=null;notify('提示词已删除','success');}}
async function saveTitle(){const item=current.value;if(!titleText.value.trim()){error.value='请填写标题提示词';return;}const value={...item,content:titleText.value,active:true,...(item.builtin?{id:undefined,name:'我的标题写作提示词',derivedFrom:{id:item.id,...item.source}}:{})};delete value.builtin;if(await operation('保存标题提示词','saveResource',{type:'prompt',item:value}))notify('标题提示词已保存，手动与自动封面标题均使用此模板','success');}
</script>
<template>
 <div class="prompt-manager">
  <nav class="prompt-type-tabs" aria-label="提示词用途"><button :class="{active:type==='copy'}" :aria-pressed="type==='copy'" @click="type='copy'"><I name="PencilLine" :size="16"/>文案写作提示词</button><button :class="{active:type==='title'}" :aria-pressed="type==='title'" @click="type='title'"><I name="Type" :size="16"/>标题写作提示词</button></nav>
  <p v-if="error&&!editing&&!deleting" class="prompt-error" role="alert">{{error}}</p>
  <section v-if="type==='title'" class="prompt-title-editor">
   <h3><I name="Lightbulb" :size="24"/>标题生成提示词</h3><p>用于AI自动生成视频标题的提示词模板</p>
   <label class="sr-only" for="title-prompt-content">标题提示词内容</label><textarea id="title-prompt-content" v-model="titleText" aria-label="标题提示词内容" maxlength="500"/><span class="prompt-count">{{titleText.length}} / 500</span>
   <p class="prompt-advice"><I name="Lightbulb" :size="16"/>提示：可以在提示词中使用 {content} 占位符代表原始内容</p><p class="prompt-advice">建议：明确标题的长度要求和风格特点</p>
   <button class="primary prompt-title-save" :disabled="!!busy" @click="saveTitle"><I name="Save" :size="16"/>保存标题提示词</button>
   <p class="hint">当前：{{current.name}} · {{current.model||'沿用模型设置'}}</p>
  </section>
  <template v-else>
   <section class="prompt-current"><div class="card-heading"><h3><I name="CheckCircle2" :size="22"/>当前使用</h3><button class="primary" :disabled="!!busy" @click="open()"><I name="Plus" :size="16"/>新增提示词</button></div><strong>{{current.name}}</strong><p>{{current.description||'用于文案改写与创作'}}</p><p class="hint">新任务默认使用此模板；已有任务保留各自所选模板。</p><p class="prompt-current-preview">{{current.content}}</p></section>
   <div class="prompt-list-heading"><h3><I name="List" :size="20"/>所有提示词</h3><span class="badge">共 {{entries.length}} 个</span></div>
   <div class="prompt-catalog-grid"><article v-for="item in entries" :key="item.id" class="prompt-entry"><h4>{{item.name}}</h4><p class="prompt-description">{{item.description||'自定义写作提示词'}}</p><p class="prompt-entry-preview">{{item.content}}</p><p class="prompt-meta"><span>{{item.builtin?'内置模板':'自定义模板'}}{{item.purposes?' · 仅改写':''}}</span><span>{{item.model||'沿用模型设置'}}</span></p><footer><button class="primary" :disabled="!!busy||current.id===item.id" @click="activate(item)"><I name="Star" :size="15"/>{{current.id===item.id?'当前使用':'设为当前'}}</button><button :disabled="!!busy" @click="open(item)"><I name="PencilLine" :size="15"/>{{item.builtin?'复制编辑':'编辑'}}</button><button class="danger" :disabled="!!busy||item.builtin||item.id==='default'" @click="error='';deleting=item"><I name="Trash2" :size="15"/>删除</button></footer></article></div>
  </template>
  <Modal v-if="editing" title="编辑提示词" variant="prompt-editor" @close="editing=null"><div class="prompt-edit-fields"><label>提示词名称<input v-model="editing.name" aria-label="提示词名称" maxlength="80"/></label><label>提示词描述<input v-model="editing.description" aria-label="提示词描述" maxlength="500"/></label><label>提示词内容<textarea v-model="editing.content" aria-label="提示词内容" :maxlength="editing.type==='title'?500:2000"/></label><span class="prompt-count">{{editing.content.length}} / {{editing.type==='title'?500:2000}}</span><label>执行模型<input v-model="editing.model" aria-label="提示词执行模型" maxlength="128" placeholder="留空沿用模型设置"/></label><p class="hint">填写已配置服务支持的真实模型名称。</p><details class="prompt-detail"><summary>高级设置与来源</summary><label v-if="editing.type==='copy'">适用范围<select :value="editing.purposes?'rewrite':'all'" aria-label="提示词适用范围" @change="editing.purposes=$event.target.value==='rewrite'?['rewrite']:undefined"><option value="all">文案改写与创作</option><option value="rewrite">仅原文改写</option></select></label><p v-if="editing.derivedFrom" class="hint">来源：{{editing.derivedFrom.version?'原软件 '+editing.derivedFrom.version+' 可见模板':'已有模板'}}；编辑后保存为独立副本。</p></details><p v-if="error" class="prompt-error" role="alert">{{error}}</p></div><template #footer><button :disabled="!!busy" @click="editing=null">取消</button><button class="primary" :disabled="!!busy" @click="save">保存提示词</button></template></Modal>
  <Modal v-if="deleting" title="删除提示词" @close="deleting=null"><p>确认删除“{{deleting.name}}”？正在使用的提示词需先解除任务引用。</p><p v-if="error" class="prompt-error" role="alert">{{error}}</p><template #footer><button :disabled="!!busy" @click="deleting=null">取消</button><button class="danger" :disabled="!!busy" @click="remove">确认删除</button></template></Modal>
 </div>
</template>
