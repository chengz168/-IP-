import json
import sqlite3
from pathlib import Path

# 只读记录当前任务的剪辑配置与字幕步骤，不读取账号或服务配置。
root = Path('evidence/validation/subtitle-editor-parity/reference')
root.mkdir(parents=True, exist_ok=True)
connection = sqlite3.connect('file:C:/Users/DELL/AppData/Roaming/aigc-human/data/aigc_human.db?mode=ro', uri=True)
connection.row_factory = sqlite3.Row
task_id = '7d36740d-5b99-4e00-a776-fb87e63df22c'
task = connection.execute('SELECT pipeline_data FROM tasks WHERE id=?', (task_id,)).fetchone()
pipeline = json.loads(task['pipeline_data'])
steps = [dict(row) for row in connection.execute('SELECT step_name,input_data,output_data FROM task_steps WHERE task_id=?', (task_id,))]
data = {'taskId': task_id, 'pipeline': pipeline, 'steps': steps}
destination = root / 'baseline.json'
if destination.exists():
    baseline = json.loads(destination.read_text(encoding='utf-8'))
    report = {'unchanged': baseline == data}
    (root / 'restore-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(report))
else:
    destination.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'pipelineKeys': list(pipeline), 'steps': [s['step_name'] for s in steps]}, ensure_ascii=False))
