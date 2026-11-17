import argparse
import hashlib
import json
import math
import subprocess
from pathlib import Path


def sha(file):
    value = hashlib.sha256()
    with open(file, 'rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(chunk)
    return value.hexdigest()


def studio_background(width, height, np):
    # 程序绘制无标志的浅灰商务演播室，避免重新生成或改变人物身份。
    yy, xx = np.mgrid[0:height, 0:width].astype(np.float32)
    light = np.clip(1 - ((xx / width - .42) ** 2 + (yy / height - .35) ** 2), 0, 1)
    base = np.stack([.71 + .12 * light, .74 + .12 * light, .78 + .11 * light], axis=2)
    for location in [.13, .84]:
        stripe = np.exp(-((xx / width - location) / .003) ** 2)[..., None]
        base += stripe * .055
    base[yy > height * .88] *= .93
    return np.clip(base, 0, 1)


def image_background(spec, width, height, np, Image):
    # 背景只读取明确选中的真实图片，按画幅居中裁切，不修改原图。
    from PIL import ImageOps
    file = Path(spec.get('path', ''))
    if not file.is_absolute() or not file.is_file() or sha(file) != spec.get('sha256'):
        raise RuntimeError('选中的背景图片不存在或已变化')
    with Image.open(file) as source:
        image = ImageOps.exif_transpose(source).convert('RGB')
        image = ImageOps.fit(image, (width, height), method=Image.Resampling.LANCZOS, centering=(.5, .5))
        result = np.asarray(image, dtype=np.float32) / 255
    return result


def read_frame(stream, count):
    chunks = bytearray()
    while len(chunks) < count:
        chunk = stream.read(count - len(chunks))
        if not chunk:
            if chunks:
                raise RuntimeError('人物视频解码返回不完整帧')
            return None
        chunks.extend(chunk)
    return bytes(chunks)


def read_exact(stream, count):
    chunks = bytearray()
    while len(chunks) < count:
        chunk = stream.read(count - len(chunks))
        if not chunk:
            raise RuntimeError('人脸语义分割进程提前退出')
        chunks.extend(chunk)
    return bytes(chunks)


def skin_failure(message, log_file):
    # 临时目录会回收，限长保留真正的子进程错误，不能要求用户查看已被清理的日志。
    try:
        with open(log_file, 'rb') as stream:
            stream.seek(0, 2)
            stream.seek(max(0, stream.tell() - 4096))
            detail = stream.read().decode('utf-8', errors='replace').strip()[-2500:]
    except OSError:
        detail = ''
    return message + ('：' + detail if detail else '（子进程未提供错误详情）')


def stable_white_balance(source, ffmpeg, directory, np):
    # 从原片前八秒的低饱和亮部估计一次，全片固定使用，避免逐帧色温跳动。
    with open(directory / 'white-balance.log', 'wb') as log:
        result = subprocess.run([ffmpeg, '-v', 'error', '-i', str(source), '-map', '0:v:0', '-an', '-vf', 'fps=1,scale=128:128', '-frames:v', '8', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], stdout=subprocess.PIPE, stderr=log, timeout=300)
    if result.returncode or len(result.stdout) % 3:
        raise RuntimeError('原人物视频白平衡采样失败')
    pixels = np.frombuffer(result.stdout, dtype=np.uint8).reshape(-1, 3).astype(np.float32) / 255
    if not len(pixels):
        return np.ones(3, dtype=np.float32), 0
    high, low = pixels.max(axis=1), pixels.min(axis=1)
    saturation = (high - low) / np.maximum(high, .001)
    bright = pixels[(pixels.mean(axis=1) >= .55) & (saturation <= .32)]
    if len(bright) < 128:
        return np.ones(3, dtype=np.float32), len(bright)
    # 只使用候选中最接近中性的四分之一像素，避免以肤色均值作为中性灰。
    neutral = bright[((bright.max(axis=1) - bright.min(axis=1)) / np.maximum(bright.max(axis=1), .001)) <= np.quantile((bright.max(axis=1) - bright.min(axis=1)) / np.maximum(bright.max(axis=1), .001), .25)]
    reference = np.median(neutral, axis=0)
    gains = np.clip(reference.mean() / np.maximum(reference, .01), .88, 1.14)
    return gains.astype(np.float32), len(neutral)


def _skin_candidate_mask(image, alpha, np):
    """根据像素色度和前景alpha找肤色候选，不使用固定矩形或脸型猜测。"""
    red, green, blue = image[..., 0], image[..., 1], image[..., 2]
    cb = .5 - .168736 * red - .331264 * green + .5 * blue
    cr = .5 + .5 * red - .418688 * green - .081312 * blue
    chroma = np.maximum(red, np.maximum(green, blue)) - np.minimum(red, np.minimum(green, blue))
    luminance = .299 * red + .587 * green + .114 * blue
    candidate = (
        (alpha >= .82) & (luminance >= .16) & (luminance <= .96) &
        (cr >= .48) & (cr <= .78) & (cb >= .23) & (cb <= .53) &
        (red >= green * .88) & (green >= blue * .82) & (chroma >= .025) &
        (chroma <= .48)
    )
    return candidate.astype(np.float32)


def natural_beauty(image, alpha, strength, np, Image, ImageFilter, face_mask=None):
    """对肤色候选做轻微平滑和亮度校正，保留五官、脸型、动作和衣服细节。"""
    level = float(np.clip(strength, 0, 30)) / 30.0
    if level <= 0:
        return image, {'skinMaskPixels': 0, 'skinMaskCoverage': 0.0, 'beautyStrength': 0}
    if face_mask is None:
        raise RuntimeError('自然美颜缺少人脸皮肤语义分割结果')
    mask = _skin_candidate_mask(image, alpha, np)
    if face_mask is not None:
        # 语义脸部区域是硬约束，色度候选只负责排除唇部等非皮肤区域。
        mask *= np.clip(face_mask.astype(np.float32), 0, 1)
    coverage = float(mask.mean())
    if not np.any(mask > 0):
        return image, {'skinMaskPixels': 0, 'skinMaskCoverage': coverage, 'beautyStrength': float(strength)}
    mask_image = Image.fromarray(np.round(mask * 255).astype(np.uint8))
    mask_image = mask_image.filter(ImageFilter.GaussianBlur(1.1 + 1.2 * level))
    smooth_mask = np.asarray(mask_image, dtype=np.float32) / 255.0
    # 羽化只能收窄已确认的皮肤区域，不能把权重扩散到眼睛、嘴唇和发丝。
    smooth_mask *= np.clip(face_mask.astype(np.float32), 0, 1) * np.clip(alpha, 0, 1)
    radius = .8 + 1.2 * level
    smooth = np.asarray(Image.fromarray(np.round(image * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(radius)), dtype=np.float32) / 255.0
    blend = smooth_mask[..., None] * (.07 + .10 * level)
    result = image * (1 - blend) + smooth * blend
    result = np.clip(result * (1 + smooth_mask[..., None] * (.03 * level)), 0, 1)
    return result, {'skinMaskPixels': int(np.count_nonzero(mask)), 'skinMaskCoverage': coverage, 'beautyStrength': float(strength), 'skinMaskPolicy': 'bisenet-face-skin-ycbcr-alpha-v1', 'beautyBlendRange': [.07, .17], 'beautyBrightnessGainMax': .03}


def natural_image(image, gains, np, Image, ImageFilter):
    # 人物调色在背景合成之前完成，演播室颜色不会参与白平衡估计或处理。
    image = np.clip(image * gains, 0, 1)
    pil = Image.fromarray(np.round(image * 255).astype(np.uint8))
    pil = Image.blend(pil, pil.filter(ImageFilter.GaussianBlur(.35)), .12)
    return np.asarray(pil.filter(ImageFilter.UnsharpMask(radius=.65, percent=20, threshold=3)), dtype=np.uint8).astype(np.float32) / 255


def matting_sampling(width, height):
    # 固定使用细节采样，不对alpha补洞或绘制人物轮廓；实际边缘质量仍须预览验收。
    ratio = min(960 / max(width, height), 1)
    return {'mattingSamplingPolicy': 'detail-960-v1', 'downsampleRatio': ratio, 'mattingInternalTargetSize': {'width': math.floor(width * ratio), 'height': math.floor(height * ratio)}}


def main(args):
    import numpy as np
    from PIL import Image, ImageFilter
    plan_file = Path(args.input)
    spec = json.loads(plan_file.read_text(encoding='utf-8'))
    original, source, output = Path(spec['source']), Path(spec['preparedSource']), Path(spec['output'])
    if sha(original) != spec['sourceSha256'] or sha(source) != spec['preparedSha256']:
        raise RuntimeError('原人物视频内容已变化')
    plan = spec['plan']
    width, height, expected = plan['width'], plan['height'], plan['frames']
    sampling = matting_sampling(width, height)
    beauty_strength = float(spec.get('beautyStrength', 0) or 0)
    if not math.isfinite(beauty_strength) or beauty_strength < 0 or beauty_strength > 30:
        raise RuntimeError('自然美颜强度必须是0到30的数字')
    beauty_stats = {'skinMaskPixels': 0, 'skinMaskCoverage': 0.0, 'beautyStrength': beauty_strength}
    ratio = float(np.float32(sampling['downsampleRatio']))
    sampling['downsampleRatio'] = ratio
    sampling['mattingInternalTargetSize'] = {'width': math.floor(width * ratio), 'height': math.floor(height * ratio)}
    session, states, dtype = None, None, None
    if spec['background'] != 'original':
        # 接口依据RVM官方documentation/inference.md的ONNX段落，不下载权重。
        import onnxruntime as ort
        model = Path(spec['model'])
        if sha(model) != spec['modelSha256']:
            raise RuntimeError('本机RVM模型内容已变化')
        session = ort.InferenceSession(str(model), providers=['CPUExecutionProvider'])
        inputs = {item.name: item for item in session.get_inputs()}
        if set(inputs) != {'src', 'r1i', 'r2i', 'r3i', 'r4i', 'downsample_ratio'}:
            raise RuntimeError('RVM ONNX输入接口与官方模型不一致')
        if inputs['src'].type not in ('tensor(float)', 'tensor(float16)'):
            raise RuntimeError('RVM模型输入精度不支持')
        dtype = np.float16 if inputs['src'].type == 'tensor(float16)' else np.float32
        states = [np.zeros((1, 1, 1, 1), dtype=dtype) for _ in range(4)]
    selected_background = spec.get('backgroundImage') if spec['background'] in ['content-image', 'custom-image'] else None
    background = image_background(selected_background or {}, width, height, np, Image) if selected_background is not None else studio_background(width, height, np) if session else None
    if spec['background'] in ['content-image', 'custom-image'] and selected_background is None:
        raise RuntimeError('写实背景模式缺少已选择的背景图片')
    gains, white_balance_pixels = stable_white_balance(source, args.ffmpeg, output.parent, np) if spec['look'] == 'natural' else (np.ones(3, dtype=np.float32), 0)
    decoder, encoder, skin_process = None, None, None
    decoder_log = open(output.parent / 'decoder.log', 'wb')
    encoder_log = open(output.parent / 'encoder.log', 'wb')
    frames = 0
    beauty_totals = {'frames': 0, 'skinMaskPixels': 0, 'maxSkinMaskCoverage': 0.0, 'framesWithoutSkin': 0}
    skin_log = None
    try:
        if beauty_strength > 0:
            beauty_runtime = spec.get('beautyRuntime') or {}
            beauty_python, beauty_root = Path(beauty_runtime.get('python', '')), Path(beauty_runtime.get('root', ''))
            if not beauty_python.is_absolute() or not beauty_python.is_file() or not beauty_root.is_absolute() or not beauty_root.is_dir():
                raise RuntimeError('自然美颜需要已配置的本机MuseTalk Python与目录，不自动下载')
            beauty_models = {name: sha(beauty_root / 'models' / 'face-parse-bisent' / name) for name in ['79999_iter.pth', 'resnet18-5c106cde.pth']}
            skin_log = open(output.parent / 'skin-mask.log', 'wb')
            skin_process = subprocess.Popen([str(beauty_python), '-u', str(Path(__file__).with_name('skin-mask-worker.py')), '--root', str(beauty_root), '--width', str(width), '--height', str(height)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=skin_log)
            try:
                skin_ready = json.loads(skin_process.stdout.readline(65536).decode('utf-8'))
                if skin_ready.get('kind') != 'face-skin-ready-v1' or skin_ready.get('skinClass') != 1:
                    raise ValueError('皮肤分类协议不符')
            except (ValueError, UnicodeError) as error:
                raise RuntimeError(skin_failure('人脸皮肤分割启动失败', output.parent / 'skin-mask.log')) from error
        decoder = subprocess.Popen([args.ffmpeg, '-v', 'error', '-noautorotate', '-i', str(source), '-map', '0:v:0', '-an', '-vsync', '0', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], stdout=subprocess.PIPE, stderr=decoder_log)
        # 逐帧编码，音轨采用原始流复制，不缩短到音频最短流、不生成新声音。
        encoder = subprocess.Popen([args.ffmpeg, '-v', 'error', '-n', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{width}x{height}', '-r', plan['frameRate'], '-i', 'pipe:0', '-i', str(original), '-map', '0:v:0', '-map', '1:a?', '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-pix_fmt', 'yuv420p' if width % 2 == 0 and height % 2 == 0 else 'yuv444p', '-c:a', 'copy', '-map_metadata', '-1', '-movflags', '+faststart', str(output)], stdin=subprocess.PIPE, stderr=encoder_log)
        while True:
            raw = read_frame(decoder.stdout, width * height * 3)
            if raw is None:
                break
            src = np.frombuffer(raw, dtype=np.uint8).reshape(height, width, 3).astype(np.float32) / 255
            face_mask = None
            if skin_process:
                skin_process.stdin.write(raw)
                skin_process.stdin.flush()
                try:
                    face_mask = np.frombuffer(read_exact(skin_process.stdout, width * height), dtype=np.uint8).reshape(height, width).astype(np.float32) / 255
                except RuntimeError as error:
                    raise RuntimeError(skin_failure(str(error), output.parent / 'skin-mask.log')) from error
            if session:
                outputs = session.run(['fgr', 'pha', 'r1o', 'r2o', 'r3o', 'r4o'], {'src': src.transpose(2, 0, 1)[None].astype(dtype), **{f'r{i+1}i': states[i] for i in range(4)}, 'downsample_ratio': np.array([ratio], dtype=np.float32)})
                foreground, alpha, *states = outputs
                if foreground.shape != (1, 3, height, width) or alpha.shape != (1, 1, height, width) or not all(np.isfinite(item).all() for item in outputs):
                    raise RuntimeError('RVM输出尺寸或数值异常')
                foreground = foreground[0].transpose(1, 2, 0).astype(np.float32)
                alpha = np.clip(alpha[0].transpose(1, 2, 0).astype(np.float32), 0, 1)
                if spec['look'] == 'natural':
                    foreground = natural_image(foreground, gains, np, Image, ImageFilter)
                if beauty_strength > 0:
                    foreground, beauty_stats = natural_beauty(foreground, alpha[..., 0], beauty_strength, np, Image, ImageFilter, face_mask=face_mask)
                image = foreground * alpha + background * (1 - alpha)
            else:
                if spec['look'] == 'natural':
                    image = natural_image(src, gains, np, Image, ImageFilter)
                else:
                    image = src
                if beauty_strength > 0:
                    image, beauty_stats = natural_beauty(image, np.ones((height, width), dtype=np.float32), beauty_strength, np, Image, ImageFilter, face_mask=face_mask)
            rgb = np.clip(np.round(image * 255), 0, 255).astype(np.uint8)
            if skin_process:
                beauty_totals['frames'] += 1
                beauty_totals['skinMaskPixels'] += beauty_stats['skinMaskPixels']
                beauty_totals['maxSkinMaskCoverage'] = max(beauty_totals['maxSkinMaskCoverage'], beauty_stats['skinMaskCoverage'])
                beauty_totals['framesWithoutSkin'] += int(beauty_stats['skinMaskPixels'] == 0)
            encoder.stdin.write(rgb.tobytes())
            frames += 1
            if frames > expected:
                raise RuntimeError('实际解码帧数超过来源计划')
            if frames == 1 or frames % max(1, math.ceil(plan['fps'])) == 0:
                print(json.dumps({'stage': 'processed', 'completed': frames}), flush=True)
        encoder.stdin.close()
        if skin_process:
            skin_process.stdin.close()
            if skin_process.wait():
                raise RuntimeError(skin_failure('人脸皮肤分割失败', output.parent / 'skin-mask.log'))
            if any(sha(beauty_root / 'models' / 'face-parse-bisent' / name) != value for name, value in beauty_models.items()):
                raise RuntimeError('处理期间人脸皮肤模型发生变化')
            if beauty_totals['framesWithoutSkin'] == frames:
                raise RuntimeError('整段视频未识别到可处理的脸部皮肤，请关闭美颜或更换正面清晰原片')
            beauty_stats = {**beauty_stats, **beauty_totals, 'skinMaskPolicy': 'bisenet-face-skin-ycbcr-alpha-v1', 'beautyBlendRange': [.07, .17], 'beautyBrightnessGainMax': .03, 'modelSha256': beauty_models, 'detector': skin_ready, 'engine': 'existing-musetalk-bisenet-cpu', 'faceMissingPolicy': 'skip-frame-with-zero-mask', 'onlyLargestDetectedFace': True, 'temporalMaskSmoothing': False}
        if decoder.wait() or encoder.wait():
            raise RuntimeError('人物视频解码或合成编码失败，请查看本次日志')
        if frames != expected or sha(original) != spec['sourceSha256'] or sha(source) != spec['preparedSha256']:
            raise RuntimeError('人物优化帧数不符或源视频变化')
        if selected_background is not None and sha(Path(selected_background['path'])) != selected_background['sha256']:
            raise RuntimeError('处理期间背景图片发生变化')
        receipt = {'kind': 'avatar-appearance-result-v1', 'frames': frames, 'inputSha256': sha(plan_file), 'sourceSha256': spec['sourceSha256'], 'preparedSha256': spec['preparedSha256'], 'modelSha256': spec['modelSha256'], 'outputSha256': sha(output), 'engine': 'rvm-onnx-cpu+ffmpeg' if session else 'pillow-numpy+ffmpeg', 'parameters': {'look': spec['look'], 'background': spec['background'], 'whiteBalanceGainLimit': [.88, 1.14] if spec['look'] == 'natural' else None, 'whiteBalanceGains': gains.tolist(), 'whiteBalanceNeutralPixels': white_balance_pixels, 'whiteBalancePolicy': 'fixed-source-neutral-highlight-v1', 'colorTreatmentBeforeBackground': True, 'gaussianRadius': .35 if spec['look'] == 'natural' else 0, 'blurBlend': .12 if spec['look'] == 'natural' else 0, 'unsharpRadius': .65 if spec['look'] == 'natural' else 0, 'unsharpPercent': 20 if spec['look'] == 'natural' else 0, 'mattingSamplingPolicy': sampling['mattingSamplingPolicy'] if session else None, 'mattingInternalTargetSize': sampling['mattingInternalTargetSize'] if session else None, 'downsampleRatio': ratio if session else None, 'recurrentStatesReused': bool(session), 'backgroundVersion': 'business-studio-procedural-v1' if session else None, 'beauty': beauty_stats, 'beautyPolicy': 'optional-skin-candidate-v1'}, 'qualityAccepted': False}
        receipt['parameters']['beautyPolicy'] = 'optional-bisenet-face-skin-v1'
        if selected_background is not None:
            receipt['parameters']['backgroundVersion'] = 'selected-image-center-cover-v1'
            receipt['parameters']['backgroundImage'] = {key: selected_background.get(key) for key in ['assetId', 'sha256']}
        (output.parent / 'result.json').write_text(json.dumps(receipt, ensure_ascii=False, indent=2), encoding='utf-8')
    finally:
        for process in [decoder, encoder, skin_process]:
            if process and process.poll() is None:
                process.kill()
                process.wait()
        decoder_log.close()
        encoder_log.close()
        if skin_log:
            skin_log.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', required=True)
    parser.add_argument('--ffmpeg', required=True)
    main(parser.parse_args())
