const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');

function fixture(t,respond){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'product-vision-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const calls=[],module={exports:{}};
 // 隔离媒体转码，只验证真实观察函数的批次契约与拒绝行为。
 vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../server/product-vision.cjs'),'utf8'),{module,exports:module.exports,structuredClone,require:name=>name==='./media.cjs'?{runProcess:async(_binary,args)=>fs.writeFileSync(args.at(-1),'image')}:require(name)});
 const service={store:{outputDir:()=>root,asset:id=>({path:path.join(root,id+'.png')})},media:{binaries:()=>({ffmpeg:'fixture'})},providers:{config:()=>({visionModel:'configured',visionBaseUrl:'http://127.0.0.1:1'}),vision:async(_system,user,_data,_ctx,{schema})=>{const indices=JSON.parse(user).imageIndices;calls.push(JSON.parse(JSON.stringify(schema)));return {text:JSON.stringify({images:respond(indices)})};}}};
 return {root,calls,run:images=>module.exports.describeProductImages(service,images,{signal:new AbortController().signal,progress(){}})};
}
const row=index=>({index,visible:'可见蓝色商品主体',pageClaims:'',uncertainties:''});

test('真实观察函数把每批数量和全局编号写入视觉模型约束',async t=>{
 const f=fixture(t,indices=>indices.map(row)),result=await f.run(Array.from({length:7},(_,id)=>({id:String(id)})));
 assert.equal(result.status,'succeeded');assert.deepEqual(Array.from(result.observations,x=>x.index),[0,1,2,4,5,6]);
 for(const [i,expected] of [[0,[0,1,2]],[1,[4,5,6]]]){const schema=f.calls[i].properties.images;assert.equal(schema.minItems,3);assert.equal(schema.maxItems,3);assert.deepEqual(schema.items.properties.index.enum,expected);}
 assert.equal(fs.readdirSync(f.root).length,0);
});

test('单首帧编号固定0，错误编号仍拒绝且清理临时文件',async t=>{
 const f=fixture(t,()=>[row(1)]);await assert.rejects(f.run([{id:'single'}]),/未逐张对应/);
 const schema=f.calls[0].properties.images;assert.equal(schema.minItems,1);assert.equal(schema.maxItems,1);assert.deepEqual(schema.items.properties.index.enum,[0]);assert.equal(fs.readdirSync(f.root).length,0);
});
