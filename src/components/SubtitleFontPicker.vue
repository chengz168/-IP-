<script setup>
import {computed,nextTick,onMounted,onUnmounted,ref,useId,watch} from 'vue';
import I from './Icon.vue';
const props=defineProps({modelValue:String,fonts:{type:Array,default:()=>[]},fallback:String,disabled:Boolean});
const emit=defineEmits(['update:modelValue']);
const trigger=ref(),list=ref(),opened=ref(false),active=ref(-1),popup=ref({});
const listId='subtitle-font-list-'+useId();
let prefix='',typedAt=0;
// 只重排显示顺序，字体标识及实际渲染来源保持原目录中的真实值。
const options=computed(()=>[...props.fonts].sort((a,b)=>(a.source==='local'?0:1)-(b.source==='local'?0:1)||a.label.localeCompare(b.label,'zh-CN')));
const selected=computed(()=>options.value.find(f=>f.id===props.modelValue));
const label=computed(()=>selected.value?.label||(props.fallback?props.fallback+'（字体缺失）':'请选择字体'));
async function reveal(){await nextTick();list.value?.querySelector('[data-active="true"]')?.scrollIntoView({block:'nearest'});}
function close(){opened.value=false;prefix='';}
function move(index){active.value=Math.max(0,Math.min(options.value.length-1,index));reveal();}
async function open(){
  if(props.disabled||!options.value.length)return;
  const r=trigger.value.getBoundingClientRect(),dialog=trigger.value.closest('[role="dialog"]')?.getBoundingClientRect();
  const topLimit=Math.max(8,(dialog?.top||0)+4),bottomLimit=Math.min(innerHeight-8,dialog?.bottom||innerHeight);
  const footer=trigger.value.closest('[role="dialog"]')?.querySelector('.subtitle-editor-footer')?.getBoundingClientRect();
  const bottom=Math.min(bottomLimit,footer?.top??bottomLimit)-8;
  const below=bottom-r.bottom-4,above=r.top-topLimit-4;
  const down=below>=Math.min(266,above),height=Math.min(266,Math.max(0,down?below:above));
  popup.value={left:r.left+'px',top:(down?r.bottom+4:r.top-4-height)+'px',width:r.width+'px',height:height+'px'};
  active.value=Math.max(0,options.value.findIndex(f=>f.id===props.modelValue));opened.value=true;await reveal();
}
function choose(index){const font=options.value[index];if(!font||props.disabled)return;emit('update:modelValue',font.id);close();trigger.value?.focus();}
function key(event){
  const k=event.key;
  if(k==='Escape'&&opened.value){event.preventDefault();event.stopPropagation();close();return;}
  if(k==='Tab'){close();return;}
  if(['ArrowDown','ArrowUp','Home','End','PageDown','PageUp','Enter',' '].includes(k)){
    event.preventDefault();
    if(!opened.value){open();return;}
    if(k==='Enter'||k===' '){choose(active.value);return;}
    move(k==='Home'?0:k==='End'?options.value.length-1:active.value+(k==='ArrowUp'?-1:k==='PageUp'?-4:k==='PageDown'?4:1));return;
  }
  if(k.length===1&&!event.ctrlKey&&!event.altKey&&!event.metaKey){
    event.preventDefault();const now=Date.now();prefix=now-typedAt>700?k:prefix+k;typedAt=now;
    const query=prefix.toLocaleLowerCase();const index=options.value.findIndex(f=>f.label.toLocaleLowerCase().startsWith(query)||f.family.toLocaleLowerCase().startsWith(query));
    if(index>=0){if(!opened.value)open();move(index);}
  }
}
function outside(event){if(opened.value&&!trigger.value?.contains(event.target)&&!list.value?.contains(event.target))close();}
function scrolled(event){if(opened.value&&!list.value?.contains(event.target))close();}
watch(()=>props.disabled,value=>{if(value)close();});
watch(()=>props.fonts,()=>close());
onMounted(()=>{document.addEventListener('pointerdown',outside,true);document.addEventListener('scroll',scrolled,true);window.addEventListener('resize',close);});
onUnmounted(()=>{document.removeEventListener('pointerdown',outside,true);document.removeEventListener('scroll',scrolled,true);window.removeEventListener('resize',close);});
</script>

<template>
  <div class="subtitle-font-picker">
    <button ref="trigger" type="button" class="subtitle-font-trigger" role="combobox" aria-label="字幕字体" aria-haspopup="listbox" :aria-expanded="opened" :aria-controls="opened?listId:undefined" :aria-activedescendant="opened?listId+'-'+active:undefined" :disabled="disabled" :title="label" @click="opened?close():open()" @keydown="key"><span>{{label}}</span><I name="ChevronDown" :size="12"/></button>
    <div v-if="opened" ref="list" :id="listId" class="subtitle-font-list" role="listbox" aria-label="字幕字体选项" :style="popup" @pointerdown.prevent>
      <div v-for="(font,index) in options" :id="listId+'-'+index" :key="font.id" class="subtitle-font-option" role="option" :aria-selected="font.id===modelValue" :data-active="index===active" :class="{selected:font.id===modelValue,focused:index===active}" :title="font.label+' · '+font.family" @pointermove="active=index" @click="choose(index)">{{font.label}}</div>
    </div>
  </div>
</template>

<style>
.subtitle-font-picker{min-width:0;width:100%;height:24px}
.subtitle-editor .subtitle-font-trigger{display:flex;align-items:center;justify-content:space-between;gap:6px;width:100%;height:24px;min-height:24px;padding:0 6px;border:1px solid #454752;border-radius:3px;background:#252733;color:#e0e1e8;line-height:22px;text-align:left;font-weight:400}
.subtitle-font-trigger>span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.subtitle-font-trigger svg{color:#c5c8d0;flex-shrink:0}
.subtitle-font-list{position:fixed;z-index:120;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;padding:4px;border:1px solid #58375e;border-radius:14px;background:#191919;box-shadow:0 6px 18px #0004;color:#e0e1e8;font-size:var(--app-font-size-caption)}
.subtitle-font-list::-webkit-scrollbar{width:8px}
.subtitle-font-list::-webkit-scrollbar-track{background:transparent}
.subtitle-font-list::-webkit-scrollbar-thumb{background:#090909;border-radius:5px}
.subtitle-font-option{height:64px;padding:8px 12px;line-height:22px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border-radius:4px;cursor:pointer}
.subtitle-font-option.focused{background:#30303b}
.subtitle-font-option.selected{background:#3c50ff;color:#fff;font-weight:600}
.subtitle-font-option.selected.focused{background:#3c50ff}
</style>
