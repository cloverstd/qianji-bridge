#!/usr/bin/env python3
"""Check the publication boundary; report locations/rules, never matched secret values."""
import json
from pathlib import Path
import re
import subprocess
import sys

files = subprocess.check_output(['git', 'ls-files', '-z']).decode().split('\0')
patterns = {
    'private-key': r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',
    'github-token': r'\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})',
    'openai-key': r'\bsk-[A-Za-z0-9_-]{20,}',
    'private-network': r'\b(?:192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+)\b',
    'personal-home-path': r'/(?:home|Users)/[A-Za-z0-9_.-]+/',
}
forbidden_parts = {'data', 'secrets', 'backups', 'node_modules', 'test-results', 'playwright-report', '.git'}
forbidden_extensions = {'.db', '.sqlite', '.sqlite3', '.key', '.pem', '.secret', '.har', '.pcap', '.pcapng', '.mitm'}
errors = []
for filename in filter(None, files):
    path = Path(filename)
    if forbidden_parts.intersection(path.parts) or path.suffix in forbidden_extensions or (path.name.startswith('.env') and path.name != '.env.example'):
        errors.append(f'{filename}: forbidden publication path')
        continue
    if not path.is_file():
        continue
    text = path.read_text(errors='replace')
    for line, value in enumerate(text.splitlines(), 1):
        for rule, pattern in patterns.items():
            if re.search(pattern, value):
                errors.append(f'{filename}:{line}: {rule}')
        for email in re.findall(r'[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})', value):
            if email not in {'example.com', 'users.noreply.github.com'}:
                errors.append(f'{filename}:{line}: non-example email')
    if path.name == '.app.json' and json.loads(text) != {'apps': {}}:
        errors.append(f'{filename}: private ChatGPT app binding must not be published')
if errors:
    print('\n'.join(errors))
    sys.exit(1)
print('Publication boundary passed; no matched values were printed.')
