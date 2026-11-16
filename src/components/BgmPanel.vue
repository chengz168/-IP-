<script setup>
import {computed,inject,onMounted,onBeforeUnmount,ref,watch} from 'vue';
import ASegmented from 'ant-design-vue/es/segmented';
import ACollapse,{CollapsePanel as ACollapsePanel} from 'ant-design-vue/es/collapse';
import AButton from 'ant-design-vue/es/button';
import AInput from 'ant-design-vue/es/input';
import AEmpty from 'ant-design-vue/es/empty';
import ASpin from 'ant-design-vue/es/spin';
import {call,pickFiles} from '../api';
import {bgmSelection,bgmSummary} from '../../server/bgm-model.mjs';
const {draft:d,state,busy,notify,refresh}=inject('studio');
const groups=ref([]),loading=ref(true),error=ref(''),previewing=ref(''),pending=ref(''),audio=ref(null);
const selection=computed(()=>bgmSelection(d.value.edit)),summary=computed(()=>bgmSummary(d.value.edit,state.value.assets));
const selected=computed(()=>state.value.assets.find(asset=>asset.id===selection.value.assetId));
const sourceOptions=[{label:'系统库',value:'system'},{label:'本地上传',value:'upload'}];
let player,previewUrl,sequence=0;
function stop(){sequence++;if(player){player.pause();player.removeAttribute('src');player.load();player=null;}if(previewUrl){URL.revokeObjectURL(previewUrl);previewUrl=null;}previewing.value='';}
watch([()=>d.value.id,()=>d.value.edit.bgmEnabled,()=>selection.value.source],stop);
onBeforeUnmount(stop);
onMounted(async()=>{try{groups.value=await call('listBgmResources');}catch(e){error.value=e.message;}finally{loading.value=false;}});
async function choose(file){
 if(busy.value||pending.value)return;error.value='';
 if(!file){d.value.edit.bgmEnabled=true;d.value.edit.bgmSource='system';d.value.edit.bgmId='';d.value.edit.bgmResourceId='';return;}
 const draftId=d.value.id;pending.value=file.id;
 try{const asset=await call('selectBgmResource',{resourceId:file.id});await refresh();if(d.value.id!==draftId)return;d.value.edit.bgmEnabled=true;d.value.edit.bgmSource='system';d.value.edit.bgmId=asset.id;d.value.edit.bgmResourceId=file.id;}
 catch(e){error.value=e.message;}finally{pending.value='';}
}
async function upload(){
 if(busy.value||pending.value)return;const draftId=d.value.id;pending.value='upload';error.value='';
 try{const assets=await pickFiles('music',{multiple:false});await refresh();if(assets.length&&d.value.id===draftId){d.value.edit.bgmEnabled=true;d.value.edit.bgmSource='upload';d.value.edit.bgmId=assets[0].id;d.value.edit.bgmResourceId='';notify('背景音乐选择成功','success');}}
 catch(e){error.value=e.message;}finally{pending.value='';}
}
async function preview(file){
 if(previewing.value===file.id){stop();return;}
 stop();const token=sequence;previewing.value=file.id;error.value='';
 try{const result=await call('previewBgmResource',{resourceId:file.id});if(token!==sequence)return;const [head,data]=result.url.split(','),mime=/^data:(audio\/[\w.+-]+);base64$/.exec(head)?.[1];if(!mime)throw Error('音乐试听数据格式无效');const bytes=Uint8Array.from(atob(data),character=>character.charCodeAt(0));previewUrl=URL.createObjectURL(new Blob([bytes],{type:mime}));player=audio.value;player.src=previewUrl;player.volume=0.5;player.onended=()=>{if(token===sequence)stop();};player.onerror=()=>{if(token===sequence){stop();error.value='音乐试听失败，请检查系统音频设备或音乐文件';}};await player.play();}
 catch(e){if(token===sequence){stop();error.value=e.message;}}
}
</script>
<template>
 <div class="bgm-editor"><audio ref="audio" class="bgm-preview-audio" preload="metadata" hidden/><header><h3>背景音乐</h3><p>{{summary}}</p></header>
  <div class="bgm-editor-scroll"><div class="bgm-panel">
   <div class="seg-row"><span>音乐来源</span><ASegmented :value="selection.source" :options="sourceOptions" :disabled="!!busy||!!pending" @update:value="d.edit.bgmSource=$event"/></div>
   <div v-if="selection.source==='upload'" class="upload-row"><AInput :value="selected?.name||''" :title="selected?.name" placeholder="选择本地音乐文件" aria-label="本地音乐文件" readonly/><AButton :disabled="!!busy||!!pending" :loading="pending==='upload'" @click="upload">上传</AButton></div>
   <div v-else class="library"><button class="bgm-item ai-bgm-item" :class="{active:selection.auto}" :aria-pressed="selection.auto" :disabled="!!busy||!!pending" @click="choose(null)"><span>AI 自动匹配</span><small>根据文案选择系统音乐</small></button>
    <ASpin :spinning="loading"><ACollapse v-if="groups.length" ghost accordion>
     <ACollapsePanel v-for="group in groups" :key="group.name" :header="group.name"><div v-for="file in group.files" :key="file.id" class="bgm-item" :class="{active:selection.resourceId===file.id}">
      <button class="bgm-track-select" :title="file.name" :aria-pressed="selection.resourceId===file.id" :disabled="!!busy||!!pending" @click="choose(file)">{{file.name}}</button><AButton size="small" type="text" :aria-label="(previewing===file.id?'暂停':'试听')+file.name" @click.stop="preview(file)">{{previewing===file.id?'暂停':'试听'}}</AButton>
     </div></ACollapsePanel>
    </ACollapse><AEmpty v-else description="暂无系统音乐"/></ASpin>
   </div>
  </div><p v-if="error" class="bgm-error" role="alert">{{error}}</p></div>
 </div>
</template>
