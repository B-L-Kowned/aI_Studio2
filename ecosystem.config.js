// Local dev process definitions. Ports are fixed: API 3433, frontend 3333,
// local voice 3533 (loopback only).
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// The voice service keeps its recordings beside the database the API uses, so
// a dev database and the real one never share voice files. Read the same
// STUDIO_DB_PATH the API reads rather than writing the location down twice.
function studioDataDir() {
  try {
    const env = fs.readFileSync(path.join(__dirname, 'backend', '.env'), 'utf8');
    const m = /^STUDIO_DB_PATH=(.+)$/m.exec(env);
    if (m) return path.dirname(path.resolve(m[1].trim()));
  } catch { /* no .env: fall through to the default */ }
  return path.join(os.homedir(), 'Library', 'Application Support', 'AIVideoStudio');
}

module.exports = {
  apps: [
    {
      name: 'ai-video-api',
      cwd: './backend',
      script: 'npm',
      args: 'start',
      env: { NODE_ENV: 'development', VOICE_ROOT: path.join(studioDataDir(), 'voices') },
      autorestart: true,
      max_restarts: 10,
    },
    {
      name: 'ai-video-web',
      cwd: './frontend',
      script: 'npm',
      args: 'run dev',
      env: { NODE_ENV: 'development' },
      autorestart: true,
      max_restarts: 10,
    },
    {
      // Chatterbox, held in memory. Setup: see voice/README.md.
      name: 'ai-video-voice',
      cwd: './voice',
      script: './server.py',
      interpreter: path.join(__dirname, 'voice', '.venv', 'bin', 'python'),
      env: { VOICE_PORT: '3533', VOICE_ROOT: path.join(studioDataDir(), 'voices') },
      autorestart: true,
      max_restarts: 5,
    },
  ],
};
