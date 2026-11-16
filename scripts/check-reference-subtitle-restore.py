import json
import sqlite3
from pathlib import Path

# 只读核验原任务；仅报告差异路径，不输出任务正文或任何配置密钥。
before = json.loads(Path('evidence/private-reference-backup/subtitle-controlled-before.json').read_text(encoding='utf-8'))
connection = sqlite3.connect('file:C:/Users/DELL/AppData/Roaming/aigc-human/data/aigc_human.db?mode=ro', uri=True)
connection.row_factory = sqlite3.Row
task = dict(connection.execute('SELECT * FROM tasks WHERE id=?', (before['tasks'][0]['id'],)).fetchone())
original = before['tasks'][0]
differences = []

def compare(a, b, prefix):
    if isinstance(a, dict) and isinstance(b, dict):
        for key in set(a) | set(b):
            compare(a.get(key), b.get(key), prefix + '.' + key)
    elif a != b:
        differences.append(prefix)

for key in original:
    if key in ['pipeline_data', 'settings_data']:
        compare(json.loads(original[key]), json.loads(task[key]), key)
    elif original[key] != task[key]:
        differences.append(key)
steps = [dict(row) for row in connection.execute('SELECT * FROM task_steps WHERE task_id=? ORDER BY id', (task['id'],))]
prior_steps = sorted(before['task_steps'], key=lambda row: row['id'])
report = {'taskCount': connection.execute('SELECT count(*) FROM tasks').fetchone()[0], 'differentPaths': sorted(differences), 'stepsUnchanged': steps == prior_steps}
destination = Path('evidence/validation/dynamic-subtitles/reference-restore.json')
destination.parent.mkdir(parents=True, exist_ok=True)
destination.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(report, ensure_ascii=False))
