<script setup>
import {computed,inject,onUnmounted,ref,watch} from 'vue';
import I from './Icon.vue';
import Modal from './Modal.vue';
import {call,mediaUrl,pickFiles} from '../api';
const {state,draft,busy,act,refresh,notify,showDialog}=inject('studio');
const search=ref(''),category=ref('全部素材'),filter=ref('all'),page=ref(1),selected=ref([]),detail=ref(null),preview=ref(null),editing=ref(false),description=ref(''),detailError=ref(''),saving=ref(false),deleting=ref([]),newCategory=ref(false),categoryName=ref('');
const wizard=ref(0),uploadCategory=ref(''),uploadIds=ref([]),descriptions=ref({}),uploadErrors=ref({}),processing=ref(false),stopped=ref(false),importing=ref(false),activeAsset=ref('');
let mounted=true;onUnmounted(()=>{mounted=false;stopped.value=true;});
const library=computed(()=>state.value.assets.filter(a=>['image','video'].includes(a.type)));
const filtered=computed(()=>library.value.filter(a=>(category.value==='全部素材'||a.category===category.value)&&(filter.value==='all'||a.type===filter.value)&&[a.name,a.description,...(a.tags||[])].join(' ').toLowerCase().includes(search.value.toLowerCase())));
const pages=computed(()=>Math.max(1,Math.ceil(filtered.value.length/12))),visible=computed(()=>filtered.value.slice((page.value-1)*12,page.value*12)),uploads=computed(()=>uploadIds.value.map(id=>state.value.assets.find(a=>a.id===id)).filter(Boolean));
const analysisRun=computed(()=>state.value.runs.find(r=>r.type==='material-analysis'&&r.status==='running'));
const marked=computed(()=>uploads.value.filter(a=>a.description?.trim()).length);
watch([search,category,filter],()=>{page.value=1;selected.value=[];});
watch(pages,n=>{page.value=Math.min(page.value,n);});
const size=a=>(a.size/1024/1024).toFixed(2)+' MB';
const duration=a=>{const n=Number(a.duration||a.analysis?.duration||0);return Math.floor(n/60)+':'+String(Math.floor(n%60)).padStart(2,'0');};
const status=a=>a.description?.trim()?'已标记':'未标记';
const errorText=e=>String(e.message||e).replace(/^Error invoking remote method '[^']+': Error: /,'');
function toggle(id){selected.value=selected.value.includes(id)?selected.value.filter(x=>x!==id):[...selected.value,id];}
function selectAll(){selected.value=visible.value.every(a=>selected.value.includes(a.id))?selected.value.filter(id=>!visible.value.some(a=>a.id===id)):[...new Set([...selected.value,...visible.value.map(a=>a.id)])];}
async function openDetail(a){try{detail.value=await call('materialDetail',{assetId:a.id});description.value=detail.value.description||'';editing.value=false;detailError.value='';}catch(e){notify(errorText(e),'error');}}
async function saveDescription(){saving.value=true;detailError.value='';try{await call('updateAsset',{id:detail.value.id,description:description.value});await refresh();await openDetail(detail.value);notify('素材描述已保存','success');}catch(e){detailError.value=errorText(e);}finally{saving.value=false;}}
async function analyze(a){
 const initial=descriptions.value[a.id]??a.description??'',detailInitial=detail.value?.id===a.id?description.value:null;
 const result=await act('素材视觉标记',async()=>{
  const result=await call('analyzeMaterial',{id:draft.value.id,assetId:a.id});
  if(!mounted)return result;
  const changed=(descriptions.value[a.id]??a.description??'')!==initial||(detailInitial!==null&&detail.value?.id===a.id&&description.value!==detailInitial);
  if(result.stale||changed){notify('描述已编辑，模型结果保留在执行记录，未覆盖当前内容');return {...result,stale:true};}
  await call('applyMaterialAnalysis',{runId:result.runId});descriptions.value[a.id]=result.description;
  if(detail.value?.id===a.id){detail.value=await call('materialDetail',{assetId:a.id});description.value=detail.value.description;}
  return result;
 });
 if(result&&!result.stale){delete uploadErrors.value[a.id];notify('素材标记已保存，向量化尚未完成','success');}
 return result;
}
async function stop(){stopped.value=true;try{if(analysisRun.value)await call('cancelRun',{id:analysisRun.value.id});await refresh();}catch(e){notify(errorText(e),'error');}}
function startUpload(){wizard.value=1;uploadIds.value=[];descriptions.value={};uploadErrors.value={};uploadCategory.value=category.value==='全部素材'?'':category.value;}
async function importFiles(files){if(importing.value)return;importing.value=true;try{
 const list=[];
 if(files){
  const candidates=[...files];
  // 整批先校验，防止混入不支持文件后，已有异步导入悄悄变成列表外素材。
  for(const file of candidates){if(!/\.(mp4|mov|mkv|avi|webm|jpe?g|png|webp)$/i.test(file.name))throw Error('请选择支持的图片或视频文件');if(file.size>180000000)throw Error('拖放文件超过180MB，请使用文件选择器');}
  for(const file of candidates){const data=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result.split(',')[1]);r.onerror=reject;r.readAsDataURL(file);});const a=await call('importFile',{name:file.name,base64:data});list.push(a);uploadIds.value=[...new Set([...uploadIds.value,a.id])];}
 }else list.push(...await pickFiles('visual'));
 uploadIds.value=[...new Set([...uploadIds.value,...list.filter(a=>['image','video'].includes(a.type)).map(a=>a.id)])];await refresh();
 }catch(e){notify(errorText(e),'error');await refresh();}finally{importing.value=false;}}
async function next(){
 if(!uploadCategory.value||!uploadIds.value.length){notify('请先选择分类和图片或视频');return;}
 try{
  await refresh();
  for(const a of uploads.value){await call('updateAsset',{id:a.id,category:uploadCategory.value});descriptions.value[a.id]=a.description||'';}await refresh();wizard.value=2;stopped.value=false;processing.value=true;
  for(const a of uploads.value){if(stopped.value||!mounted)break;if(a.description?.trim())continue;activeAsset.value=a.id;const r=await analyze(a);if(!r)uploadErrors.value[a.id]='自动标记未完成，可编辑描述或重新标记';}
 }catch(e){notify(errorText(e),'error');}finally{activeAsset.value='';processing.value=false;}
}
async function finish(){saving.value=true;try{for(const a of uploads.value)await call('updateAsset',{id:a.id,description:descriptions.value[a.id]??a.description??'',category:uploadCategory.value});await refresh();wizard.value=0;showDialog('素材已保存','已保存 '+uploads.value.length+' 项素材及描述。向量化未完成，不能用于向量自动匹配。');}catch(e){notify(errorText(e),'error');}finally{saving.value=false;}}
async function createCategory(){const name=categoryName.value.trim();if(!name)return;const r=await act('新建分类',()=>call('addCategory',{name}));if(r){if(wizard.value)uploadCategory.value=name;else category.value=name;newCategory.value=false;categoryName.value='';}}
async function remove(){const failures=[];for(const a of deleting.value){try{await call('deleteAsset',{id:a.id});selected.value=selected.value.filter(id=>id!==a.id);if(detail.value?.id===a.id)detail.value=null;}catch(e){failures.push(a.name+'：'+errorText(e));}}deleting.value=[];await refresh();if(failures.length)showDialog('部分素材未删除',failures.join('\n'));else notify('素材已删除','success');}
async function reveal(){try{if(window.studio?.revealAsset)await window.studio.revealAsset(detail.value.id);else notify('文件位置：'+detail.value.path);}catch(e){notify(errorText(e),'error');}}
</script>
<template>
<section class="management-page assets-page material-library">
 <header class="management-title"><div><h1>{{wizard?'上传视频或图片素材':'素材管理'}}</h1><p>{{wizard?'选择文件、标记信息并保存素材':'管理视频素材的分类、上传、标记和向量状态'}}</p></div><button class="text-button" @click="showDialog('素材管理','图片和视频可在本地保存；视觉标记需要已有视觉模型。标记与向量化分别处理，当前未接入嵌入模型。')"><I name="HelpCircle" :size="16"/>帮助</button></header>
 <template v-if="!wizard">
  <div class="toolbar asset-main-toolbar"><button @click="newCategory=true"><I name="Plus" :size="17"/>新建分类</button><button class="primary" @click="startUpload"><I name="Upload" :size="17"/>上传视频或图片</button><div class="spacer"></div><div class="search"><input v-model="search" placeholder="搜索素材..." aria-label="搜索素材"/><I name="Search" :size="20"/></div></div>
  <div class="asset-management"><aside class="card category-nav"><header><h3>分类管理</h3><button class="icon-button" aria-label="刷新素材分类" @click="refresh()"><I name="RefreshCw" :size="18"/></button></header><button v-for="c in state.categories" :key="c" :class="{active:category===c}" @click="category=c"><span>{{c}}</span><span class="category-count">{{library.filter(a=>c==='全部素材'||a.category===c).length}}</span></button></aside>
   <article class="card asset-content"><header class="asset-content-heading"><label class="check-row"><input type="checkbox" aria-label="全选本页素材" :checked="!!visible.length&&visible.every(a=>selected.includes(a.id))" @change="selectAll"/>全选</label><button v-if="selected.length" class="text-button danger" @click="deleting=library.filter(a=>selected.includes(a.id))">删除 {{selected.length}} 项</button><div class="segmented"><button v-for="[id,label] in [['all','全部'],['video','视频'],['image','图片']]" :key="id" :class="{active:filter===id}" @click="filter=id">{{label}}</button></div><button class="icon-button" aria-label="刷新素材" @click="refresh()"><I name="RefreshCw" :size="18"/></button></header>
    <div v-if="visible.length" class="asset-grid material-grid"><article v-for="a in visible" :key="a.id" class="asset-card material-card"><div class="material-visual"><input type="checkbox" :aria-label="'选择素材 '+a.name" :checked="selected.includes(a.id)" @change="toggle(a.id)"/><button class="material-play" :aria-label="'预览素材 '+a.name" @click="preview=a"><img v-if="a.type==='image'" :src="mediaUrl(a.id)" alt="" loading="lazy"/><video v-else :src="mediaUrl(a.id)+'#t=0.1'" preload="metadata" muted/><I v-if="a.type==='video'" name="Play" :size="30"/></button><span class="material-status" :class="{'is-marked':a.description}">{{status(a)}}</span><small v-if="a.type==='video'">{{duration(a)}}</small></div><strong :title="a.name">{{a.name}}</strong><p class="material-description">{{a.description||'尚未填写素材描述'}}</p><footer><span>{{a.category}}</span><button :aria-label="'素材详情 '+a.name" @click="openDetail(a)">详情</button><button class="icon-button" :aria-label="'删除素材 '+a.name" @click="deleting=[a]"><I name="Trash2" :size="16"/></button></footer></article></div>
    <div v-else class="empty-state"><I name="FolderOpen" :size="48"/><h3>暂无素材</h3><p>{{search?'没有符合搜索条件的素材':'上传视频或图片，标记内容后用于创作。'}}</p><button class="primary" @click="startUpload">上传视频或图片</button></div>
    <footer class="material-pagination"><span>共 {{filtered.length}} 条</span><button aria-label="素材上一页" :disabled="page===1" @click="page--"><I name="ChevronLeft" :size="16"/></button><span class="material-page-number">{{page}}</span><button aria-label="素材下一页" :disabled="page===pages" @click="page++"><I name="ChevronRight" :size="16"/></button><span>12 条/页</span></footer>
   </article></div>
 </template>
 <template v-else>
  <div class="material-steps"><div :class="{active:wizard===1}"><b>{{wizard===2?'✓':'1'}}</b><span>选择视频或图片<small>选择文件和分类</small></span></div><i></i><div :class="{active:wizard===2}"><b>2</b><span>标记与处理<small>标记信息并保存素材</small></span></div></div>
  <article class="material-upload-panel"><header><h2>{{wizard===1?'上传视频文件':'标记视频信息'}}</h2><p>{{wizard===1?'选择文件并指定分类':'为素材添加描述，便于后续搜索和管理'}}</p><p v-if="wizard===2" class="hint">视频按三个时间点采样分析，描述可以手动修改；标记后仍未向量化。</p></header>
   <template v-if="wizard===1"><div class="material-category-field"><label>选择分类<select v-model="uploadCategory" aria-label="上传素材分类"><option value=""></option><option v-for="c in state.categories.filter(c=>c!=='全部素材')" :key="c">{{c}}</option></select></label><button class="text-button" @click="newCategory=true"><I name="Plus" :size="18"/>新建分类</button></div><button class="material-dropzone" :disabled="importing" @click="importFiles()" @dragover.prevent @drop.prevent="importFiles($event.dataTransfer.files)"><I name="Inbox" :size="48"/><strong>{{importing?'正在导入…':'点击或拖拽文件到此区域'}}</strong><span>支持mp4、avi、mov、mkv等视频格式，以及jpg/png图片；支持批量上传</span></button><ul v-if="uploads.length" class="material-file-list"><li v-for="a in uploads" :key="a.id"><I :name="a.type==='video'?'Video':'Image'" :size="18"/><span>{{a.name}}</span><small>{{size(a)}}</small><button class="icon-button" :aria-label="'移出本次上传 '+a.name" @click="uploadIds=uploadIds.filter(id=>id!==a.id)"><I name="X" :size="17"/></button></li></ul></template>
   <template v-else><div class="material-marking-count"><strong>已标记 {{marked}} / {{uploads.length}}</strong><button v-if="processing" @click="stop">停止标记</button></div><article v-for="a in uploads" :key="a.id" class="material-marking-card" :class="{'is-marked':a.description}"><div class="material-marking-preview"><video v-if="a.type==='video'" :src="mediaUrl(a.id)" controls preload="metadata"/><img v-else :src="mediaUrl(a.id)" alt="待标记素材"/><strong>{{a.name}}</strong><small>{{duration(a)}} · {{size(a)}}</small></div><div class="material-marking-editor"><label :for="'material-description-'+a.id"><I name="FileText" :size="15"/>{{a.type==='video'?'视频描述':'图片描述'}}</label><textarea :id="'material-description-'+a.id" v-model="descriptions[a.id]" :aria-label="'素材描述 '+a.name" maxlength="500" :placeholder="activeAsset===a.id?'正在分析采样画面…':'填写描述或重新进行视觉标记'"></textarea><small>{{(descriptions[a.id]||'').length}} / 500</small><p v-if="uploadErrors[a.id]" class="material-error">{{uploadErrors[a.id]}}</p><button :disabled="!!busy||processing" @click="analyze(a)">{{a.description?'重新标记':'AI自动标记'}}</button></div></article></template>
   <footer><button :disabled="processing||saving" @click="wizard=wizard===1?0:1">{{wizard===1?'返回':'上一步'}}</button><button v-if="wizard===1" class="primary" :disabled="!!busy||importing" @click="next">下一步</button><button v-else class="primary" :disabled="!!busy||processing||saving" @click="finish">保存素材并完成</button></footer>
  </article>
 </template>
</section>
<Modal v-if="detail" title="素材详情" variant="material-detail" @close="detail=null"><section class="material-info"><header><I name="File" :size="16"/><h3>基本信息</h3></header><dl><dt>文件名</dt><dd class="full">{{detail.name}}</dd><dt>文件路径</dt><dd class="full"><code>{{detail.path}}</code></dd><dt>文件大小</dt><dd>{{size(detail)}}</dd><dt>视频时长</dt><dd>{{detail.type==='video'?duration(detail):'图片'}}</dd><dt>上传时间</dt><dd>{{new Date(detail.createdAt).toLocaleString('zh-CN',{hour12:false})}}</dd><dt>状态</dt><dd><span class="material-status">{{status(detail)}}</span></dd><dt>所属分类</dt><dd class="full"><span class="material-code">{{detail.category}}</span></dd><dt>素材ID</dt><dd class="full"><code class="material-code">{{detail.id}}</code></dd><dt>向量ID</dt><dd class="full"><span class="material-code">未向量化</span><button class="text-button" @click="showDialog('向量化未配置','当前没有已验证的嵌入模型服务。描述已经保存，向量索引与自动语义混剪尚未完成。')">向量化</button></dd></dl></section><section class="material-detail-description"><header><h3><I name="FileText" :size="16"/>{{detail.type==='video'?'视频描述':'图片描述'}}</h3><div><button v-if="!editing" class="text-button" @click="editing=true;description=detail.description||''"><I name="PencilLine" :size="16"/>修改</button><template v-else><button class="text-button" :disabled="saving" @click="editing=false;description=detail.description||''">取消</button><button class="text-button" :disabled="saving" @click="saveDescription">保存</button></template></div></header><template v-if="editing"><textarea v-model="description" aria-label="编辑素材描述" maxlength="500"></textarea><small class="material-count">{{description.length}} / 500</small></template><p v-else class="material-description-full">{{detail.description||'尚未标记，可使用已有视觉模型分析或手动填写。'}}</p><p v-if="detailError" class="material-error">{{detailError}}</p><div class="material-analysis-tools"><button :disabled="!!busy" @click="analyze(detail)">{{detail.description?'重新分析画面':'AI标记画面'}}</button><span v-if="detail.descriptionSource==='manual'" class="hint">手动编辑</span><span v-else-if="detail.analysis" class="hint">{{detail.analysis.frameCount}} 张采样 · {{detail.analysis.model}}</span></div></section><template #footer><button class="primary" @click="reveal"><I name="FolderOpen" :size="16"/>打开文件位置</button><button :disabled="!!busy" @click="deleting=[detail]"><I name="Trash2" :size="16"/>删除素材</button><button @click="detail=null">关闭</button></template></Modal>
<Modal v-if="newCategory" title="新建分类" variant="resource" @close="newCategory=false"><label>分类名称<input v-model="categoryName" aria-label="分类名称" maxlength="30" @keyup.enter="createCategory"/></label><template #footer><button @click="newCategory=false">取消</button><button class="primary" :disabled="!!busy||!categoryName.trim()" @click="createCategory">确定</button></template></Modal>
<Modal v-if="preview" :title="preview.name" wide @close="preview=null"><video v-if="preview.type==='video'" class="material-preview-player" :src="mediaUrl(preview.id)" controls autoplay/><img v-else class="material-preview-player" :src="mediaUrl(preview.id)" alt="素材预览"/></Modal>
<Modal v-if="deleting.length" title="确认删除素材" @close="deleting=[]"><p>删除选中的 {{deleting.length}} 项素材？被任务引用的素材需要先解除引用。</p><template #footer><button @click="deleting=[]">取消</button><button class="danger-button" @click="remove">删除</button></template></Modal>
</template>
