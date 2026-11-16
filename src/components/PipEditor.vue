<script setup>
import {computed,inject,ref} from 'vue';
import Modal from './Modal.vue';
import I from './Icon.vue';
import {mediaUrl} from '../api';
const props=defineProps({captions:Array,saving:Boolean});
const emit=defineEmits(['close','confirm']);
const {state,importAssets,notify}=inject('studio');
// 分配只改弹窗副本，关闭或取消后原任务不会保留未确认的修改。
const rows=ref(JSON.parse(JSON.stringify(props.captions))),selected=ref(new Set()),anchor=ref(-1);
const tab=ref('library'),category=ref(''),chosenId=ref(''),importing=ref(false);
const assets=computed(()=>category.value?state.value.assets.filter(a=>['image','video'].includes(a.type)&&(category.value==='全部素材'||a.category===category.value)).slice().reverse():[]);
const chosen=computed(()=>state.value.assets.find(a=>a.id===chosenId.value));
const selectedSeconds=computed(()=>[...selected.value].reduce((sum,i)=>sum+Math.max(0,rows.value[i].end-rows.value[i].start),0));
const assigned=computed(()=>rows.value.filter(r=>r.pipId).length);
function assetName(id){return state.value.assets.find(a=>a.id===id)?.name||'素材失效，请重新选择';}
function timeLabel(seconds){const n=Number(seconds);if(!Number.isFinite(n)||n<0)return '--';const centiseconds=Math.round(n*100);return Math.floor(centiseconds/6000)+':'+((centiseconds%6000)/100).toFixed(2).padStart(5,'0');}
function toggle(i,event){
  const next=new Set(selected.value);
  if(event.shiftKey&&anchor.value>=0){for(let j=Math.min(i,anchor.value);j<=Math.max(i,anchor.value);j++)next.add(j);}
  else {if(next.has(i))next.delete(i);else next.add(i);anchor.value=i;}
  selected.value=next;
}
function clearSelection(){selected.value=new Set();anchor.value=-1;}
function apply(){
  if(!chosen.value||!selected.value.size)return;
  const count=selected.value.size;for(const i of selected.value){rows.value[i].pipId=chosen.value.id;delete rows.value[i].pipOmit;}
  clearSelection();notify('已为'+count+'行字幕设置画中画，确认后保存','success');
}
function remove(){for(const i of selected.value){delete rows.value[i].pipId;rows.value[i].pipOmit=true;}clearSelection();}
async function upload(){importing.value=true;try{const items=await importAssets('visual');const item=items.find(a=>['image','video'].includes(a.type));if(item)chosenId.value=item.id;}finally{importing.value=false;}}
function close(){if(!props.saving&&!importing.value)emit('close');}
</script>
<template>
  <Modal title="自定义画中画" variant="pip" wide @close="close">
    <div class="pip-editor" :aria-busy="saving||importing">
      <section class="pip-caption-panel">
        <div class="pip-summary"><strong>字幕片段</strong><span role="status" aria-label="画中画选中统计">{{selected.size}} 行 · {{selectedSeconds.toFixed(1)}}s</span></div>
        <p class="hint">点击选择，按住 Shift 可连续选择。</p>
        <div class="pip-selection-tools"><button aria-label="全选" :disabled="saving" @click="selected=new Set(rows.map((_,i)=>i))">全选字幕</button><button :disabled="saving||!selected.size" @click="clearSelection">清空选择</button><button class="danger" :disabled="saving||!selected.size" @click="remove">清除所选画中画</button></div>
        <div class="pip-rows" aria-label="字幕画中画分配">
          <button v-for="(row,i) in rows" :key="i" role="checkbox" :aria-checked="selected.has(i)" :aria-label="'选择第'+(i+1)+'行字幕'" class="pip-row" :class="{selected:selected.has(i)}" :disabled="saving" @click="toggle(i,$event)">
            <span class="pip-row-number" aria-hidden="true">{{selected.has(i)?'✓':''}}</span><span class="pip-row-main"><small>{{timeLabel(row.start)}} - {{timeLabel(row.end)}}</small><strong>{{row.text}}</strong><span v-if="row.pipId" class="pip-assignment" :title="assetName(row.pipId)"><I name="Image" :size="13"/>{{assetName(row.pipId)}}</span><small v-else-if="row.pipOmit">此行不混剪</small></span>
          </button>
        </div>
        <span class="sr-only">已分配 {{assigned}} / {{rows.length}} 行；句间空隙不显示画中画。</span>
      </section>
      <section class="pip-material-panel">
        <h3>画中画素材</h3><p class="hint">从素材库或本地文件选择后，应用到左侧选中的字幕。</p>
        <div class="segmented"><button :class="{active:tab==='library'}" @click="tab='library'">素材库</button><button :class="{active:tab==='local'}" @click="tab='local'">本地文件</button></div>
        <template v-if="tab==='library'">
          <label class="pip-library-tools">素材分类<select v-model="category" aria-label="画中画素材分类"><option value=""></option><option v-for="c in state.categories" :key="c">{{c}}</option></select></label>
          <div class="pip-library" aria-label="可选画中画素材">
            <button v-for="a in assets" :key="a.id" class="pip-material" :class="{active:chosenId===a.id}" :aria-pressed="chosenId===a.id" :aria-label="'使用素材 '+a.name" :disabled="saving" @click="chosenId=a.id"><img v-if="a.type==='image'" :src="mediaUrl(a.id)" alt="" loading="lazy"/><span v-else class="pip-video-icon"><I name="Video" :size="27"/></span><strong :title="a.name">{{a.name}}</strong><small>{{a.type==='video'?'视频':'图片'}} · {{a.category}}</small></button>
            <div v-if="!assets.length" class="pip-library-empty"><I name="FolderOpen" :size="56"/><p>{{category?'当前分类暂无素材':'选择分类后显示素材'}}</p></div>
          </div>
        </template>
        <div v-else class="pip-local"><I name="Upload" :size="32"/><p>选择电脑上的图片或视频</p><button :disabled="saving||importing" @click="upload">{{importing?'正在导入…':'选择本地文件'}}</button><p class="hint">导入素材保存在素材库；取消弹窗只撤销字幕分配。</p></div>
        <div v-if="chosen" class="pip-chosen"><strong>{{chosen.name}}</strong><video v-if="chosen.type==='video'" :key="chosen.id" :src="mediaUrl(chosen.id)" controls preload="metadata"/><img v-else :src="mediaUrl(chosen.id)" alt="所选画中画素材预览"/></div>
        <button class="primary full" aria-label="应用到选中字幕" :disabled="saving||importing||!selected.size||!chosen" @click="apply">应用到所选字幕</button>
      </section>
    </div>
    <template #footer><button :disabled="saving||importing" @click="close">取消</button><button class="primary" aria-label="确定画中画" :disabled="saving||importing" @click="emit('confirm',JSON.parse(JSON.stringify(rows)))">{{saving?'保存中…':'确定'}}</button></template>
  </Modal>
</template>
