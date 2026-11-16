import {computed,inject,onBeforeUnmount,onMounted,ref,watch} from 'vue';
import {call,mediaUrl} from './api';
import {emotionOptions,speechCapabilities,speechGenerationReason} from '../server/speech-config.mjs';

// 新旧声音界面共用真实音色读取、试听及过期保护。
export function useVoiceControls({emit,previewAudio}){
const {draft:d,state,busy,workflowLocked,act,notify}=inject('studio');
const advanced=ref(false),upload=ref(false),voices=ref([]),voiceError=ref(''),loading=ref(false),playing=ref(false),previewing=ref(false);
const capabilities=computed(()=>speechCapabilities(state.value.settings.provider));
const locked=computed(()=>!!busy.value||workflowLocked.value);
const selected=computed({get:()=>d.value.voice.profile?'sample:'+d.value.voice.profile:capabilities.value.windows&&d.value.voice.systemVoice?'system:'+d.value.voice.systemVoice:'',set:value=>{stop();if(value.startsWith('sample:')){d.value.voice.profile=value.slice(7);delete d.value.voice.systemVoice;}else{d.value.voice.profile='';if(value.startsWith('system:'))d.value.voice.systemVoice=value.slice(7);else delete d.value.voice.systemVoice;}}});
const options=computed(()=>[{value:'',label:capabilities.value.windows?'使用设置中的系统音色':capabilities.value.local?'请选择本地参考声音':'使用设置中的服务音色'},...(capabilities.value.windows?voices.value.map(v=>({value:'system:'+v.name,label:v.name+' · '+v.culture})):[]),...(capabilities.value.windows&&d.value.voice.systemVoice&&!voices.value.some(v=>v.name===d.value.voice.systemVoice)?[{value:'system:'+d.value.voice.systemVoice,label:loading.value?'正在读取本机音色…':d.value.voice.systemVoice+'（待核对）',disabled:true}]:[]),...state.value.voices.map(v=>({value:'sample:'+v.id,label:v.name+(capabilities.value.local&&v.sampleId?'（本地样本）':!v.remoteId?'（仅样本，未训练）':'')}))]);
const profile=computed(()=>state.value.voices.find(v=>v.id===d.value.voice.profile));
const generationReason=computed(()=>loading.value?'正在读取本机音色…':speechGenerationReason(d.value,state.value.settings.provider,state.value.voices,voices.value));
const emotionItems=computed(()=>emotionOptions.map(v=>({...v,disabled:!!v.value&&!capabilities.value.emotions})));
const emotionLabel=computed(()=>emotionOptions.find(v=>v.value===d.value.voice.emotion)?.label||(['normal','正常'].includes(d.value.voice.emotion)?'正常':'未支持'));
const previewKey=computed(()=>JSON.stringify([d.value.id,selected.value,d.value.voice.speed,d.value.voice.model,state.value.settings.provider]));
let player,serial=0,alive=true;const cache=new Map();
function stop(){serial++;if(player){player.pause();player.removeAttribute('src');player.load();player=null;}playing.value=false;previewing.value=false;}
async function preview(){if(playing.value){stop();return;}if(locked.value||previewing.value)return;stop();const token=serial,key=previewKey.value;previewing.value=true;try{let id=profile.value?.sampleId||cache.get(key);if(!id){const result=await act('合成音色试听',()=>call('testSpeech',{id:d.value.id,text:voices.value.find(v=>v.name===(d.value.voice.systemVoice||state.value.settings.provider.systemVoice))?.culture.startsWith('en')?'Hello, this is a preview of the selected voice. Welcome to the local creative studio.':'你好，这是当前音色的试听。欢迎使用本地内容创作工作台。',profile:d.value.voice.profile,speed:d.value.voice.speed,model:d.value.voice.model,systemVoice:d.value.voice.systemVoice}));if(!result||result.stale)return;id=result.id;cache.set(key,id);}if(!alive||token!==serial||key!==previewKey.value)return;player=previewAudio.value;player.src=mediaUrl(id);const current=player;current.onended=()=>{if(player===current)stop();};current.onerror=()=>{if(player===current){stop();notify('试听文件无法播放，请重新选择声音','error');}};await current.play();if(alive&&token===serial)playing.value=true;}catch(e){if(alive&&token===serial)notify('试听失败：'+e.message,'error');}finally{if(token===serial)previewing.value=false;}}
async function loadVoices(){if(!capabilities.value.windows)return;loading.value=true;voiceError.value='';try{voices.value=await call('systemVoices');}catch(e){voiceError.value=e.message;}finally{loading.value=false;}}
function generate(){stop();emit('generate');}
watch(previewKey,stop);
watch(()=>capabilities.value.windows,loadVoices);
watch(()=>d.value.id,()=>{upload.value=false;advanced.value=false;});
onMounted(loadVoices);onBeforeUnmount(()=>{alive=false;stop();});
 return {d,state,workflowLocked,advanced,upload,voices,voiceError,loading,playing,previewing,capabilities,locked,selected,options,profile,generationReason,emotionItems,emotionLabel,stop,preview,loadVoices,generate};
}
