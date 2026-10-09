import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { serviceStatus } from './local-voice.js';
import { ollamaStatus } from './llm-runtime.js';
import { tierState } from './model-tier.js';
import * as mcp from './providers/heygen-mcp.js';

const run = promisify(execFile);
const has = async (cmd, args = ['-version']) => { try { await run(cmd, args, { timeout: 4000 }); return true; } catch { return false; } };

/**
 * What this computer has, for each job the studio does: present and working,
 * present but stopped, or missing — with its size and the one step that fixes
 * it. A customer's first run reads this; nothing here downloads on its own.
 */
export async function components() {
  const [ffmpeg, voice, ollama, tier] = await Promise.all([
    has('ffmpeg'), serviceStatus(), ollamaStatus(), tierState().catch(() => null),
  ]);
  const heygen = mcp.isConnected();
  const list = [
    {
      id: 'ffmpeg', label: 'Video tools (ffmpeg)', for: 'Exporting, cleaning audio, cutting clips', size: '~80 MB',
      status: ffmpeg ? 'ready' : 'missing',
      fix: ffmpeg ? null : { kind: 'link', label: 'How to install', url: 'https://ffmpeg.org/download.html' },
    },
    {
      id: 'voice', label: 'Voice engine', for: 'Your free voice, and checking every word is said clearly', size: '≈ 5 GB with its models',
      status: voice.reachable ? (voice.loaded ? 'ready' : 'starting') : 'stopped',
      detail: voice.reachable ? (voice.loaded ? `Running on ${voice.device === 'mps' ? 'this Mac’s GPU' : 'the CPU'}` : 'Loading its model (about 40 seconds)') : 'Not running',
      fix: voice.reachable ? null : { kind: 'note', label: 'It starts with the app. If it stays stopped, restart AI Video Studio.' },
    },
    {
      id: 'ollama', label: 'Model runner (Ollama)', for: 'Runs the writing model on this Mac', size: '~500 MB',
      status: ollama.connected ? 'ready' : 'missing',
      detail: ollama.connected ? 'Running' : 'Not running or not installed',
      fix: ollama.connected ? null : { kind: 'link', label: 'Download Ollama', url: 'https://ollama.com/download' },
    },
    {
      id: 'writing', label: 'Writing model', for: 'Enhance, suggestions and fixes', size: tier?.inUseTier === 'full' ? '9 GB' : '2 GB',
      status: !ollama.connected ? 'blocked' : tier?.inUse ? 'ready' : 'missing',
      detail: tier?.inUse ? `${tier.inUse} (${tier.inUseTier})` : ollama.connected ? 'None downloaded yet' : 'Needs the model runner first',
      fix: ollama.connected && !tier?.inUse ? { kind: 'action', label: 'Download Light (2 GB)', action: 'download-light' } : null,
    },
    {
      id: 'heygen', label: 'HeyGen', for: 'Avatar videos — your own account', size: 'online',
      status: heygen ? 'ready' : 'missing',
      detail: heygen ? 'Signed in' : 'Not connected',
      fix: heygen ? null : { kind: 'goto', label: 'Connect HeyGen', section: 'heygen' },
    },
  ];
  return { components: list, ready: list.filter((c) => c.status === 'ready').length, total: list.length };
}
