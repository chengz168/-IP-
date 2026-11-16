import json
import sqlite3
from pathlib import Path

# 比较本批研究前后的任务字段与步骤，只输出差异路径。
before = json.loads(Path('evidence/private-reference-backup/cover-editor/before.json').read_text(encoding='utf-8'))
connection = sqlite3.connect('file:C:/Users/DELL/AppData/Roaming/aigc-human/data/aigc_human.db?mode=ro', uri=True)
connection.row_factory = sqlite3.Row
tasks = [dict(row) for row in connection.execute('SELECT * FROM tasks ORDER BY id')]
differences = []
def compare(a, b, path):
    if isinstance(a, dict) and isinstance(b, dict):
        for key in set(a) | set(b):
            compare(a.get(key), b.get(key), path + '.' + key)
    elif a != b:
        differences.append(path)
for task in before['tasks']:
    current = next((row for row in tasks if row['id'] == task['id']), {})
    for key in task:
        if key in ['pipeline_data', 'settings_data'] and key in current:
            compare(json.loads(task[key]), json.loads(current[key]), key)
        elif task[key] != current.get(key):
            differences.append(key)
steps = [dict(row) for row in connection.execute('SELECT * FROM task_steps ORDER BY id')]
report = {'taskCount': len(tasks), 'originalTaskCount': len(before['tasks']), 'differentPaths': sorted(set(differences)), 'stepsUnchanged': steps == before['task_steps']}
Path('evidence/validation/cover-editor/reference-restore.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(report, ensure_ascii=False))
