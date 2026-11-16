const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {render}=require('../server/render.cjs'),{createDraft}=require('../server/store.cjs');

test('标题PNG尺寸错误必须失败且清理临时目录，不产生视频资产',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'title-output-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const draft=createDraft();draft.edit.titleEnabled=true;draft.edit.title='尺寸校验';draft.edit.subtitlesEnabled=false;draft.edit.pipEnabled=false;draft.edit.titleDesign=(await import('../server/title-model.mjs')).titleDesign({});
 const png=Buffer.alloc(100);Buffer.from('89504e470d0a1a0a','hex').copy(png);png.writeUInt32BE(1,16);png.writeUInt32BE(1,20);
 const media={store:{asset:()=>({id:'source',path:'仅用于提前失败契约'}),outputDir:()=>root,addAsset:()=>assert.fail('错误PNG不能写入资产')},probe:async()=>({streams:[{codec_type:'video',width:360,height:640},{codec_type:'audio'}],format:{duration:'8'}}),renderTitle:async()=>({data:'data:image/png;base64,'+png.toString('base64')})};
 await assert.rejects(render(media,draft,{}, {runProcess:()=>assert.fail('错误PNG不能进入FFmpeg')}),/标题图层尺寸或文件无效/);assert.deepEqual(fs.readdirSync(root),[]);
});
