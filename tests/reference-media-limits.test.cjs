const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {validateReferenceDuration}=require('../server/reference-media-limits.cjs');
const {Store}=require('../server/store.cjs'),{LocalLinkExtractor}=require('../server/local-link-extractor.cjs'),{ReferenceSource}=require('../server/reference-source.cjs');
test('长参考接受38分钟和60分钟边界，拒绝未知时长和超限内容',()=>{
 for(const n of [2278.24,3600])assert.equal(validateReferenceDuration(n),n);
 for(const n of [null,undefined,'',0,-1,NaN,Infinity])assert.throws(()=>validateReferenceDuration(n),/有效时长/);
 assert.throws(()=>validateReferenceDuration(3600.01),/60分钟/);
});
test('长访谈经浏览器下载和参考来源连续校验，通过后保留真实时长；超限不登记素材或调用识别',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'long-reference-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const store=new Store(root);let duration=2278.24,calls=0;
 const media={probe:async()=>({format:{duration},streams:[{codec_type:'video'},{codec_type:'audio'}]})};
 const providers={transcribe:async()=>{calls++;return {text:'这是接口边界夹具，非真实识别结果',segments:[]};},config:()=>({})};
 const parser=new LocalLinkExtractor(store,media,providers),source=new ReferenceSource({store,media,providers});
 const input=path.join(root,'download.mp4');fs.writeFileSync(input,'媒体边界夹具');
 const result=await parser.extractDownloaded(input,'https://video.test/long');
 const checked=await source.validate(result.sourceAssetId);assert.equal(checked.duration,2278.24);assert.equal(calls,1);assert.equal(result.linkSource.duration,checked.duration);
 duration=3601;fs.writeFileSync(input,'超限边界夹具');const count=store.data.assets.length;
 await assert.rejects(parser.extractDownloaded(input,'https://video.test/long'),/60分钟/);assert.equal(calls,1);assert.equal(store.data.assets.length,count);assert(!fs.existsSync(input));
 await assert.rejects(source.validate(result.sourceAssetId),/60分钟/);
});
