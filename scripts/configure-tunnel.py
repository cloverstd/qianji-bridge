#!/usr/bin/env python3
"""Configure the home Compose tunnel without putting its key in env or command arguments."""
import argparse
import os
from pathlib import Path
import re
import tempfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--tunnel-id', required=True)
parser.add_argument('--key-file', type=Path, required=True, help='Existing runtime API key file; never pass the key itself')
parser.add_argument('--directory', type=Path, default=Path(__file__).resolve().parent.parent)
args = parser.parse_args()
if not re.fullmatch(r'tunnel_[A-Za-z0-9_-]{8,128}', args.tunnel_id):
    parser.error('Invalid tunnel ID')
root = args.directory.resolve()
if not (root / 'compose.home.yaml').is_file() or not (root / 'compose.tunnel.yaml').is_file():
    parser.error('Deployment directory is missing Compose files')
secret = args.key_file.read_text().strip()
if len(secret) < 20 or any(c.isspace() for c in secret):
    parser.error('Runtime key file is empty or invalid')
folder = root / 'secrets'
folder.mkdir(mode=0o700, exist_ok=True)
folder.chmod(0o700)
def private_write(path, value):
    fd, name = tempfile.mkstemp(dir=path.parent, prefix='.' + path.name)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, 'w') as f:
            f.write(value)
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)
private_write(folder / 'openai_tunnel_key', secret + '\n')
env = root / '.env'
lines = env.read_text().splitlines() if env.exists() else []
values = {'COMPOSE_FILE': 'compose.home.yaml:compose.tunnel.yaml', 'COMPOSE_PROFILES': 'chatgpt', 'CONTROL_PLANE_TUNNEL_ID': args.tunnel_id}
if env.exists():
    private_write(root / '.env.before-tunnel', env.read_text())
lines = [line for line in lines if line.split('=', 1)[0] not in values]
private_write(env, '\n'.join(lines + [f'{k}={v}' for k, v in values.items()]) + '\n')
print('Tunnel configuration saved. No runtime key was printed.')
print('Next: docker compose up -d --no-build')
