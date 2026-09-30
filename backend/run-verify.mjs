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
 *
 * A green run has to mean something was checked, so a suite passes only if it
 * exits 0, prints its "N passed, M failed" total, fails nothing, and passes at
 * least FLOOR checks. The floor is the count as of the last deliberate change:
 * raise it when you add assertions; lower it only when removing them on purpose.
 * A section that skips (no ffmpeg, no previous build) drops the count below the
 * floor and fails loudly instead of passing quietly over nothing.
 */
const FLOOR = {
  'verify.mjs': 127,
  'verify-gate.mjs': 28,
  'verify-build.mjs': 53,
  'verify-llm.mjs': 18,
};

const dir = mkdtempSync(join(tmpdir(), 'studio-verify-'));
const dbPath = join(dir, 'studio.db');

// Port 0 unless told otherwise: a fixed port let a stale server from an earlier
// run answer the probe, and the suites then tested THAT server's database.
const childEnv = Object.assign({}, process.env, {
  STUDIO_DB_PATH: dbPath,
  PORT: process.env.VERIFY_PORT ?? '0',
  PROVIDER_MODE: 'fixtures',
});

// A child killed by a signal exits with code null, which `if (code)` reads as
// success. Only an explicit 0 is a pass.
const exited = (child) => new Promise((r) => child.on('exit', (code, signal) => r({ code, signal })));
const describe = ({ code, signal }) => (signal ? `killed by ${signal}` : `exit ${code}`);

// The suite plans and scripts a production, so the throwaway database needs the
// same seed a fresh install ships with. Seeding leaves the workspace at first
// run, which is what the early assertions check.
const seeded = await exited(spawn(process.execPath, ['seed.js'], { env: childEnv, stdio: 'ignore' }));
if (seeded.code !== 0) {
  console.error(`seed failed (${describe(seeded)})`);
  rmSync(dir, { recursive: true, force: true });
  process.exit(1);
}

const server = spawn(process.execPath, ['server.js'], {
  env: childEnv,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
server.stderr.on('data', (d) => { log += d; });

// The server announces itself with the port it bound and the database it
// opened. Waiting for OUR child's announcement — rather than probing a port —
// proves the suites talk to this server and this throwaway database.
const ready = await new Promise((resolve) => {
  const timer = setTimeout(() => resolve(null), 15000);
  server.stdout.on('data', (d) => {
    log += d;
    const m = /STUDIO_READY (\{.*\})/.exec(log);
    if (m) { clearTimeout(timer); resolve(JSON.parse(m[1])); }
  });
  server.on('exit', () => { clearTimeout(timer); resolve(null); });
});

let code = 1;
try {
  if (!ready) {
    console.error(`server did not start\n${log}`);
  } else if (ready.dbPath !== dbPath) {
    console.error(`server opened ${ready.dbPath}, not the throwaway ${dbPath} — refusing to run`);
  } else {
    const base = `http://localhost:${ready.port}/api`;
    const verdicts = [];
    for (const suite of Object.keys(FLOOR)) {
      console.log(`\n────────── ${suite} ──────────`);
      const child = spawn(process.execPath, [suite], {
        env: Object.assign({}, process.env, { VERIFY_BASE: base }),
        stdio: ['ignore', 'pipe', 'inherit'],
      });
      let out = '';
      child.stdout.on('data', (d) => { out += d; process.stdout.write(d); });
      const exit = await exited(child);

      const totals = [...out.matchAll(/^(\d+) passed, (\d+) failed$/gm)].pop();
      const passed = totals ? Number(totals[1]) : 0;
      const failed = totals ? Number(totals[2]) : 0;
      const skipped = (out.match(/^\s+\.\.\s/gm) ?? []).length;
      const problems = [
        exit.code !== 0 && describe(exit),
        !totals && 'printed no total',
        failed > 0 && `${failed} failed`,
        totals && passed < FLOOR[suite] && `${passed} passed, floor is ${FLOOR[suite]}`,
      ].filter(Boolean);
      verdicts.push({ suite, passed, skipped, problems });
      console.log(problems.length ? `✗ ${suite}: ${problems.join('; ')}` : `✓ ${suite} — ${passed} passed`);
    }

    const bad = verdicts.filter((v) => v.problems.length);
    const total = verdicts.reduce((n, v) => n + v.passed, 0);
    console.log(`\n────────── summary ──────────`);
    for (const v of verdicts) {
      console.log(`  ${v.problems.length ? '✗' : '✓'} ${v.suite.padEnd(18)} ${String(v.passed).padStart(4)} passed`
        + (v.skipped ? `, ${v.skipped} section(s) skipped` : '')
        + (v.problems.length ? `  — ${v.problems.join('; ')}` : ''));
    }
    console.log(bad.length
      ? `\nFAILED — ${bad.length} of ${verdicts.length} suites.`
      : `\nAll ${verdicts.length} suites passed: ${total} assertions.`);
    code = bad.length ? 1 : 0;
  }
} finally {
  server.kill('SIGTERM');
  rmSync(dir, { recursive: true, force: true });
}
process.exit(code);
