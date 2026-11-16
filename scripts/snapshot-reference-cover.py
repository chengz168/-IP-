import json
import sqlite3
from pathlib import Path

# 只读保存任务和步骤，避开账号配置、密钥和无关表。
root = Path('evidence/private-reference-backup/cover-editor')
root.mkdir(parents=True, exist_ok=True)
destination = root / 'before.json'
if destination.exists():
    raise RuntimeError('封面研究基线已存在，不能覆盖')
connection = sqlite3.connect('file:C:/Users/DELL/AppData/Roaming/aigc-human/data/aigc_human.db?mode=ro', uri=True)
connection.row_factory = sqlite3.Row
data = {name: [dict(row) for row in connection.execute('SELECT * FROM ' + name + ' ORDER BY id')] for name in ['tasks', 'task_steps']}
destination.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({'taskCount': len(data['tasks']), 'stepCount': len(data['task_steps'])}))
