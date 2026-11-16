<script setup>
import {inject,ref,watch} from 'vue';
import Modal from './Modal.vue';
import {call} from '../api';
const emit=defineEmits(['close']);
const {act,notify}=inject('studio');
const platforms=['抖音','快手','小红书','视频号','哔哩哔哩'];
const form=ref({platform:'',name:'',displayName:''}),error=ref(''),createdId=ref(''),submitting=ref(false),loggingIn=ref(false);
watch(()=>JSON.stringify(form.value),()=>{error.value='';createdId.value='';});
async function save(){
  if(submitting.value||loggingIn.value)return;
  if(!platforms.includes(form.value.platform)){error.value='请选择发布平台';return;}
  if(!form.value.name.trim()){error.value='请填写账号名称';return;}
  submitting.value=true;error.value='';
  try{
    const item={...form.value,name:form.value.name.trim(),displayName:form.value.displayName.trim()};
    const result=await act('添加发布账号',()=>call('saveResource',{type:'account',item}));
    if(result){createdId.value=result.id;notify('添加账号成功，请完成平台登录并检查连接','success');}
  }finally{submitting.value=false;}
}
async function login(){
  if(!createdId.value||submitting.value||loggingIn.value)return;
  loggingIn.value=true;
  try{
    const result=await act('打开平台登录',()=>call('openAccountLogin',{accountId:createdId.value}));
    // 本地接口只负责打开平台窗口，不能将等待用户登录冒称为登录完成。
    if(result)notify(result.connection?.message||'平台登录窗口已打开，请完成登录后检查连接');
  }finally{loggingIn.value=false;}
}
</script>
<template>
  <Modal title="添加发布账号" variant="publish-account" :mask-closable="false" :close-disabled="submitting||loggingIn" @close="emit('close')">
    <div class="publish-account-modal-body">
      <div class="publish-account-tip">添加后请到账号管理完成登录并检查连接。当前接入抖音账号窗口上传，其他平台尚未接入。</div>
      <form class="publish-account-form" @submit.prevent="save">
        <label><span><b class="required">*</b> 平台类型</span><select v-model="form.platform" aria-label="平台类型" aria-required="true" :disabled="submitting||loggingIn"><option value="" disabled>请选择发布平台类型</option><option v-for="platform in platforms" :key="platform" :value="platform">{{platform}}</option></select><small>请选择要发布的平台，例如某音、小某书、某手。</small></label>
        <label><span><b class="required">*</b> 账号名称</span><input v-model="form.name" aria-label="账号名称" aria-required="true" maxlength="30" placeholder="输入账号名称或用户名" :disabled="submitting||loggingIn"/></label>
        <label><span>显示名称</span><input v-model="form.displayName" aria-label="显示名称" maxlength="30" placeholder="输入显示名称（可选）" :disabled="submitting||loggingIn"/></label>
        <p v-if="error" class="publish-account-error" role="alert">{{error}}</p>
        <div class="publish-account-actions"><button type="button" :disabled="submitting||loggingIn" @click="emit('close')">取消</button><button v-if="createdId" type="button" :disabled="submitting||loggingIn" @click="login">{{loggingIn?'登录中...':'登录账号'}}</button><button type="submit" class="primary" :disabled="submitting||loggingIn">{{submitting?'添加中...':'添加账号'}}</button></div>
      </form>
    </div>
  </Modal>
</template>
