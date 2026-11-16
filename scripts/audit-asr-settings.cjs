const fs=require('node:fs');
const path=require('node:path');
module.exports=async function auditAsrSettings(page,label){
  const directory=path.resolve('evidence/validation/local-asr/settings-'+label);fs.mkdirSync(directory,{recursive:true});
  await page.getByRole('button',{name:'菜单',exact:true}).click();await page.getByRole('navigation',{name:'主菜单'}).getByRole('button',{name:'设置',exact:true}).click();
  await page.locator('.settings-nav').getByRole('button',{name:'模型设置',exact:true}).click();
  const states=[];
  for(const value of ['local-whisper','compatible']){
    await page.getByRole('combobox',{name:'识别接入方式',exact:true}).selectOption(value);await page.locator('.asr-settings').scrollIntoViewIfNeeded();await page.mouse.move(700,30);
    await page.evaluate(async()=>{await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
    const geometry=await page.locator('.asr-settings').evaluate(section=>{
      const box=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,right:r.right};};
      const controls=[...section.querySelectorAll('.two-fields select,.two-fields input')].map(box),body=section.closest('.settings-body'),issues=[];
      if(controls.length!==2||Math.abs(controls[0].y-controls[1].y)>1||Math.abs(controls[0].height-controls[1].height)>1)issues.push('双列控件未对齐');
      if(body.scrollWidth>body.clientWidth+1||document.documentElement.scrollWidth>innerWidth+1)issues.push('水平溢出');
      const fields=[...section.querySelectorAll('.settings-field')].map(label=>({label:box(label),input:box(label.querySelector('input'))}));
      for(const field of fields){if(Math.abs(field.label.x-field.input.x)>1)issues.push('路径字段左侧未对齐');}
      return {window:{width:innerWidth,height:innerHeight},section:box(section),controls,fields,issues};
    });
    await page.screenshot({path:path.join(directory,value+'.png')});states.push({mode:value,...geometry});
  }
  await page.getByRole('combobox',{name:'识别接入方式',exact:true}).selectOption('local-whisper');
  await page.locator('.settings-body').evaluate(e=>e.scrollTop=e.scrollHeight);await page.screenshot({path:path.join(directory,'footer.png')});
  const footer=await page.locator('.settings-footer').evaluate(e=>{const r=e.getBoundingClientRect();return {bottom:r.bottom,visible:r.y>=0&&r.bottom<=innerHeight};});
  const report={checkedAt:new Date().toISOString(),label,states,footer,scope:'本地/兼容识别设置的对齐、路径字段、滚动边界；不代表原厂像素一致'};
  fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify(report,null,2));return report;
};
