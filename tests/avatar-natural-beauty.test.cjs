const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');

const python=process.env.PORTRAIT_PYTHON||'D:\\AI-Runtimes\\super-ip\\qwen3-tts-voice-design\\.venv\\Scripts\\python.exe';
const worker=path.join(__dirname,'..','integrations','portrait-matting','worker.py');
const available=fs.existsSync(python);

test('皮肤子进程错误在临时文件清理前形成限长诊断',{skip:available?false:'未配置本机人物Python'},()=>{
 const code=String.raw`
import runpy,sys,tempfile,pathlib
f=runpy.run_path(sys.argv[1])['skin_failure']
with tempfile.TemporaryDirectory() as folder:
    log=pathlib.Path(folder)/'skin-mask.log'
    log.write_bytes(b'x'*9000+b'\nModuleNotFoundError: cv2')
    message=f('启动失败',log)
    log.unlink()
    assert 'ModuleNotFoundError: cv2' in message and len(message)<2600
    assert '未提供错误详情' in f('启动失败',log)
print('diagnostic-preserved')
`;
 const result=spawnSync(python,['-c',code,worker],{encoding:'utf8',windowsHide:true});
 assert.equal(result.status,0,result.stderr);assert.equal(result.stdout.trim(),'diagnostic-preserved');
});

test('自然美颜可关闭且仅改变真实语义肤区，透明前景及五官空洞保持原像素',{skip:available?false:'未配置本机人物Python'},()=>{
 const code=String.raw`
import runpy,sys,json
import numpy as np
from PIL import Image,ImageFilter
f=runpy.run_path(sys.argv[1])['natural_beauty']
rng=np.random.default_rng(20261117)
image=np.empty((96,96,3),dtype=np.float32)
image[:]=[.70,.50,.38]
image+=rng.uniform(-.02,.02,image.shape).astype(np.float32)
mask=np.zeros((96,96),dtype=np.float32)
mask[16:80,16:80]=1
mask[40:48,28:36]=0
mask[40:48,60:68]=0
mask[62:70,40:56]=0
alpha=np.ones((96,96),dtype=np.float32)
disabled,stats=f(image,alpha,0,np,Image,ImageFilter)
assert np.array_equal(disabled,image)
active,stats=f(image,alpha,12,np,Image,ImageFilter,face_mask=mask)
assert np.array_equal(active[mask==0],image[mask==0])
assert np.any(active[mask>0]!=image[mask>0])
assert stats['skinMaskPixels']>0
transparent,_=f(image,np.zeros((96,96),dtype=np.float32),30,np,Image,ImageFilter,face_mask=mask)
assert np.array_equal(transparent,image)
missing,stats=f(image,alpha,30,np,Image,ImageFilter,face_mask=np.zeros((96,96),dtype=np.float32))
assert np.array_equal(missing,image)
assert stats['skinMaskPixels']==0
try:
    f(image,alpha,12,np,Image,ImageFilter)
    raise AssertionError('缺少真实mask不应偷偷全脸处理')
except RuntimeError:
    pass
print(json.dumps({'disabledExact':True,'outsideSkinExact':True,'transparentExact':True,'noFaceSkipped':True}))
`;
 const result=spawnSync(python,['-c',code,worker],{encoding:'utf8',windowsHide:true});
 assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout),{disabledExact:true,outsideSkinExact:true,transparentExact:true,noFaceSkipped:true});
});

test('真实图片背景居中适配不改来源且拒绝错误哈希',{skip:available?false:'未配置本机人物Python'},()=>{
 const code=String.raw`
import runpy,sys,tempfile,pathlib,hashlib,json
import numpy as np
from PIL import Image
f=runpy.run_path(sys.argv[1])['image_background']
with tempfile.TemporaryDirectory() as folder:
    source=pathlib.Path(folder)/'background.png'
    Image.new('RGB',(300,100),(64,128,192)).save(source)
    before=source.read_bytes()
    spec={'path':str(source),'sha256':hashlib.sha256(before).hexdigest(),'assetId':'test'}
    out=f(spec,40,80,np,Image)
    assert out.shape==(80,40,3)
    assert np.max(np.abs(out[0,0]-np.array([64,128,192])/255))<.000001
    assert source.read_bytes()==before
    try:
        f({**spec,'sha256':'wrong'},40,80,np,Image)
        raise AssertionError('哈希不符必须拒绝')
    except RuntimeError:
        pass
print(json.dumps({'sizeVerified':True,'sourcePreserved':True,'hashRejected':True}))
`;
 const result=spawnSync(python,['-c',code,worker],{encoding:'utf8',windowsHide:true});
 assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout),{sizeVerified:true,sourcePreserved:true,hashRejected:true});
});
