<script setup>
import {computed,inject,ref,watch} from 'vue';
import I from './Icon.vue';
import MediaPreview from './MediaPreview.vue';
import Modal from './Modal.vue';
import PublishTags from './PublishTags.vue';
import PublishAccountModal from './PublishAccountModal.vue';
import ACheckbox from 'ant-design-vue/es/checkbox';
import {mediaUrl,call} from '../api';
const emit=defineEmits(['choose','export']);
const {state,draft:d,busy,navigate,act,notify,refresh}=inject('studio');
const review=ref(null),coverPreviewId=ref(''),addingAccount=ref(false);
const stopping=ref(false),latestPublish=computed(()=>state.value.runs.find(r=>r.type==='publish'&&r.draftId===d.value.id));
const publishing=computed(()=>['running','queued'].includes(latestPublish.value?.status));
const resultLabels={queued:'待处理',running:'处理中',succeeded:'成功',failed:'失败',cancelled:'已停止',unknown:'结果待确认',interrupted:'已中断'};
watch(()=>d.value.publish.mode,mode=>{if(mode==='draft'&&d.value.publish.autoCloseBrowser)d.value.publish.autoCloseBrowser=false;});
const labels={unconnected:'未连接',waiting_login:'等待登录',needs_login:'需要登录',needs_check:'待检查',connected:'已登录',failed:'连接失败'};
const videoId=computed(()=>d.value.publish.videoId||d.value.edit.resultId||d.value.video.assetId);
const coverId=computed(()=>d.value.publish.coverId||d.value.cover.assetId);
// 换稿或换图时关闭旧预览，迟到的旧图片错误不能影响当前封面。
watch(()=>[d.value.id,coverId.value],()=>coverPreviewId.value='');
function openCoverPreview(){if(coverId.value)coverPreviewId.value=coverId.value;}
function coverPreviewError(event){if(event.target.getAttribute('src')!==mediaUrl(coverId.value))return;coverPreviewId.value='';notify('封面图片加载失败，请检查文件路径','error');}
const videoName=computed(()=>state.value.assets.find(a=>a.id===videoId.value)?.name||'未选择发布视频');
const platformBadges={'抖音':['抖','#000000'],'快手':['快','#ff6600'],'小红书':['书','#ff2442'],'视频号':['微','#07c160'],'哔哩哔哩':['B','#00a1d6']};
const accountSelected=account=>d.value.publish.accountIds.includes(account.id);
function toggleAccount(account){
  if(busy.value||publishing.value)return;
  const selected=d.value.publish.accountIds;
  // 已选账号失去连接后仍允许取消，新增选择必须有真实连接依据。
  if(selected.includes(account.id))d.value.publish.accountIds=selected.filter(id=>id!==account.id);
  else if(account.connection?.status==='connected')d.value.publish.accountIds=[...selected,account.id];
}
// 表单或登录状态变化后撤销旧检查，防止把过时清单当成当前结果。
const formSignature=()=>JSON.stringify({draftId:d.value.id,publish:d.value.publish,videoId:videoId.value,coverId:coverId.value});
watch(()=>formSignature()+JSON.stringify(state.value.accounts),()=>review.value=null);
async function prepare(){const before=formSignature(),result=await act('发布前检查',()=>call('reviewPublish',{id:d.value.id}));if(result&&before===formSignature()&&d.value.id===result.draftId)review.value=result;}
async function submit(){if(!review.value||publishing.value||busy.value)return;const input=review.value,result=await act('启动发布',()=>call('publish',{id:input.draftId,reviewId:input.reviewId}));if(result){review.value=null;notify(input.mode==='draft'?'已启动上传并保存平台草稿':'已启动上传及发布，请查看逐账号结果');}}
async function stop(){if(stopping.value||!publishing.value)return;stopping.value=true;try{await call('cancelRun',{id:latestPublish.value.id});await refresh();notify('已请求停止后续操作，平台已收到的文件或提交仍需核对');}catch(error){notify(error.message,'error');}finally{stopping.value=false;}}
</script>
<template>
  <div class="publish-columns">
    <article class="card publish-material">
      <div class="card-heading"><h3>发布素材</h3><button class="pill" :disabled="publishing" @click="emit('choose','video',a=>d.publish.videoId=a.id,'选择发布视频')"><I name="FolderOpen" :size="16"/>选择视频</button></div>
      <div class="publish-video"><div class="publish-source"><span>视频地址</span><strong :title="videoName">{{videoName}}</strong></div><MediaPreview :id="videoId" title="暂无发布视频" description="默认使用上一步视频，也可以手动选择。"/></div>
      <div class="publish-copy"><fieldset class="publish-copy-fields" :disabled="publishing"><label>标题<input v-model="d.publish.title" maxlength="100" placeholder="输入发布标题" aria-label="作品标题"/></label><label>描述<textarea v-model="d.publish.description" rows="2" placeholder="输入发布描述" aria-label="作品描述"></textarea></label><PublishTags :key="d.id" v-model="d.publish.tags"/></fieldset><div class="publish-cover"><button v-if="coverId" type="button" class="cover-preview-trigger" aria-label="放大预览封面" @click="openCoverPreview"><img :key="coverId" :src="mediaUrl(coverId)" alt="发布封面" @error="coverPreviewError"/></button><div v-else class="cover-empty"><I name="Image" :size="18"/></div><button class="pill" :disabled="publishing" @click="emit('choose','image',a=>d.publish.coverId=a.id,'选择发布封面')">选择封面</button></div></div>
    </article>
    <article class="card publish-config">
      <div class="card-heading"><h3>发布配置</h3><button class="pill" :disabled="!!busy" @click="addingAccount=true"><I name="Plus" :size="17"/>添加平台账号</button></div>
      <div class="publish-account-heading">发布账号<span>先在账号管理登录并检查连接</span></div>
      <div class="publish-accounts"><div v-if="state.accounts.length" class="publish-account-grid"><button v-for="a in state.accounts" :key="a.id" type="button" class="publish-account-card" :class="{selected:accountSelected(a)}" role="checkbox" :aria-label="a.displayName||a.name" :aria-checked="accountSelected(a)" :title="(a.displayName||a.name)+' · '+(a.connection?.message||'请登录并检查连接')" :disabled="!!busy||(!accountSelected(a)&&a.connection?.status!=='connected')" @click="toggleAccount(a)"><span class="publish-account-avatar" :style="{background:platformBadges[a.platform]?.[1]||'#1890ff'}">{{platformBadges[a.platform]?.[0]||a.platform?.slice(0,1)}}</span><span class="publish-account-card-main"><b>{{a.displayName||a.name}}</b><small><span>{{a.platform}}</span><em>{{labels[a.connection?.status]||'未连接'}}</em></small></span><span class="publish-account-check" aria-hidden="true">✓</span></button></div><div v-else class="publish-account-empty"><I name="Users" :size="24"/><strong>暂无可用账号</strong><button class="text-button" :disabled="!!busy" @click="addingAccount=true">去添加账号</button></div></div>
      <div class="publish-mode"><span>发布方式</span><div class="segmented"><button :disabled="publishing" :class="{active:d.publish.mode==='draft'}" @click="d.publish.mode='draft'">草稿</button><button :disabled="publishing" :class="{active:d.publish.mode==='direct'}" @click="d.publish.mode='direct'">直接发布</button></div></div>
      <div v-if="d.publish.mode==='direct'" class="publish-auto-close"><ACheckbox v-model:checked="d.publish.autoCloseBrowser" :disabled="publishing">发布后关闭浏览器</ACheckbox></div>
      <button class="primary full" :disabled="!!busy||publishing||latestPublish?.status==='unknown'||!videoId||!d.publish.title.trim()||!d.publish.accountIds.length" @click="prepare"><I name="Upload" :size="17"/>{{publishing?'正在发布…':busy==='发布前检查'?'检查中…':'立即发布'}}</button>
      <button class="secondary full" :disabled="!!busy||!videoId" @click="emit('export')"><I name="Download" :size="17"/>导出发布包</button>
      <p class="hint">当前接入抖音账号窗口上传；确认清单后执行所选发布方式。其他平台尚未接入，导出不代表已发布。</p>
      <div v-if="latestPublish" class="publish-result" role="status"><strong>{{latestPublish.message||resultLabels[latestPublish.status]}}</strong><div v-for="account in latestPublish.accounts" :key="account.id" class="publish-result-row"><b>{{account.name}} · {{resultLabels[account.status]}}</b><span>{{account.error||account.warning||account.message||''}}</span></div><p v-if="latestPublish.status==='unknown'">请到账号窗口核对本次视频或草稿。结果未确认前不会再次提交。</p><button v-if="publishing" :disabled="stopping" @click="stop">{{stopping?'正在停止…':'停止后续发布'}}</button><button v-else-if="latestPublish.status==='unknown'" @click="navigate('accounts')">去账号管理核对</button></div>
    </article>
  </div>
  <PublishAccountModal v-if="addingAccount" @close="addingAccount=false"/>
  <Modal v-if="coverPreviewId" title="封面预览" variant="publish-cover-preview" @close="coverPreviewId=''">
    <div class="publish-cover-preview-body"><img class="publish-cover-preview-image" :src="mediaUrl(coverPreviewId)" alt="封面预览" @error="coverPreviewError"/></div>
  </Modal>
  <Modal v-if="review" :title="review.mode==='draft'?'确认上传并保存草稿':'确认上传并直接发布'" :mask-closable="false" @close="review=null">
    <p class="publish-review-note" role="status">{{review.message}}</p>
    <dl class="publish-review-list"><dt>发布方式</dt><dd>{{review.mode==='draft'?'保存草稿':'直接发布'}}</dd><dt>视频</dt><dd>{{review.video.name}} · {{review.video.duration.toFixed(2)}} 秒</dd><dt>封面</dt><dd>{{review.cover?.name||'未选择封面'}}</dd><dt>标题</dt><dd>{{review.title}}</dd><dt>描述</dt><dd>{{review.description||'未填写'}}</dd><dt>标签</dt><dd>{{review.tags?.join(' ')||'未填写'}}</dd><dt>账号</dt><dd><div v-for="account in review.accounts" :key="account.id">{{account.platform}} · {{account.name}}</div></dd></dl>
    <template #footer><button :disabled="!!busy" @click="review=null">返回编辑</button><button class="primary" :disabled="!!busy" @click="submit">{{review.mode==='draft'?'确认上传并保存草稿':'确认上传并直接发布'}}</button></template>
  </Modal>
</template>
<style scoped>
.publish-account-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.check-row small{flex-shrink:0}.publish-review-note{line-height:1.7;color:#aebbd0;margin:0 0 20px}.publish-review-list{display:grid;grid-template-columns:76px minmax(0,1fr);gap:14px 16px;margin:0;line-height:1.7}.publish-review-list dt{color:#aebbd0}.publish-review-list dd{margin:0;overflow-wrap:anywhere;white-space:pre-wrap}
fieldset.publish-copy-fields{border:0;padding:0;margin:0;min-width:0}.publish-auto-close{display:flex;align-items:center;gap:8px;margin-top:12px;padding:10px 12px;border-radius:12px;color:var(--muted);background:#20222e47;border:1px solid #ffffff08;font-size:var(--app-font-size-meta)}.publish-auto-close :deep(.ant-checkbox-wrapper){margin:0;color:inherit;font:inherit;align-items:center}.publish-auto-close :deep(input.ant-checkbox-input){appearance:none;width:100%;height:100%;min-height:0;margin:0;padding:0;border:0;border-radius:0;background:transparent}.publish-auto-close :deep(input.ant-checkbox-input::after){display:none}.publish-result{display:flex;flex-direction:column;gap:12px;margin-top:16px;padding:14px;border:1px solid #41485c;border-radius:12px;line-height:1.6;overflow-wrap:anywhere}.publish-result-row{display:flex;flex-direction:column;gap:4px}.publish-result-row span,.publish-result p{font-size:.86em;color:#aebbd0}.publish-result p{margin:0}
</style>
