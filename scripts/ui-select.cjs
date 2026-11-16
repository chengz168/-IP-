// 用真实点击操作自定义菜单，同时兼容尚未替换的原生下拉框。
async function selectOption(page,control,value){
 if(await control.evaluate(element=>element.tagName==='SELECT'))return control.selectOption(String(value));
 await control.click();
 const id=await control.getAttribute('aria-controls');
 if(!id)throw Error('下拉菜单未展开');
 const menu=page.locator('[id='+JSON.stringify(id)+']');
 const values=await menu.locator('[role="option"]').evaluateAll(elements=>elements.map(element=>element.dataset.value));
 const index=values.indexOf(String(value));
 if(index<0)throw Error('菜单中不存在选项：'+value+'；可选值：'+values.join('、'));
 await menu.locator('[role="option"]').nth(index).click();
}
async function selectValue(control){return control.evaluate(element=>element.tagName==='SELECT'?element.value:element.dataset.value);}
module.exports={selectOption,selectValue};
