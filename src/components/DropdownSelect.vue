<script setup>
import {computed,nextTick,onBeforeUnmount,onMounted,ref,useId,watch} from 'vue';
import I from './Icon.vue';
defineOptions({inheritAttrs:false});
const props=defineProps({modelValue:[String,Number],options:{type:Array,default:()=>[]},disabled:Boolean,placeholder:{type:String,default:'请选择'},variant:{type:String,default:'standard'},rootClass:String});
const emit=defineEmits(['update:modelValue']);
const id=useId(),host=ref(),trigger=ref(),list=ref(),open=ref(false),active=ref(-1),popup=ref({});
const items=computed(()=>props.options.map(option=>typeof option==='object'?option:{value:option,label:String(option)}));
const selected=computed(()=>items.value.findIndex(option=>String(option.value)===String(props.modelValue)));
const display=computed(()=>items.value[selected.value]?.label||String(props.modelValue??'')||props.placeholder);
const enabled=computed(()=>items.value.map((option,index)=>option.disabled?-1:index).filter(index=>index>=0));
let prefix='',typedAt=0,observer;
function close(){open.value=false;prefix='';}
function position(){
 if(!open.value||!trigger.value||!list.value)return;
 if(!list.value.firstElementChild){close();return;}
 const rect=trigger.value.getBoundingClientRect(),margin=8,gap=4;
 if(rect.bottom<=0||rect.top>=innerHeight){close();return;}
 // 先确定真实宽度再量文字换行高度，避免长选项按body宽度测量后被裁切。
 list.value.style.width=Math.min(rect.width,innerWidth-margin*2)+'px';
 const style=getComputedStyle(list.value),row=parseFloat(getComputedStyle(list.value.firstElementChild).minHeight)||64;
 const rows=Number(style.getPropertyValue('--select-visible-rows'))||4,edges=parseFloat(style.paddingTop)+parseFloat(style.paddingBottom)+2;
 const desired=Math.min(list.value.scrollHeight+2,row*rows+edges),below=innerHeight-rect.bottom-gap-margin,above=rect.top-gap-margin;
 const up=below<desired&&above>below,height=Math.max(0,Math.min(desired,up?above:below));
 popup.value={left:Math.max(margin,Math.min(rect.left,innerWidth-rect.width-margin))+'px',top:(up?rect.top-gap-height:rect.bottom+gap)+'px',width:Math.min(rect.width,innerWidth-margin*2)+'px',maxHeight:height+'px'};
}
async function reveal(){await nextTick();const item=list.value?.querySelector('[data-active="true"]');if(!item)return;const top=item.offsetTop,bottom=top+item.offsetHeight;if(top<list.value.scrollTop)list.value.scrollTop=top;else if(bottom>list.value.scrollTop+list.value.clientHeight)list.value.scrollTop=bottom-list.value.clientHeight;}
async function show(edge,keyboard=true){
 if(props.disabled||!enabled.value.length)return;
 document.dispatchEvent(new CustomEvent('studio-select-open',{detail:id}));
 active.value=edge==='first'?enabled.value[0]:edge==='last'?enabled.value.at(-1):enabled.value.includes(selected.value)?selected.value:keyboard?enabled.value[0]:-1;
 open.value=true;trigger.value?.focus();await nextTick();position();await reveal();
}
function choose(index){const option=items.value[index];if(!option||option.disabled)return;emit('update:modelValue',option.value);close();trigger.value?.focus();}
function move(amount){const at=enabled.value.indexOf(active.value);active.value=enabled.value[at<0&&amount<0?enabled.value.length-1:Math.max(0,Math.min(enabled.value.length-1,at+amount))]??-1;reveal();}
function key(event){
 if(event.isComposing||props.disabled)return;
 if(event.key==='Escape'){if(open.value){event.preventDefault();event.stopPropagation();close();}return;}
 if(event.key==='Tab'){close();return;}
 if(event.altKey||event.ctrlKey||event.metaKey)return;
 if(['Enter',' ','ArrowDown','ArrowUp','Home','End','PageDown','PageUp'].includes(event.key)){
  event.preventDefault();if(!open.value){show(event.key==='End'?'last':event.key==='Home'?'first':event.key==='ArrowUp'&&selected.value<0?'last':undefined);return;}
  if(event.key==='Enter'||event.key===' '){choose(active.value);return;}
  if(event.key==='Home'||event.key==='End'){active.value=event.key==='Home'?enabled.value[0]:enabled.value.at(-1);reveal();return;}
  move(event.key==='ArrowDown'?1:event.key==='ArrowUp'?-1:event.key==='PageDown'?4:-4);return;
 }
 if(event.key.length===1){event.preventDefault();const now=Date.now();prefix=now-typedAt>700?event.key:prefix+event.key;typedAt=now;const search=[...enabled.value.filter(i=>i>active.value),...enabled.value.filter(i=>i<=active.value)];const repeated=[...prefix].every(c=>c===prefix[0]),term=(repeated?prefix[0]:prefix).toLocaleLowerCase();const found=search.find(i=>String(items.value[i].label).toLocaleLowerCase().startsWith(term));if(found!==undefined){if(!open.value)show().then(()=>{active.value=found;reveal();});else{active.value=found;reveal();}}}
}
function outside(event){if(!host.value?.contains(event.target)&&!list.value?.contains(event.target))close();}
function scrolling(event){if(open.value&&!list.value?.contains(event.target))position();}
function other(event){if(event.detail!==id)close();}
watch(()=>props.disabled,value=>{if(value)close();});
watch(()=>items.value.map(o=>[o.value,o.label,!!o.disabled]),async()=>{if(open.value){if(!enabled.value.includes(active.value))active.value=enabled.value[0]??-1;await nextTick();position();}});
onMounted(()=>{document.addEventListener('pointerdown',outside,true);document.addEventListener('scroll',scrolling,true);document.addEventListener('studio-select-open',other);window.addEventListener('resize',close);observer=new ResizeObserver(()=>{if(open.value)position();});observer.observe(trigger.value);});
onBeforeUnmount(()=>{observer?.disconnect();document.removeEventListener('pointerdown',outside,true);document.removeEventListener('scroll',scrolling,true);document.removeEventListener('studio-select-open',other);window.removeEventListener('resize',close);});
</script>
<template>
 <div ref="host" class="studio-select" :class="rootClass">
  <button ref="trigger" v-bind="$attrs" type="button" class="studio-select-trigger" role="combobox" aria-haspopup="listbox" :aria-expanded="open" :aria-controls="open?id:undefined" :aria-activedescendant="open&&active>=0?id+'-'+active:undefined" :data-value="modelValue" :disabled="disabled" :title="display" @click="open?close():show(undefined,false)" @keydown="key" @blur="close"><slot name="selected" :option="items[selected]" :label="display"><span>{{display}}</span></slot><I name="ChevronDown" :size="14"/></button>
  <Teleport to="body"><div v-if="open" :id="id" ref="list" role="listbox" :aria-label="$attrs['aria-label']||'可选项'" class="studio-select-menu" :class="'studio-select-menu-'+variant" :style="popup" @pointerdown.prevent><div v-for="(option,index) in items" :id="id+'-'+index" :key="String(option.value)" role="option" :data-value="option.value" :data-active="active===index" :aria-selected="selected===index" :aria-disabled="option.disabled||undefined" :class="{selected:selected===index,focused:active===index,disabled:option.disabled}" :title="option.label" @pointermove="!option.disabled&&(active=index)" @click="choose(index)"><slot name="option" :option="option">{{option.label}}</slot></div></div></Teleport>
 </div>
</template>
<style>
.studio-select{min-width:0;width:100%}
.studio-select-trigger{display:flex;width:100%;min-width:0;align-items:center;justify-content:space-between;gap:12px;background:#ffffff05;border:1px solid #ffffff0c;border-radius:7px;padding:10px 11px;color:inherit;font:inherit;font-weight:400;text-align:left;line-height:1.5;box-shadow:none}
.studio-select-trigger>span{display:block;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.studio-select-trigger>svg{flex:none;color:#d8d8e1}
.studio-select-trigger:hover{background:#ffffff08;border-color:#ffffff1c}
.studio-select-trigger:focus-visible,.studio-select-trigger[aria-expanded=true]{outline:2px solid #5888b333;outline-offset:0;border-color:#385775}
.studio-select-menu{--select-row-height:calc(64px * var(--app-font-scale) / 1.14);position:fixed;z-index:1200;overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain;box-sizing:border-box;padding:4px;border:1px solid #56345f;border-radius:14px;background:#1a1a1a;color:#fff;font-family:Avenir,Helvetica,Arial,'Microsoft YaHei',sans-serif;font-size:var(--app-font-size-caption);line-height:20px;box-shadow:0 10px 24px #0002}
.studio-select-menu::-webkit-scrollbar{width:8px}
.studio-select-menu::-webkit-scrollbar-track{background:#1a1a1a}
.studio-select-menu::-webkit-scrollbar-thumb{background:#080808;border-radius:8px}
.studio-select-menu::-webkit-scrollbar-button{display:none;height:0}
.studio-select-menu>[role=option]{box-sizing:border-box;min-height:var(--select-row-height);padding:9px 12px;border-radius:3px;cursor:pointer;overflow-wrap:anywhere;white-space:normal}
.studio-select-menu>[role=option].selected{background:#252e55;font-weight:600}
.studio-select-menu>[role=option].focused:not(.selected){background:#4b2f53}
.studio-select-menu>[role=option].disabled{opacity:.45;cursor:default}
.studio-select-menu-rewrite{--select-visible-rows:6;padding:6px}
.studio-select-menu-rewrite>[role=option]{display:flex;align-items:center;font-weight:600}
</style>
