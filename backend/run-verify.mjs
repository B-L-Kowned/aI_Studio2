import { spawn } from 'node:child_process';
import { rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Run the verification suite against a throwaway database on a spare port.
 *
 * The suite asserts what a FACTORY-FRESH install does — un-onboarded, no
 * entitlement, no provider assets. Run against the development database it
 * reported a dozen failures that were all leftover state from using the app,
 * which is worse than useless: it trains you to read red as normal, and a real
 * regression then hides among them.
 */
const dir = mkdtempSync(join(tmpdir(), 'studio-verify-'));
const dbPath = join(dir, 'studio.db');
const PORT = process.env.VERIFY_PORT ?? '3533';

const childEnv = Object.assign({}, process.env, {
  STUDIO_DB_PATH: dbPath,
  PORT,
  PROVIDER_MODE: 'fixtures',
});

// The suite plans and scripts a production, so the throwaway database needs the
// same seed a fresh install ships with. Seeding leaves the workspace at first
// run, which is what the early assertions check.
const seeded = spawn(process.execPath, ['seed.js'], { env: childEnv, stdio: 'ignore' });
if (await new Promise((r) => seeded.on('exit', r))) {
  console.error('seed failed');
  process.exit(1);
}

const server = spawn(process.execPath, ['server.js'], {
  env: childEnv,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
server.stdout.on('data', (d) => { log += d; });
server.stderr.on('data', (d) => { log += d; });

const base = `http://localhost:${PORT}/api`;
const up = async () => {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(base + '/workspace')).ok) return true; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
};

let code = 1;
try {
  if (!(await up())) {
    console.error(`server did not start on port ${PORT}\n${log}`);
  } else {
    // Every suite runs against the same throwaway install, in order.
    code = 0;
    for (const suite of ['verify.mjs', 'verify-gate.mjs', 'verify-build.mjs']) {
      console.log(`\n────────── ${suite} ──────────`);
      const child = spawn(process.execPath, [suite], {
        env: Object.assign({}, process.env, { VERIFY_BASE: base }),
        stdio: 'inherit',
      });
      code = (await new Promise((r) => child.on('exit', r))) || code;
    }
  }
} finally {
  server.kill('SIGTERM');
  rmSync(dir, { recursive: true, force: true });
}
process.exit(code ?? 1);
