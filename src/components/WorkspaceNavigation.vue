<script setup>
import {inject} from 'vue';
import I from './Icon.vue';
defineProps({page:String,view:String});
const {navigate,newTask,busy,workflowLocked}=inject('studio');
const groups=[
 {label:'创作',items:[['new','创作工作台','House'],['tasks','任务中心','List'],['old','旧工作流','FlaskConical']]},
 {label:'资源',items:[['voices','声音管理','Volume2'],['avatars','形象管理','User'],['assets','素材管理','FolderOpen']]},
 {label:'工作台',items:[['accounts','账号管理','Users'],['settings','设置','Settings'],['help','使用帮助','HelpCircle']]}
];
</script>
<template>
 <aside class="workspace-navigation">
  <button class="primary workspace-new" :disabled="!!busy||workflowLocked" @click="newTask"><I name="Plus" :size="17"/>新建创作</button>
  <nav aria-label="工作台导航">
   <section v-for="group in groups" :key="group.label" class="workspace-nav-group">
    <h2>{{group.label}}</h2>
    <button v-for="[id,label,icon] in group.items" :key="id" :class="{selected:['new','old'].includes(id)?page==='workflow'&&view===id:page===id}" :aria-current="(['new','old'].includes(id)?page==='workflow'&&view===id:page===id)?'page':undefined" @click="navigate(id)"><I :name="icon" :size="18"/><span>{{label}}</span></button>
   </section>
  </nav>
  <div class="workspace-nav-footer"><span class="workspace-local-dot"></span>本地创作工作台<small>Ctrl + S 保存</small></div>
 </aside>
</template>
