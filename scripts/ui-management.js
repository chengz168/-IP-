async page => {
  const menu=async name=>{await page.getByRole('button',{name:'菜单',exact:true}).click();await page.getByRole('button',{name,exact:true}).click();};
  await menu('声音管理');await page.getByRole('heading',{name:'声音训练',exact:true}).waitFor();await page.screenshot({path:'evidence/implementation/manage-voices.png'});
  await page.getByRole('button',{name:'添加声音',exact:true}).click();await page.getByPlaceholder('请输入名称').fill('本地测试音色');await page.getByPlaceholder('填写服务实际返回的ID').fill('未验证测试ID');await page.getByRole('button',{name:'保存',exact:true}).click();
  await menu('形象管理');await page.screenshot({path:'evidence/implementation/manage-avatars.png'});
  await menu('素材管理');await page.screenshot({path:'evidence/implementation/manage-assets.png'});
  await menu('账号管理');await page.getByRole('button',{name:'添加账号',exact:true}).first().click();await page.getByPlaceholder('请输入名称').fill('本地验收账号');await page.getByRole('button',{name:'保存',exact:true}).click();await page.screenshot({path:'evidence/implementation/manage-accounts.png'});
  await menu('任务中心');await page.getByRole('button',{name:'执行记录',exact:true}).click();await page.screenshot({path:'evidence/implementation/manage-tasks.png'});
  await menu('设置');for(const name of ['模型设置','提示词管理','数据设置','软件更新']){await page.locator('.settings-nav').getByRole('button',{name,exact:true}).click();await page.screenshot({path:'evidence/implementation/settings-'+({'模型设置':'models','提示词管理':'prompts','数据设置':'data','软件更新':'update'}[name])+'.png'});}
  await page.getByRole('button',{name:'提示词管理',exact:true}).click();await page.getByRole('button',{name:'新增',exact:true}).click();await page.getByLabel('名称',{exact:true}).fill('本地验收提示词');await page.getByLabel('提示词内容').fill('保留真实信息，输出简洁口播正文。');await page.getByRole('button',{name:'保存提示词',exact:true}).click();
  await menu('旧工作流');await page.locator('.legacy-grid').waitFor();await page.screenshot({path:'evidence/implementation/old-workflow.png'});
  await menu('新工作流');await page.locator('.steps>button').nth(5).click();
  await page.getByRole('button',{name:'模板',exact:true}).click();await page.screenshot({path:'evidence/implementation/06-cover-templates.png'});
}
