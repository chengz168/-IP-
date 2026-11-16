const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {assetResponse}=require('../server/asset-response.cjs');
test('桌面媒体响应明确WAV长度，支持完整播放、分段及无效范围',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ip-response-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const file=path.join(root,'sample.wav');fs.writeFileSync(file,Buffer.from([0,1,2,3,4,5]));const asset={path:file};
  const full=assetResponse(asset,new Request('http://local'));assert.equal(full.headers.get('content-type'),'audio/wav');assert.equal(full.headers.get('content-length'),'6');assert.equal((await full.arrayBuffer()).byteLength,6);
  const part=assetResponse(asset,new Request('http://local',{headers:{range:'bytes=2-4'}}));assert.equal(part.status,206);assert.equal(part.headers.get('content-range'),'bytes 2-4/6');assert.deepEqual([...new Uint8Array(await part.arrayBuffer())],[2,3,4]);
  const suffix=assetResponse(asset,new Request('http://local',{headers:{range:'bytes=-2'}}));assert.deepEqual([...new Uint8Array(await suffix.arrayBuffer())],[4,5]);
  const invalid=assetResponse(asset,new Request('http://local',{headers:{range:'bytes=20-'}}));assert.equal(invalid.status,416);
});
