const fs=require('node:fs');
const path=require('node:path');
// 同步巡检中的导航名称，避免旧名称导致漏查设置页面。
for(const file of ['audit-layout.cjs','desktop-verify.js','ui-management.js','ui-settings-verify.js']){
  const target=path.join(__dirname,file),before=fs.readFileSync(target,'utf8');
  fs.writeFileSync(target,before.replaceAll("'提示词'","'提示词管理'").replaceAll("'数据管理'","'数据设置'").replaceAll("'检查更新'","'软件更新'"));
}
