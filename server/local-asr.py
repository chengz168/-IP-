import argparse
import json
import os
from pathlib import Path

# 只加载用户已有的目录模型，禁止通过模型名或缺失文件触发下载。
os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TRANSFORMERS_OFFLINE'] = '1'


def emit(event, **values):
    print(json.dumps({'event': event, **values}, ensure_ascii=False), flush=True)


parser = argparse.ArgumentParser()
parser.add_argument('--model', required=True)
parser.add_argument('--input')
parser.add_argument('--language', default='zh')
parser.add_argument('--check', action='store_true')
args = parser.parse_args()

try:
    directory = Path(args.model)
    for name in ('model.bin', 'config.json', 'tokenizer.json'):
        if not (directory / name).is_file():
            raise RuntimeError('本地模型缺少文件：' + name)
    emit('progress', value=12, message='正在加载已有本地模型')
    from faster_whisper import WhisperModel
    import faster_whisper
    model = WhisperModel(str(directory), device='cpu', compute_type='int8',
                         cpu_threads=6, local_files_only=True)
    if args.check:
        emit('result', data={'available': True, 'version': faster_whisper.__version__,
                             'device': 'cpu', 'computeType': 'int8'})
    else:
        if not args.input or not Path(args.input).is_file():
            raise RuntimeError('识别音频不存在')
        emit('progress', value=22, message='开始本地语音识别')
        segments, info = model.transcribe(args.input,
            language=None if args.language == 'auto' else args.language,
            beam_size=5, vad_filter=True, condition_on_previous_text=False,
            word_timestamps=True)
        rows = []
        for segment in segments:
            text = segment.text.strip()
            if text:
                rows.append({'start': segment.start, 'end': segment.end, 'text': text,
                             'words': [{'start': word.start, 'end': word.end, 'word': word.word}
                                       for word in (segment.words or [])]})
            emit('progress', value=min(94, 22 + segment.end / max(info.duration, .001) * 72),
                 message='已识别至 %.2f 秒' % segment.end)
        emit('result', data={'text': ''.join(row['text'] for row in rows),
                             'segments': rows, 'language': info.language})
except Exception as error:
    emit('error', message=str(error))
    raise SystemExit(1)
