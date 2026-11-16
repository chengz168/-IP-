<script setup>
import {computed,inject,ref} from 'vue';
import I from './Icon.vue';
import Modal from './Modal.vue';
import {call} from '../api';
const {state,busy,act,notify}=inject('studio');
const search=ref(''),editing=ref(null),deleting=ref(null);
const records=computed(()=>state.value.accounts.filter(a=>(a.displayName||a.name).includes(search.value)));
const labels={unconnected:'未连接',waiting_login:'等待登录',needs_login:'需要登录',needs_check:'待检查',connected:'已登录',failed:'连接失败'};
function add(){editing.value={name:'',platform:'抖音',displayName:''};}
async function save(){const result=await act('保存账号',()=>call('saveResource',{type:'account',item:editing.value}));if(result){editing.value=null;notify('账号已保存','success');}}
async function connect(account){await act('打开平台登录',()=>call('openAccountLogin',{accountId:account.id}));}
async function check(account){const result=await act('检查平台连接',()=>call('checkAccountConnection',{accountId:account.id}));if(result)notify(result.connection.message,result.connection.status==='connected'?'success':'info');}
async function close(account){await act('关闭登录窗口',()=>call('closeAccountLogin',{accountId:account.id}));}
async function remove(){const result=await act('删除账号',()=>call('deleteResource',{type:'account',id:deleting.value.id}));if(result){deleting.value=null;notify('账号已删除','success');}}
</script>
<template>
 <section class="management-page accounts-page"><div class="management-title"><div><h1>账号管理</h1><p>管理发布账号记录与连接状态</p></div></div>
  <div class="toolbar account-main-toolbar"><button class="primary" :disabled="!!busy" @click="add"><I name="Plus" :size="16"/>添加账号</button><div class="spacer"></div><div v-if="state.accounts.length" class="search"><I name="Search" :size="18"/><input v-model="search" placeholder="输入名称搜索" aria-label="搜索账号"/></div></div>
  <article class="card resource-library"><div v-if="records.length" class="resource-grid"><article v-for="account in records" :key="account.id" class="resource-card"><div class="resource-visual"><I name="Users" :size="44"/><span class="badge">{{labels[account.connection?.status]||'未连接'}}</span></div><h3>{{account.displayName||account.name}}</h3><p class="hint">{{account.platform}}</p><p class="account-connection-note" role="status">{{account.connection?.message||'请登录并检查平台连接'}}</p><div class="account-connection-actions"><button :disabled="!!busy" @click="connect(account)">登录</button><button :disabled="!!busy||account.platform!=='抖音'" @click="check(account)">检查连接</button><button :disabled="!!busy" @click="close(account)">关闭窗口</button></div><div class="toolbar"><button :disabled="!!busy" @click="editing=JSON.parse(JSON.stringify(account))">编辑</button><div class="spacer"></div><button :disabled="!!busy" aria-label="删除账号" @click="deleting=account"><I name="Trash2" :size="17"/></button></div></article></div>
   <div v-else class="empty-state"><I name="Users" :size="52"/><h3>{{state.accounts.length?'没有匹配账号':'还没有发布账号'}}</h3><p>添加账号后，打开平台登录窗口并检查连接。</p><button class="primary" :disabled="!!busy" @click="add"><I name="Plus"/>立即添加</button></div>
  </article>
 </section>
 <Modal v-if="editing" :title="editing.id?'编辑账号':'添加账号'" variant="resource" @close="editing=null"><label>平台类型<select v-model="editing.platform" aria-label="平台类型"><option v-for="platform in ['抖音','快手','小红书','视频号','哔哩哔哩']" :key="platform">{{platform}}</option></select></label><label>账号名称 <b class="required">*</b><input v-model="editing.name" maxlength="30" placeholder="输入账号名称或用户名" aria-label="账号名称"/></label><label>显示名称<input v-model="editing.displayName" maxlength="30" placeholder="输入显示名称（可选）" aria-label="显示名称"/></label><template #footer><button :disabled="!!busy" @click="editing=null">取消</button><button class="primary" :disabled="!!busy" @click="save">{{editing.id?'保存':'添加'}}</button></template></Modal>
 <Modal v-if="deleting" title="确认删除" @close="deleting=null"><p>删除“{{deleting.name}}”？被任务引用的账号需要先解除引用。</p><template #footer><button @click="deleting=null">取消</button><button class="danger-button" :disabled="!!busy" @click="remove">删除</button></template></Modal>
</template>
<style scoped>
.account-connection-note{font-size:var(--app-font-size-micro);line-height:1.7;color:#aebbd0;overflow-wrap:anywhere;min-height:3.4em;margin:8px 0 12px}.account-connection-actions{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 12px}.account-connection-actions>button{font-size:var(--app-font-size-caption);padding:5px 9px;min-height:32px}.resource-card>.toolbar{margin-bottom:0}
</style>
