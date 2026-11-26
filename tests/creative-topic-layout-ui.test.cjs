const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const vue=require('vue'),{parse,compileTemplate}=require('@vue/compiler-sfc'),{compile}=require('@vue/compiler-dom'),{renderToString}=require('@vue/server-renderer');
const read=file=>fs.readFileSync(path.resolve(__dirname,'../src',file),'utf8');
async function render(template,context){const code=compile(template,{mode:'function',prefixIdentifiers:true}).code;return renderToString(vue.createSSRApp({setup:()=>context,render:new Function('Vue',code)(vue)}));}

test('低置信度显示类型待确认，明确证据类型仍显示名称',async()=>{
 const {descriptor}=parse(read('components/CreativePresets.vue'));
 const fragment=descriptor.template.content.match(/<div class="creative-content-profile-head">[\s\S]*?<\/div>/)?.[0];assert(fragment);
 const low=await render(fragment,{contentProfile:{name:'口播表达',confidence:'low'},contentConfidenceLabel:'低'});assert.match(low,/类型待确认/);assert.doesNotMatch(low,/口播表达/);
 const medium=await render(fragment,{contentProfile:{name:'商品宣传',confidence:'medium'},contentConfidenceLabel:'中'});assert.match(medium,/商品宣传/);assert.match(medium,/置信度：中/);
});

test('视觉风格长值在可换行文本域中保留，运行时仍禁用编辑',async()=>{
 const source=read('components/StoryStudio.vue'),{descriptor}=parse(source);
 const fragment=descriptor.template.content.match(/<label>视觉风格[\s\S]*?<\/label>/)?.[0];assert(fragment);
 const value='自然写实的工厂产品介绍，保持实物外观，金属细节自然，无夸张美化。';
 const html=await render(fragment,{story:{style:value},locked:true});assert.match(html,/<textarea/);assert.match(html,/rows="2"/);assert.match(html,/aria-label="视觉风格"/);assert.match(html,/disabled/);assert.ok(html.includes(value));assert.doesNotMatch(html,/<input/);
 assert.deepEqual(compileTemplate({id:'story-long-style',filename:'StoryStudio.vue',source:descriptor.template.content}).errors,[]);
 assert.match(read('story-studio.css'),/\.story-studio \.story-style-input\{[^}]*overflow-wrap:anywhere/);
});
