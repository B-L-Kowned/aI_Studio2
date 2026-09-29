#!/usr/bin/env python3
"""
Move the HeyGen key you already have in artificial_funny into AI Video Studio.

The key never appears on screen, in your shell history, or in a chat transcript:
it is decrypted in memory and POSTed straight to the local API, which re-encrypts
it at rest. Run it yourself — it reads a credential, which is your call to make.

    cd backend
    ../../../thoughts/artificial_funny/desktop/venv/bin/python scripts/import-heygen-key.py

Prerequisites: the AI Video Studio backend running on :3433, and provider mode
set to "Live read" or "Live" if you want the key verified against HeyGen as it
is saved (in Fixtures mode it is stored but deliberately not checked).
"""
from __future__ import annotations

import json
import pathlib
import sqlite3
import sys
import urllib.error
import urllib.request

SOURCE_DB = pathlib.Path(
    '/Users/patrickbialko/Desktop/thoughts/artificial_funny/desktop/ai_studio.db'
)
SECRETS = pathlib.Path.home() / 'Library' / 'Application Support' / 'ai-studio' / 'secrets.json'
API = 'http://localhost:3433/api'


def die(msg: str) -> None:
    print(f'✗ {msg}')
    sys.exit(1)


def main() -> None:
    if not SOURCE_DB.exists():
        die(f'No source database at {SOURCE_DB}')
    if not SECRETS.exists():
        die(f'No per-install secrets at {SECRETS}\n'
            '  The key cannot be decrypted without it. Paste the key into '
            'Settings → Generation → Connect instead.')

    try:
        from cryptography.fernet import Fernet
    except ImportError:
        die('Run this with the artificial_funny venv interpreter, which has `cryptography`.')

    fkey = json.loads(SECRETS.read_text()).get('encryption_key')
    if not fkey:
        die('secrets.json has no encryption_key.')

    con = sqlite3.connect(f'file:{SOURCE_DB}?mode=ro', uri=True)
    row = con.execute('SELECT heygen_api_key_enc FROM app_runtime_config LIMIT 1').fetchone()
    con.close()
    if not row or not row[0]:
        die('No HeyGen key stored in artificial_funny.')

    try:
        secret = Fernet(fkey.encode()).decrypt(row[0].encode()).decode()
    except Exception as exc:
        die(f'Could not decrypt ({type(exc).__name__}). The key was encrypted with a '
            'different per-install secret — paste it in the UI instead.')

    print(f'✓ Recovered a {len(secret)}-character key from artificial_funny (not shown)')

    req = urllib.request.Request(
        f'{API}/providers/heygen/connect',
        data=json.dumps({'key': secret}).encode(),
        headers={'Content-Type': 'application/json'},
        method='POST',
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            body = json.load(res)
    except urllib.error.HTTPError as exc:
        detail = json.load(exc).get('message', exc.reason)
        die(f'The API refused it: {detail}')
    except urllib.error.URLError as exc:
        die(f'Could not reach the backend on :3433 ({exc.reason}). Is it running?')
    finally:
        del secret  # do not leave it lying around in this process

    print(f'✓ {body.get("message")}')
    sync = (body.get('data') or {}).get('sync')
    if sync:
        print(f'  pulled: {sync.get("pulled")}')
        print(f'  quota:  {sync.get("quota", {}).get("remaining")}')
    else:
        print('  Stored. Switch to Live read in Settings → Generation, then Sync, '
              'to pull your real avatars and voices.')


if __name__ == '__main__':
    main()
