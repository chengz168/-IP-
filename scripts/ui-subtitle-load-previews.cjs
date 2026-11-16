const fs=require('node:fs');
const {chromium}=require('C:/Users/DELL/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core');
async function main(){
  const browser=await chromium.connectOverCDP('http://127.0.0.1:9333'),page=browser.contexts()[0].pages()[0],report=[];
  try{for(const template of (await import('../server/subtitle-templates.mjs')).subtitleTemplates){const card=page.getByRole('button',{name:template.name,exact:true});await card.scrollIntoViewIfNeeded();await card.locator('img').waitFor({timeout:30000});report.push({name:template.name,loaded:await card.locator('img').evaluate(el=>el.complete&&el.naturalWidth===268)});}fs.writeFileSync('evidence/validation/dynamic-subtitles/preview-scroll-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));}finally{await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
