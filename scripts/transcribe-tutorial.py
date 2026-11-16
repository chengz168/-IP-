import argparse
import hashlib
import json
import os
import time
from pathlib import Path

# 只使用本机现有模型；禁用远程下载，原始识别结果保留以便逐段核对。
os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TRANSFORMERS_OFFLINE'] = '1'
from faster_whisper import WhisperModel

parser = argparse.ArgumentParser()
parser.add_argument('keys', nargs='+')
parser.add_argument('--model', default=r'C:\Users\DELL\.cache\whisper\small')
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
directory = root / 'evidence/tutorial/audio-study'
model_path = Path(args.model)
if not (model_path / 'model.bin').is_file():
    raise RuntimeError('本地模型不存在，禁止自动下载')
model = WhisperModel(str(model_path), device='cpu', compute_type='int8', cpu_threads=6, local_files_only=True)
for key in args.keys:
    source = directory / (key + '.mp4')
    output = directory / (key + '-whisper.json')
    started = time.monotonic()
    record = {'key': key, 'source': str(source), 'model': str(model_path),
              'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(),
              'status': 'running', 'scope': '机器转录，未逐段人工校正；不等于完整学习', 'segments': []}
    def save():
        temporary = output.with_suffix('.json.tmp')
        temporary.write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding='utf-8')
        temporary.replace(output)
    save()
    try:
        segments, info = model.transcribe(str(source), language='zh', beam_size=5,
                                          vad_filter=False, condition_on_previous_text=False,
                                          word_timestamps=False)
        record['duration'] = info.duration
        for segment in segments:
            record['segments'].append({'start': segment.start, 'end': segment.end,
                'text': segment.text, 'avgLogprob': segment.avg_logprob,
                'noSpeechProb': segment.no_speech_prob, 'compressionRatio': segment.compression_ratio})
            save()
            print(json.dumps({'key': key, 'end': segment.end, 'text': segment.text}, ensure_ascii=False), flush=True)
        record['status'] = 'transcribed_unreviewed'
        record['elapsedSeconds'] = round(time.monotonic() - started, 3)
        save()
    except Exception as error:
        record['status'] = 'failed'
        record['error'] = str(error)
        save()
        raise
