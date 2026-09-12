#!/usr/bin/env python3
"""Bind the plugin package to a registered ChatGPT app, without guessing an app ID."""
import argparse
import json
from pathlib import Path
import re
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('app_id', help='asdk_app_... or plugin_asdk_app_... copied from the registered ChatGPT plugin')
args = parser.parse_args()
app_id = args.app_id.removeprefix('plugin_')
if not re.fullmatch(r'(asdk_app_|connector_|templated_apps_)[A-Za-z0-9_-]+', app_id):
    parser.error('Expected a registered app ID; a tunnel ID is not an app ID')
path = Path(__file__).resolve().parent.parent / 'plugins/qianji/.app.json'
path.write_text(json.dumps({'apps': {'qianji': {'id': app_id, 'required': True}}}, indent=2) + '\n')
print('Updated', path)
