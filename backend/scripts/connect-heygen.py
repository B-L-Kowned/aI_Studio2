#!/usr/bin/env python3
"""
Connect HeyGen, end to end, in one command.

  1. switches provider mode to Test  (real calls, watermarked, $0)
  2. recovers the key you already have in artificial_funny
  3. verifies it against HeyGen
  4. pulls your real avatars, voices and quota

The key is never printed, never written to a file, and never enters your shell
history. Nothing here can spend credits — Test mode uses HeyGen's own free
watermarked rendering, and a paid render needs you to switch to Live yourself.

    cd /Users/patrickbialko/Desktop/Projects/ai-video-frontend/backend
    ../../../thoughts/artificial_funny/desktop/venv/bin/python scripts/connect-heygen.py

Pass a key directly instead of reading the stored one:
    ... scripts/connect-heygen.py --paste
"""
from __future__ import annotations

import getpass
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


def post(path: str, body: dict) -> dict:
    req = urllib.request.Request(
        API + path,
        data=json.dumps(body).encode(),
        headers={'Content-Type': 'application/json'},
        method='POST',
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as res:
            return json.load(res)
    except urllib.error.HTTPError as exc:
        payload = json.load(exc)
        raise SystemExit(f"✗ {payload.get('message', exc.reason)}")
    except urllib.error.URLError as exc:
        raise SystemExit(
            f'✗ Could not reach the backend on :3433 ({exc.reason}).\n'
            '  Start it with:  pm2 restart ai-video-api'
        )


def stored_key() -> str | None:
    """Recover the key from artificial_funny. Returns None if unavailable."""
    if not SOURCE_DB.exists() or not SECRETS.exists():
        return None
    try:
        from cryptography.fernet import Fernet
    except ImportError:
        print('  (cryptography not available — run with the artificial_funny venv python)')
        return None

    fkey = json.loads(SECRETS.read_text()).get('encryption_key')
    if not fkey:
        return None

    con = sqlite3.connect(f'file:{SOURCE_DB}?mode=ro', uri=True)
    row = con.execute('SELECT heygen_api_key_enc FROM app_runtime_config LIMIT 1').fetchone()
    con.close()
    if not row or not row[0]:
        return None

    try:
        return Fernet(fkey.encode()).decrypt(row[0].encode()).decode()
    except Exception as exc:
        print(f'  (could not decrypt the stored key: {type(exc).__name__})')
        return None


def main() -> None:
    print('1/4  Switching provider mode to Test (real calls, watermarked, $0)')
    res = post('/workspace/provider-mode', {'mode': 'live_read'})
    print(f"     {res['message']}")

    print('2/4  Finding your HeyGen key')
    key = None
    if '--paste' not in sys.argv:
        key = stored_key()
        if key:
            print(f'     recovered from artificial_funny ({len(key)} chars, not shown)')
    if not key:
        # getpass does not echo, and nothing is stored in shell history.
        key = getpass.getpass('     paste your HeyGen key (input hidden): ').strip()
    if not key:
        raise SystemExit('✗ No key given.')

    print('3/4  Verifying it with HeyGen')
    res = post('/connections/heygen', {'key': key})
    del key
    data = res.get('data') or {}
    print(f"     {res.get('message')}")
    if data.get('verdict') != 'ok':
        raise SystemExit('✗ HeyGen did not accept that key — nothing was synced.')

    print('4/4  Pulling your catalogue')
    sync = data.get('sync')
    if data.get('syncError'):
        raise SystemExit(f"✗ Key is good but the catalogue sync failed: {data['syncError']}")
    if sync:
        pulled = sync.get('pulled', {})
        print(f"     avatars: {pulled.get('avatar', 0)}   "
              f"voices: {pulled.get('voice', 0)}   "
              f"templates: {pulled.get('template', 0)}")
        print(f"     quota remaining: {sync.get('quota', {}).get('remaining')}")

    hg = next((c for c in data.get('items', []) if c['id'] == 'heygen'), None)
    print(f"\n✓ HeyGen is {hg['status'] if hg else 'connected'}.")
    print('  Open Settings → Connections to see it, or Providers for the full catalogue.')
    print('  Renders run in Test mode (watermarked, free) until you switch to Live.')


if __name__ == '__main__':
    main()
