<script setup>
import {computed,inject,ref,watch} from 'vue';
import I from './Icon.vue';
import MediaPreview from './MediaPreview.vue';
import StoryStudio from './StoryStudio.vue';
import CreativePresets from './CreativePresets.vue';
import {call,mediaUrl} from '../api';
import {fields,needsTranslation,productShotView} from '../../server/shot-localization-view.mjs';

const props=defineProps({phase:{type:String,default:'source'}});
const {state,draft:d,busy,workflowLocked,act,save,refresh,importAssets,notify}=inject('studio');
const error=ref(''),errorAt=ref('collect'),operation=ref(''),manualEntry=ref(false),failedImages=ref({}),previewRunId=ref('');
const pendingCollection=ref(null);
const storyEditor=ref(null);
async function handoffToEditing(){
 if(locked.value)return false;
 if(introduction.value){
  if(storyEditor.value)return storyEditor.value.handoffToEditing();
  notify('请先准备产品介绍分镜并合成当前集，再进入网感剪辑','error');return false;
 }
 if(!previewRun.value?.id||previewStale.value){notify('请先生成并检查有效的商品视频，再进入网感剪辑','error');return false;}
 const id=d.value.id;await useVideo();return d.value.id===id&&d.value.step===4;
}
defineExpose({handoffToEditing});
const defaults=()=>({url:'',sourceRunId:'',title:'',description:'',brand:'',sku:'',price:'',currency:'',specifications:[],selectedIndices:[],assetIds:[],duration:30,aspect:'9:16',brief:'',scriptRunId:'',shots:[],narration:true});
// 旧任务缺失的制作模式和素材角色仅在界面派生，避免挂载触发自动保存而撤销成片。
function ensureProduct(){
 if(!d.value.product||typeof d.value.product!=='object')d.value.product=defaults();
 const target=d.value.product;
 for(const [key,value] of Object.entries(defaults()))if(target[key]===undefined||target[key]===null)target[key]=value;
}
watch(()=>[d.value.id,d.value.product],ensureProduct,{immediate:true,flush:'sync'});
const p=computed(()=>d.value.product);
const displayShots=computed(()=>p.value.shots.map((_,index)=>productShotView(p.value,index,d.value.artifacts?.shotTranslations)));
const untranslatedShots=computed(()=>displayShots.value.filter(shot=>!shot.translated&&fields.some(key=>needsTranslation(shot[key]))).length);
function needsChineseDesign(shot){return fields.some(key=>needsTranslation(shot[key]));}
async function translateProductShots(){
 if(locked.value||!untranslatedShots.value)return;error.value='';operation.value='translation';const id=d.value.id;
 try{await save();const result=await request('转换商品镜头中文','translateProductDesign',{id});if(!result||d.value.id!==id)return;await refresh();notify('商品镜头中文译稿已保存，原设计与媒体选择保持。','success');}catch(e){showFailure(e.message);}finally{operation.value='';}
}
function editChineseDesign(index){
 if(locked.value)return;const view=displayShots.value[index],shot=p.value.shots[index];if(!shot||!view?.translated)return;
 const limits={visual:1500,action:1200,camera:500};
 if(Object.entries(limits).some(([key,max])=>view[key].length>max)){showFailure('中文译稿超出设计字段长度，请先核对后再编辑。');return;}
 for(const key of fields)if(key in shot)shot[key]=view[key];
 notify('已将中文译稿用于当前镜头编辑，请核对后保存；设计修改会使关联旧成片待核对。');
}
const runs=computed(()=>state.value.runs.filter(run=>run.draftId===d.value.id));
const collectRuns=computed(()=>runs.value.filter(run=>run.type==='product-collect'&&run.status==='succeeded'&&run.output?.product));
const sourceRun=computed(()=>collectRuns.value.find(run=>run.id===p.value.sourceRunId));
const images=computed(()=>sourceRun.value?.output?.product?.images||[]);
const scriptRun=computed(()=>runs.value.find(run=>run.id===p.value.scriptRunId&&run.type==='product-script'&&run.status==='succeeded'));
const scriptImages=computed(()=>scriptRun.value?.output?.images||[]);
function scriptInput(product){if(!product)return '';return JSON.stringify({url:product.url,sourceRunId:product.sourceRunId,title:product.title,description:product.description,brand:product.brand,sku:product.sku,price:product.price,currency:product.currency,specifications:product.specifications,selectedIndices:product.selectedIndices,assetIds:product.assetIds,imageRoles:product.imageRoles||{},duration:product.duration,aspect:product.aspect,brief:product.brief});}
const scriptStale=computed(()=>!scriptRun.value||!!scriptRun.value.output.stale||scriptInput(scriptRun.value.snapshot?.product)!==scriptInput(p.value));
const localImages=computed(()=>p.value.assetIds.map(id=>state.value.assets.find(asset=>asset.id===id&&asset.type==='image')).filter(Boolean));
const shotImages=computed(()=>scriptImages.value);
const activeRun=computed(()=>runs.value.find(run=>(['product-collect','product-script','product-video','product-introduction'].includes(run.type)||String(run.type).startsWith('story-'))&&['queued','running','unknown'].includes(run.status)));
const locked=computed(()=>!!busy.value||!!workflowLocked.value||!!operation.value||!!activeRun.value);
const sourceStale=computed(()=>!!sourceRun.value&&(sourceRun.value.output.stale||String(sourceRun.value.output.sourceUrl??sourceRun.value.snapshot?.product?.url??'').trim()!==p.value.url.trim()));
const selectedCount=computed(()=>p.value.selectedIndices.filter(index=>images.value[index]).length+localImages.value.length);
const hasFacts=computed(()=>manualEntry.value||!!p.value.title||!!sourceRun.value||!!localImages.value.length);
const hasProductImage=computed(()=>p.value.selectedIndices.some(index=>images.value[index]&&imageRole('remote:'+index,images.value[index].kind)!=='icon')||localImages.value.some(image=>imageRole(image.id)!=='icon'));
const canScript=computed(()=>!locked.value&&!sourceStale.value&&!!p.value.title.trim()&&hasProductImage.value&&selectedCount.value>0&&selectedCount.value<=20&&Number.isFinite(p.value.duration)&&p.value.duration>=5&&p.value.duration<=180);
const renderMode=computed({get:()=>['introduction','presentation'].includes(p.value.renderMode)?p.value.renderMode:p.value.scriptRunId||p.value.shots?.length?'presentation':'introduction',set:value=>{if(locked.value||!['introduction','presentation'].includes(value))return;p.value.renderMode=value;if(value==='introduction')p.value.narration=true;}});
const introduction=computed(()=>renderMode.value==='introduction');
const preparedIntroduction=computed(()=>!!d.value.story?.productIntroduction&&!!d.value.story?.episodes?.length);
const totalDuration=computed(()=>p.value.shots.reduce((sum,shot)=>sum+(Number(shot.duration)||0),0));
const currentAudio=computed(()=>state.value.assets.find(asset=>asset.id===d.value.voice?.audioId&&asset.type==='audio'));
const timingSummary=computed(()=>{
 if(!p.value.shots.length)return '请先在第一步生成商品脚本';
 if(!introduction.value||!preparedIntroduction.value)return `${p.value.shots.length} 个镜头 · 规划 ${totalDuration.value.toFixed(1)} 秒`;
 const shots=d.value.story.episodes.flatMap(episode=>episode.shots||[]),audioDuration=Number(currentAudio.value?.duration),coverage=shots.reduce((sum,shot)=>sum+Number(shot.duration),0);
 const seconds=(value,digits=2)=>Number.isFinite(value)&&value>0?`${value.toFixed(digits)} 秒`:'未取得';
 return `${shots.length} 个镜头 · 目标 ${seconds(Number(p.value.duration),1)} / 实际旁白 ${seconds(audioDuration)} / 分镜覆盖 ${seconds(coverage)}`;
});
const introductionReason=computed(()=>generationReason.value||(!currentAudio.value?'请先在第三步生成当前文案的配音。':''));
const normalizedText=text=>String(text||'').replace(/\s+/g,'').trim();
const narrationMatches=computed(()=>normalizedText(p.value.shots.map(shot=>shot.text).join('\n'))===normalizedText(d.value.finalText));
const generationReason=computed(()=>!p.value.scriptRunId?'请先在第一步读取商品并生成宣传脚本。':sourceStale.value||scriptStale.value?'商品资料或图片已变化，请回第一步更新脚本。':!d.value.confirmed||!String(d.value.finalText||'').trim()?'请先在第二步确认最终文案。':!narrationMatches.value?'镜头旁白与第二步最终文案不一致，请核对并同步后再生成。':p.value.narration&&!currentAudio.value?'请先在第三步生成或选择当前文案的配音。':!validShots.value?'请为每个镜头选择图片，并设置 1–60 秒时长。':'');
const validShots=computed(()=>p.value.shots.length>0&&p.value.shots.every(shot=>String(shot.text||'').trim()&&shotImages.value.some(image=>image.id===shot.imageId)&&Number(shot.duration)>=1&&Number(shot.duration)<=60));
const videoRuns=computed(()=>runs.value.filter(run=>run.type==='product-video'&&run.status==='succeeded'&&run.output?.asset?.id));
const previewRun=computed(()=>videoRuns.value.find(run=>run.id===previewRunId.value)||videoRuns.value[0]);
const preview=computed(()=>previewRun.value?.output);
// 镜头、商品事实或配音开关变化后，旧成片仍可预览，但必须重新生成才能选用。
function renderInput(product){if(!product)return '';return JSON.stringify({url:product.url,sourceRunId:product.sourceRunId,title:product.title,description:product.description,brand:product.brand,sku:product.sku,price:product.price,currency:product.currency,specifications:product.specifications,selectedIndices:product.selectedIndices,assetIds:product.assetIds,duration:product.duration,aspect:product.aspect,brief:product.brief,scriptRunId:product.scriptRunId,narration:product.narration,shots:product.shots});}
function voiceInput(voice){const {audioId,...settings}=voice||{};return JSON.stringify(settings);}
const previewStale=computed(()=>!preview.value||!!preview.value.stale||!d.value.confirmed||!String(d.value.finalText||'').trim()||renderInput(previewRun.value.snapshot?.product)!==renderInput(p.value)||previewRun.value.snapshot?.language!==d.value.language||voiceInput(previewRun.value.snapshot?.voice)!==voiceInput(d.value.voice)||(p.value.narration&&previewRun.value.snapshot?.voice?.audioId!==d.value.voice?.audioId)||String(previewRun.value.snapshot?.finalText||'')!==String(d.value.finalText||''));
const warnings=computed(()=>sourceRun.value?.output?.product?.warnings||[]);
function findRun(type,result){return result?.runId||runs.value.find(run=>run.type===type&&run.status==='succeeded'&&run.output?.inputSignature===result?.inputSignature)?.id||'';}
function showFailure(message){errorAt.value=operation.value||(props.phase==='video'?'video':'collect');error.value=String(message||'操作未完成，请重试或查看任务中心。');}
async function request(label,action,payload){
 return act(label,async()=>{try{return await call(action,payload);}catch(e){showFailure(e.message);throw e;}});
}
async function collect(){
 if(locked.value||!p.value.url.trim())return;
 error.value='';operation.value='collect';const id=d.value.id,url=p.value.url.trim();p.value.url=url;
 try{await save();const result=await request('读取商品详情','collectProduct',{id,url});if(!result){manualEntry.value=true;return;}if(result.stale||d.value.id!==id||p.value.url.trim()!==url){showFailure('链接或任务已变化，采集结果已保留在执行记录，请重新读取当前链接。');return;}
  const runId=findRun('product-collect',result);if(!runId)throw Error('采集结果缺少可核对的任务记录，请重试。');
  pendingCollection.value={id,url,runId,product:result.product||{}};
  if(p.value.shots.length){notify('已读取新商品资料，现有脚本保留。请核对后选择是否替换。','success');return;}
  await commitCollection();
 }catch(e){showFailure(e.message);manualEntry.value=true;}finally{operation.value='';}
}
async function commitCollection(){
 const next=pendingCollection.value;if(!next||next.id!==d.value.id||next.url!==p.value.url.trim()){pendingCollection.value=null;return;}
 const product=next.product;for(const key of ['title','description','brand','sku','price','currency'])p.value[key]=String(product[key]??'');
 p.value.specifications=JSON.parse(JSON.stringify(product.specifications||[]));p.value.selectedIndices=(product.images||[]).slice(0,8).map((_,index)=>index);p.value.sourceRunId=next.runId;p.value.scriptRunId='';p.value.shots=[];failedImages.value={};manualEntry.value=true;pendingCollection.value=null;await save();notify('商品资料已读取，请核对事实并选择宣传图片。','success');
}
async function applyCollection(){if(locked.value)return;try{await commitCollection();}catch(e){errorAt.value='collect';error.value=e.message;}}
async function addImages(){
 if(locked.value)return;error.value='';operation.value='import';const id=d.value.id;
 try{const assets=await importAssets('image');if(d.value.id!==id)return;const ids=assets.filter(asset=>asset.type==='image').map(asset=>asset.id);p.value.assetIds=[...new Set([...p.value.assetIds,...ids])];if(ids.length)manualEntry.value=true;await save();}catch(e){showFailure(e.message);}finally{operation.value='';}
}
async function createScript(){
 if(!canScript.value)return;error.value='';operation.value='script';const id=d.value.id;
 try{await save();const result=await request('生成商品宣传脚本','createProductScript',{id});if(!result)return;if(result.stale||d.value.id!==id){showFailure('商品资料已变化，脚本保留在执行记录，请重新生成。');return;}
  const runId=findRun('product-script',result);if(!runId||!result.shots?.length)throw Error('未收到完整的商品分镜脚本，请检查模型设置后重试。');
  p.value.scriptRunId=runId;p.value.shots=JSON.parse(JSON.stringify(result.shots));await save();notify('宣传脚本已生成，请核对摘要，再进入第二步确认文案。','success');
 }catch(e){showFailure(e.message);}finally{operation.value='';}
}
async function renderVideo(){
 if(locked.value||generationReason.value)return;error.value='';operation.value='video';const id=d.value.id;
 try{await save();const result=await request('生成商品宣传视频','generateProductVideo',{id});if(!result)return;previewRunId.value=findRun('product-video',result);if(result.stale||d.value.id!==id){showFailure('输入已变化，视频保留在素材库，未替换当前内容。');return;}notify('视频已生成，请播放检查画面、配音和字幕，再选用。','success');}
 catch(e){showFailure(e.message);}finally{operation.value='';}
}
async function prepareIntroduction(){
 if(locked.value||introductionReason.value)return;error.value='';operation.value='prepare';
 const id=d.value.id;
 try{await save();const result=await request('准备产品介绍分镜','prepareProductIntroduction',{id});if(!result)return;if(result.stale||d.value.id!==id){showFailure('商品资料或配音已变化，未替换当前分镜，请核对后重新准备。');return;}await refresh(true);notify('产品介绍分镜已关联商品原图和旁白，请逐镜生成动态视频并确认。','success');}catch(e){showFailure(e.message);}finally{operation.value='';}
}
async function useVideo(){
 if(locked.value||previewStale.value||!previewRun.value?.id)return;error.value='';operation.value='use';const id=d.value.id;
 try{await save();const result=await request('选用商品宣传视频','useProductVideo',{id,runId:previewRun.value.id});if(!result)return;await refresh(true);notify('已选用商品视频、文案和配音，进入网感剪辑。','success');}catch(e){showFailure(e.message);}finally{operation.value='';}
}
async function useScript(){
 if(locked.value||scriptStale.value||!validShots.value)return;error.value='';operation.value='script';const id=d.value.id;
 try{await save();const result=await request('选用商品脚本','useProductScript',{id,runId:p.value.scriptRunId,shots:p.value.shots});if(!result)return;await refresh(true);notify('商品脚本与图片已关联，进入第二步核对并确认文案。','success');}catch(e){showFailure(e.message);}finally{operation.value='';}
}
async function syncShots(){
 if(locked.value||!d.value.confirmed||!String(d.value.finalText||'').trim())return;error.value='';operation.value='sync';
 try{await save();const result=await request('同步商品镜头文案','syncProductShots',{id:d.value.id});if(!result)return;await refresh(true);notify('已将确认正文按顺序同步到商品镜头，请核对画面对应关系。','success');}catch(e){showFailure(e.message);}finally{operation.value='';}
}
async function goStep(step){if(locked.value)return;try{await save();if(step===0)d.value.tab='product';d.value.step=step;await save();}catch(e){showFailure(e.message);}}
function toggleImage(index){if(locked.value)return;if(!p.value.selectedIndices.includes(index)&&selectedCount.value>=20){showFailure('最多选用20张商品图片，请先取消部分图片。');return;}p.value.selectedIndices=p.value.selectedIndices.includes(index)?p.value.selectedIndices.filter(item=>item!==index):[...p.value.selectedIndices,index];}
function selectPageImages(){if(locked.value)return;p.value.selectedIndices=images.value.slice(0,Math.max(0,20-localImages.value.length)).map((_,index)=>index);}
function startManual(){if(locked.value)return;manualEntry.value=true;if(sourceStale.value){p.value.sourceRunId='';p.value.selectedIndices=[];p.value.scriptRunId='';p.value.shots=[];}}
function removeImage(id){if(locked.value)return;p.value.assetIds=p.value.assetIds.filter(item=>item!==id);}
function imageRole(key,kind){return p.value.imageRoles?.[key]|| (kind==='detail'?'detail':'product');}
function setImageRole(key,value){if(!locked.value)p.value.imageRoles={...p.value.imageRoles,[key]:value};}
function imageFailed(key){failedImages.value={...failedImages.value,[key]:true};}
function retryImages(){failedImages.value={};}
watch(()=>d.value.id,()=>{error.value='';manualEntry.value=false;failedImages.value={};previewRunId.value='';});
watch([()=>d.value.id,()=>p.value.url],()=>{pendingCollection.value=null;});
</script>

<template>
 <section class="product-studio" aria-label="商品宣传视频创作">
  <header class="product-heading"><div><h3>{{props.phase==='source'?'商品宣传':'商品宣传视频'}}</h3><p>{{props.phase==='source'?'从商品资料和图片提炼卖点，生成有依据的文案与动作分镜，接续文案确认、声音和视频制作。':'沿用确认稿与第三步配音，按脚本生成产品介绍镜头，确认后继续网感剪辑。'}}</p></div><span class="product-method">{{introduction?'脚本驱动 · 动态产品介绍':'原图展示 · 兼容已有任务'}}</span></header>
  <fieldset v-if="props.phase==='video'" class="product-render-modes"><legend>视频制作方式</legend><label :class="{selected:introduction}"><input v-model="renderMode" type="radio" value="introduction" :disabled="locked"/><span><strong>脚本驱动产品介绍</strong><small>按卖点和动作生成动态镜头，逐镜预览确认后合成。</small></span></label><label :class="{selected:!introduction}"><input v-model="renderMode" type="radio" value="presentation" :disabled="locked"/><span><strong>原图展示</strong><small>使用商品原图、轻微运镜与转场，保留已有制作方式。</small></span></label></fieldset>
  <p v-if="props.phase==='source'" class="product-handoff-note">商品创作沿用左侧七步流程：在这里准备资料与脚本，接着确认文案、生成声音，再到视频生成中的「商品宣传」完成制作。</p>
  <CreativePresets v-if="props.phase==='source'" stage="script" :context="{kind:'product'}" :disabled="locked"/>
  <p v-if="activeRun?.status==='unknown'" class="product-notice" role="status">上次操作结果尚待确认，请先在任务中心核对，避免重复提交。</p>
  <article v-if="props.phase==='source'" class="card product-source">
   <div class="card-heading"><h4>商品资料与图片</h4><span>{{sourceRun?'已读取商品资料':'输入商品链接，或手动添加'}}</span></div>
   <div v-if="pendingCollection" class="product-notice" role="status"><strong>已读取：{{pendingCollection.product.title}}</strong><p>取得 {{pendingCollection.product.images?.length||0}} 张图片。现有脚本仍保留；使用新资料后需要重新生成脚本。</p><div class="product-actions"><button :disabled="locked" @click="pendingCollection=null">保留现有脚本</button><button :disabled="locked" @click="applyCollection">使用新资料，重新制作脚本</button></div></div>
   <p v-if="error&&['collect','import'].includes(errorAt)" class="product-error" role="alert">{{error}}<span>可修改输入后重试，或上传商品原图并手动补充资料。</span></p>
   <label class="product-field">商品详情页链接<div class="product-link-row"><input v-model="p.url" :disabled="locked" aria-label="商品详情页链接" placeholder="粘贴商品详情页或商品分享链接"/><button class="primary" :disabled="locked||!p.url.trim()" @click="collect"><I :name="operation==='collect'?'LoaderCircle':'Link'" :size="16" :class="{spin:operation==='collect'}"/>{{operation==='collect'?'读取中…':sourceRun?'重新读取商品':'读取商品详情'}}</button></div></label>
   <p class="product-help">后台静默读取，不播放音视频。若商品页需要登录或验证，可上传商品图和详情图继续制作。</p>
   <p v-if="sourceStale" class="product-notice" role="status">商品链接已变化，当前资料属于旧链接，请重新读取后生成脚本。</p>
   <div class="product-actions"><button :disabled="locked" @click="addImages"><I name="ImagePlus" :size="16"/>上传商品图 / 详情图 / 图标</button><button v-if="!hasFacts||sourceStale" :disabled="locked" @click="startManual">手动填写商品资料</button><button v-if="Object.keys(failedImages).length" :disabled="locked" @click="retryImages">重试加载图片</button></div>
   <template v-if="hasFacts">
    <div class="product-facts"><label class="product-field product-full">商品名称 <input v-model="p.title" :disabled="locked" maxlength="500" placeholder="请输入准确的商品名称"/></label><label class="product-field">品牌<input v-model="p.brand" :disabled="locked" maxlength="200" placeholder="未提供可留空"/></label><label class="product-field">型号 / 规格<input v-model="p.sku" :disabled="locked" maxlength="300" placeholder="填写本次推广的规格"/></label><label class="product-field">页面价格<input v-model="p.price" :disabled="locked" maxlength="100" placeholder="可留空；发布前核对价格"/></label><label class="product-field">货币<input v-model="p.currency" :disabled="locked" maxlength="20" placeholder="如 CNY，未确认可留空"/></label><label class="product-field product-full">商品描述与已核实卖点<textarea v-model="p.description" :disabled="locked" maxlength="12000" placeholder="仅填写详情页或你已核实的信息，避免虚构功效、销量或评价。"/></label></div>
    <details v-if="p.specifications.length" class="product-specifications"><summary>核对商品参数（{{p.specifications.length}} 项）</summary><div v-for="(spec,index) in p.specifications" :key="index" class="product-spec-row"><label class="product-field">参数名<input v-model="spec.name" :disabled="locked" :aria-label="'参数名称 '+(index+1)"/></label><label class="product-field">参数值<input v-model="spec.value" :disabled="locked" :aria-label="'参数值 '+(index+1)"/></label></div></details>
    <ul v-if="warnings.length" class="product-warnings"><li v-for="(warning,index) in warnings" :key="index">{{warning}}</li></ul>
    <div class="product-image-heading"><strong>商品与图标素材</strong><span>已选 {{selectedCount}} / 20 张 · 勾选图片并标注用途</span><button v-if="images.length" class="text-button" :disabled="locked" @click="selectPageImages">选择页面图片（最多20张）</button><button v-if="p.selectedIndices.length" class="text-button" :disabled="locked" @click="p.selectedIndices=[]">清除页面选择</button></div>
    <p class="product-help">商品图和详情图用于识别产品与设计镜头；图标作为独立素材叠加到成片。至少选择一张商品图或详情图，不能只用图标生成产品。</p>
    <div v-if="images.length||localImages.length" class="product-image-grid">
     <label v-for="(image,index) in images" :key="sourceRun.id+':'+index" class="product-image-card" :class="{selected:p.selectedIndices.includes(index),'load-failed':failedImages['remote-'+index]}"><span class="product-image-check"><input type="checkbox" :checked="p.selectedIndices.includes(index)" :disabled="locked" :aria-label="'选择商品图片 '+(index+1)" @change="toggleImage(index)"/><span>{{image.kind==='detail'?'详情图':'商品图'}} {{index+1}}</span></span><span class="product-image-visual"><img v-if="!failedImages['remote-'+index]" :src="image.url" :alt="image.name||'商品图片 '+(index+1)" loading="lazy" referrerpolicy="no-referrer" @error="imageFailed('remote-'+index)"/><span v-else class="product-image-fallback"><I name="Image" :size="25"/>图片预览加载失败<small>可重试，或下载原图后上传</small></span></span><span class="product-image-name" :title="image.name">{{image.name||'页面图片 '+(index+1)}}</span><span class="product-image-role"><span>素材用途</span><select :value="imageRole('remote:'+index,image.kind)" :disabled="locked" :aria-label="'商品图片 '+(index+1)+' 用途'" @click.stop @change="setImageRole('remote:'+index,$event.target.value)"><option value="product">商品主体图</option><option value="detail">商品详情图</option><option value="icon">功能图标 / 标识</option></select></span></label>
     <article v-for="image in localImages" :key="image.id" class="product-image-card selected"><span class="product-image-check"><I name="Check" :size="15"/><span>已上传 · 已选用</span><button type="button" :disabled="locked" :aria-label="'移除商品图片 '+image.name" @click="removeImage(image.id)"><I name="X" :size="14"/></button></span><span class="product-image-visual"><img v-if="!failedImages[image.id]" :src="mediaUrl(image.id)" :alt="image.name" loading="lazy" @error="imageFailed(image.id)"/><span v-else class="product-image-fallback">本地图片无法预览<small>请重新上传原图</small></span></span><span class="product-image-name" :title="image.name">{{image.name}}</span><label class="product-image-role">素材用途<select :value="imageRole(image.id)" :disabled="locked" :aria-label="image.name+' 用途'" @change="setImageRole(image.id,$event.target.value)"><option value="product">商品主体图</option><option value="detail">商品详情图</option><option value="icon">功能图标 / 标识</option></select></label></article>
    </div><p v-else class="product-empty">尚无可用图片，请上传商品主图或详情图。只填写商品文字无法生成宣传视频。</p>
   </template>
  </article>
  <article class="card product-script">
   <div class="card-heading"><h4>{{props.phase==='source'?'宣传脚本与镜头摘要':'商品分镜与声音衔接'}}</h4><span>{{timingSummary}}</span></div>
   <p v-if="error&&['script','video','sync','prepare','translation'].includes(errorAt)" class="product-error" role="alert">{{error}}<span>请核对输入与当前步骤配置后重试，已有内容会保留。</span></p>
   <div v-if="untranslatedShots||operation==='translation'" class="product-actions"><button :disabled="locked" @click="translateProductShots"><I :name="operation==='translation'?'LoaderCircle':'Languages'" :class="{spin:operation==='translation'}" :size="16"/>{{operation==='translation'?'正在转换中文…':'将旧镜头转换为中文查看'}}</button><span class="product-help">仅保存中文阅读译稿，不改动原设计、配音或已选成片。</span></div>
   <template v-if="props.phase==='source'">
    <div class="product-settings"><label class="product-field">目标时长（秒）<input v-model.number="p.duration" type="number" min="5" max="180" step="1" :disabled="locked"/></label><label class="product-field">视频比例<select v-model="p.aspect" :disabled="locked"><option value="9:16">9:16 竖屏</option><option value="16:9">16:9 横屏</option><option value="1:1">1:1 方形</option></select></label></div>
    <label class="product-field">宣传要求<textarea v-model="p.brief" :disabled="locked" maxlength="4000" placeholder="例如：面向养猫家庭，突出日常使用场景，语气自然，不夸大效果。"/></label>
    <div class="product-actions"><button class="primary" :disabled="!canScript" @click="createScript"><I :name="operation==='script'?'LoaderCircle':'PencilLine'" :class="{spin:operation==='script'}" :size="16"/>{{operation==='script'?'生成脚本中…':p.shots.length?'重新生成宣传脚本':'生成宣传脚本'}}</button><span class="product-help">{{sourceStale?'请先重新读取当前商品链接':!p.title.trim()?'请先填写商品名称':!selectedCount?'请先选择或上传至少一张图片':!hasProductImage?'请至少选择一张商品图或详情图，图标不能作为唯一主体':'使用脚本后，继续第二步文案确认和第三步配音。'}}</span></div>
   </template>
   <p v-if="p.shots.length&&scriptStale" class="product-notice">商品资料、所选图片或宣传要求已变化，请回第一步重新生成脚本。</p>
   <div v-if="props.phase==='source'&&p.shots.length" class="product-shot-summaries"><article v-for="(shot,index) in displayShots" :key="index"><header><strong>镜头 {{index+1}}{{shot.stage?' · '+shot.stage:''}}</strong><span>{{Number(shot.duration).toFixed(1)}} 秒</span></header><p>{{shot.text}}</p><small v-if="shot.sellingPoint">卖点：{{shot.sellingPoint}}</small><small v-if="shot.evidence">依据：{{shot.evidence}}</small><small>画面：{{shot.visual}}</small><small v-if="shot.action">动作：{{shot.action}}</small><small v-if="shot.camera">运镜：{{shot.camera}}</small></article></div>
   <div v-if="props.phase==='source'" class="product-actions"><button class="primary" :disabled="locked||scriptStale||!validShots" @click="useScript">使用此脚本，进入文案确认</button><span class="product-help">资料、脚本和商品图保留在本任务中；第四步可调整分镜并生成视频。</span></div>
   <template v-else>
    <div class="product-stage-links"><button :disabled="locked" @click="goStep(0)"><I name="ArrowLeft" :size="15"/>返回商品资料</button><button :disabled="locked" @click="goStep(1)">前往文案确认</button><button :disabled="locked" @click="goStep(2)">前往声音生成</button></div>
    <div class="product-narration"><label><input v-model="p.narration" type="checkbox" :disabled="locked||introduction"/>使用第三步配音</label><span>{{p.narration?currentAudio?'当前音频：'+currentAudio.name:'尚未生成当前任务配音':'已选择无旁白视频，仅保留画面与字幕'}}</span></div>
    <audio v-if="p.narration&&currentAudio" class="product-upstream-audio" :src="mediaUrl(currentAudio.id)" controls preload="metadata" aria-label="第三步商品配音试听"/>
    <p class="product-help">{{p.narration?'直接使用第三步已有音频，不重复合成声音。':'无旁白模式由你主动选择，视频仍使用已确认文案作为字幕。'}}</p>
    <p v-if="generationReason" class="product-notice">{{generationReason}}</p>
    <div v-if="p.shots.length&&!narrationMatches" class="product-actions"><button :disabled="locked||!d.confirmed||!d.finalText.trim()" @click="syncShots">同步已确认文案到镜头</button><span class="product-help">按正文顺序分配到现有镜头，保持已确认文案原文，不再次改写。</span></div>
    <div v-if="p.shots.length&&(!introduction||!preparedIntroduction)" class="product-shots"><article v-for="(shot,index) in p.shots" :key="p.scriptRunId+':'+index" class="product-shot"><header><strong>镜头 {{index+1}}</strong><label>时长（秒）<input v-model.number="shot.duration" type="number" min="1" max="60" step="0.5" :disabled="locked" :aria-label="'镜头 '+(index+1)+' 时长（秒）'"/></label></header><div class="product-shot-body"><div class="product-shot-image"><img v-if="shot.imageId&&!failedImages['shot-'+shot.imageId]" :src="mediaUrl(shot.imageId)" :alt="'镜头 '+(index+1)+' 商品原图'" loading="lazy" @error="imageFailed('shot-'+shot.imageId)"/><span v-else>请选择可用图片</span><label class="product-field">镜头图片<select v-model="shot.imageId" :disabled="locked" :aria-label="'镜头 '+(index+1)+' 图片'"><option value="" disabled>选择商品图片</option><option v-for="image in shotImages.filter(item=>item.role!=='icon')" :key="image.id" :value="image.id">{{image.name||image.id}}</option></select></label></div><div class="product-shot-copy"><label class="product-field">镜头旁白与字幕<textarea v-model="shot.text" :disabled="locked" maxlength="500" :aria-label="'镜头 '+(index+1)+' 旁白与字幕'"/></label><template v-if="needsChineseDesign(shot)"><p class="product-help">{{displayShots[index].translated?'中文阅读译稿；采用后才能编辑设计。':'旧镜头需要转换为中文后再编辑。'}}</p><p>画面：{{displayShots[index].visual}}</p><p v-if="introduction">动作：{{displayShots[index].action}}</p><p v-if="introduction">运镜：{{displayShots[index].camera}}</p><button v-if="displayShots[index].translated" :disabled="locked" @click="editChineseDesign(index)">使用中文译稿编辑此镜头</button></template><template v-else><label class="product-field">画面说明<textarea v-model="shot.visual" :disabled="locked" maxlength="1500" :aria-label="'镜头 '+(index+1)+' 画面说明'" :placeholder="introduction?'描述产品应出现的场景、构图与细节':'使用商品原图展示与转场，说明保留供核对。'"/></label><template v-if="introduction"><label class="product-field">主体动作<textarea v-model="shot.action" :disabled="locked" maxlength="1200" placeholder="例如：羽毛随逗猫棒轻轻摆动，保持商品结构一致"/></label><label class="product-field">景别与运镜<input v-model="shot.camera" :disabled="locked" maxlength="400" placeholder="例如：细节近景，镜头缓慢横移"/></label></template></template><template v-if="introduction"><label class="product-field">屏显卖点（最多160字）<input v-model="shot.sellingPoint" :disabled="locked" maxlength="160" :aria-label="'镜头 '+(index+1)+' 屏显卖点'" placeholder="核对与确认稿一致的产品特点，不升级为实测功效"/></label><label class="product-field">卖点依据<textarea v-model="shot.evidence" :disabled="locked" maxlength="1000" :aria-label="'镜头 '+(index+1)+' 卖点依据'" placeholder="填写详情页明确提供的依据；无可靠依据请删除对应功效表述"/></label></template></div></div></article></div>
    <template v-if="introduction"><p class="product-help">第二步确认的是旁白正文，生成前仍需逐镜核对屏显卖点、事实依据和主体动作。按确认稿和配音时间轴准备分镜，商品原图会成为可替换的首帧。生成真实动态后仍需检查商品外观、动作和包装文字；图标与文字由合成单独叠加。不会自动提交全部镜头。</p><div class="product-actions"><button class="primary" :disabled="locked||!!introductionReason" :title="introductionReason" @click="prepareIntroduction"><I :name="operation==='prepare'?'LoaderCircle':'Clapperboard'" :class="{spin:operation==='prepare'}" :size="16"/>{{operation==='prepare'?'准备分镜中…':preparedIntroduction?'重新核对产品介绍分镜':'准备产品介绍分镜'}}</button><span class="product-help">{{preparedIntroduction?'已有分镜和候选保留；输入变化时需要核对后继续。':'下一步可逐镜改动作、生成视频、预览和选用。'}}</span></div></template>
    <template v-else><p class="product-help">修改镜头文字后需与第二步已确认正文一致；调整图片、画面说明或时长不重新生成声音。此方式保留商品原图，通过原图展示与转场合成。</p><div class="product-actions"><button class="primary" :disabled="locked||!!generationReason" :title="generationReason" @click="renderVideo"><I :name="operation==='video'?'LoaderCircle':'Video'" :class="{spin:operation==='video'}" :size="16"/>{{operation==='video'?'生成视频中…':'生成原图展示视频'}}</button></div></template>
   </template>
  </article>
  <StoryStudio ref="storyEditor" v-if="props.phase==='video'&&introduction&&preparedIntroduction" :key="d.id+':product'" product-mode/>
  <article v-if="props.phase==='video'&&!introduction" class="card product-preview">
   <p v-if="error&&errorAt==='use'" class="product-error" role="alert">{{error}}</p>
   <div class="card-heading"><h4>视频预览与后续制作</h4><select v-if="videoRuns.length>1" :value="previewRun?.id" :disabled="locked" aria-label="商品宣传视频版本" @change="previewRunId=$event.target.value"><option v-for="(run,index) in videoRuns" :key="run.id" :value="run.id">视频版本 {{videoRuns.length-index}}</option></select></div>
   <MediaPreview :id="preview?.asset?.id||''" title="商品视频将在这里预览" description="完成资料核对与分镜编辑后，点击生成商品宣传视频。"/>
   <p v-if="preview" class="product-help">成片：{{preview.asset.name||'商品宣传视频'}}<template v-if="Number(preview.duration)>0"> · 实际时长 {{Number(preview.duration).toFixed(1)}} 秒</template> · {{preview.audioId?'含旁白配音':'无旁白配音'}}</p>
   <ul v-if="preview?.warnings?.length" class="product-warnings"><li v-for="(warning,index) in preview.warnings" :key="index">{{warning}}</li></ul>
   <p v-if="previewStale&&preview" class="product-notice">当前文案尚未确认，或商品、分镜、正文及配音已变化。这份视频可继续预览，请确认输入并重新生成匹配的版本后选用。</p>
   <p class="product-help">检查商品外观、文字、配音和节奏后，选用进入「网感剪辑」添加音乐、标题与字幕样式。脚本已生成，无需重复改写。</p>
   <button class="primary" :disabled="locked||previewStale||!preview?.asset?.id" @click="useVideo"><I name="Scissors" :size="16"/>{{operation==='use'?'选用中…':'使用此视频，进入网感剪辑'}}</button>
  </article>
 </section>
</template>
