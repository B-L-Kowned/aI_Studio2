import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { openDb, defaultDbPath } from './db/index.js';
import workspace from './routes/workspace.js';
import productions from './routes/productions.js';
import pipeline from './routes/pipeline.js';
import collections from './routes/collections.js';
import providers from './routes/providers.js';
import connections from './routes/connections.js';
import heygen from './routes/heygen.js';
import presenters from './routes/presenters.js';
import segments from './routes/segments.js';
import training from './routes/training.js';
import analysis from './routes/analysis.js';
import series from './routes/series.js';
import roster from './routes/roster.js';
import scheduleRoutes from './routes/schedule.js';
import ideas from './routes/ideas.js';
import companies from './routes/companies.js';
import storage from './routes/storage.js';
import workflow from './routes/workflow.js';
import voices from './routes/voices.js';
import register from './routes/register.js';
import appearance from './routes/appearance.js';
import scriptTools from './routes/script-tools.js';
import editorKit from './routes/editor-kit.js';
import enhance from './routes/enhance.js';
import recording from './routes/recording.js';
import steps from './routes/steps.js';
import edit from './routes/edit.js';
import review from './routes/review.js';
import voiceBatch from './routes/voice-batch.js';
import music from './routes/music.js';
import managerRoutes from './routes/manager.js';
import lineFixRoutes from './routes/line-fix.js';
import { cacheOwnedPreviews } from './lib/preview-cache.js';
import { resume as resumeVoiceBatch } from './lib/voice-batch.js';
import { modeSummary } from './lib/providers/mode.js';
import { ok, fail } from './utils/respond.js';
import { existsSync } from 'node:fs';
import { join, dirname, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Port 0 asks the OS for a free port. A shipped desktop build uses it and hands
// the chosen port to the renderer — a fixed port would collide with whatever
// else is on the user's machine, and with a second copy of this app.
const PORT = Number(process.env.PORT ?? 3433);
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:3333';

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(cors({ origin: CORS_ORIGIN.split(',').map((s) => s.trim()) }));

const dbPath = defaultDbPath();
openDb(dbPath);

app.get('/api/health', (_req, res) =>
  ok(res, { status: 'ok', db: 'sqlite', uptime: Math.round(process.uptime()), ...modeSummary() })
);

app.use('/api', workspace);
app.use('/api', collections);
app.use('/api', providers);
app.use('/api', connections);
app.use('/api', heygen);
app.use('/api', presenters);
app.use('/api/productions', productions);
app.use('/api/productions', pipeline);
app.use('/api/productions', segments);
app.use('/api/training', training);
app.use('/api/productions', analysis);
app.use('/api/productions', workflow);
app.use('/api/productions', scriptTools);
app.use('/api/productions', editorKit);
app.use('/api/productions', enhance);
app.use('/api/productions', recording);
app.use('/api/productions', steps);
app.use('/api/productions', edit);
app.use('/api/series', series);
app.use('/api', roster);
app.use('/api', scheduleRoutes);
app.use('/api', ideas);
app.use('/api', companies);
app.use('/api', storage);
app.use('/api', voices);
app.use('/api', register);
app.use('/api', review);
app.use('/api', voiceBatch);
app.use('/api', music);
app.use('/api', managerRoutes);
app.use('/api', lineFixRoutes);
app.use('/api', appearance);

// ------------------------------------------------------- the app itself ---
//
// A packaged build serves the frontend from the SAME origin as the API, which
// is what lets the bundle keep a relative `/api` base. An absolute origin
// compiled into the bundle would pin the app to one hostname and port — and in
// a desktop build the port is chosen at startup, so there is nothing to pin.
const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(process.env.WEB_ROOT || join(here, '..', 'frontend', 'dist'));
const packaged = existsSync(join(webRoot, 'index.html'));

if (packaged) {
  app.use(express.static(webRoot, { index: false }));
}

// Anything under /api that got this far is genuinely unknown. Answering it with
// index.html would turn a typo into a 200 and hide the mistake — a soft 404 on
// an API is worse than a hard one, because the caller parses the page as data.
app.use('/api', (_req, res) => fail(res, 404, 'NOT_FOUND', 'Unknown endpoint'));

if (packaged) {
  // Client-side routing: a deep link is the app, not a missing file. But a path
  // that names a FILE is asking for a file, and express.static already had its
  // chance at it. Answering those with index.html is a soft 404: the browser
  // gets HTML where it wanted an image and silently renders the fallback, or
  // gets HTML where it wanted a script and dies on `<` as a parse error.
  // `/art/marv.png` returned 200 this way for artwork that never existed.
  // Deep links carry no extension, so this costs client routing nothing.
  app.use((req, res) => {
    if (extname(req.path)) {
      return fail(res, 404, 'NOT_FOUND', `No such file: ${req.path}`);
    }
    res.sendFile(join(webRoot, 'index.html'));
  });
} else {
  app.use((_req, res) => fail(res, 404, 'NOT_FOUND', 'Unknown endpoint'));
}

app.use((err, _req, res, _next) => {
  console.error('[error]', err);
  return fail(res, 500, 'INTERNAL', err.message || 'Internal server error');
});

const MODE = modeSummary();
if (MODE.generatesLive) {
  // The effective mode comes from the workspace, not the env; naming the env
  // var here sent readers to .env when the stored setting was the cause.
  console.warn(`[warn] provider mode "${MODE.mode}" — generation calls are real and billable. `
    + `(env default: ${MODE.envDefault}; the stored workspace setting wins.)`);
}

// Bound to the loopback interface: this is a single-user desktop app, and a
// server listening on every interface puts your workspace on the local network.
const server = app.listen(PORT, '127.0.0.1', () => {
  const actual = server.address().port;
  console.log(`[db]  ${dbPath}`);
  console.log(`[web] ${packaged ? webRoot : 'not built — use the dev server for the UI'}`);
  console.log(`[api] listening on http://localhost:${actual}  mode=${MODE.mode}`);
  // A voice batch the last run was in the middle of carries on.
  resumeVoiceBatch();
  // One machine-readable line, so a parent process never has to parse prose
  // that was written for a person.
  console.log(`STUDIO_READY ${JSON.stringify({ port: actual, packaged, dbPath })}`);
  // Avatar pictures are signed links that expire; keep yours while they work.
  cacheOwnedPreviews().catch(() => {});
});
