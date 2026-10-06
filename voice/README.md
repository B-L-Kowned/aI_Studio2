# Local voice

Your own voice, synthesised on this machine with [Chatterbox](https://github.com/resemble-ai/chatterbox)
(Resemble AI, MIT licence). The backend calls this service for auditions cast with a
**local** voice: free in every provider mode, and the take you approve is the audio
the video uses.

## Setup (once)

```bash
cd voice
/opt/homebrew/bin/python3.11 -m venv .venv
.venv/bin/pip install chatterbox-tts
```

The first start downloads the model weights from Hugging Face (`ResembleAI/chatterbox`,
a few GB, cached under `~/.cache/huggingface`).

## Run

```bash
pm2 start ecosystem.config.js --only ai-video-voice
curl -s 127.0.0.1:3533/health
```

Loading takes ~40 s; `/health` reports `"loaded": true` when ready. Loopback only.
Recordings and takes live in `<studio data dir>/voices/` — beside whichever database
`STUDIO_DB_PATH` names — and the service refuses any path outside that folder.

## Speed (Apple M4, measured 2026-10-06)

| | real-time factor |
|---|---|
| Mac GPU (MPS), model warm, voice conditioned | ~2.2× (a 10 s line takes ~22 s) |
| CPU | ~3× |
| a fresh process per line | ~7× — why this is a long-running service |

Changing a voice's expressiveness re-conditions the model (~1 min once), so batch
auditions with one setting.

## Making a voice

Settings → **Your voice** → *New voice from a recording*: 10–30 s of you speaking
normally, one voice, no music. A raw recording clones better than a clip that was
itself generated. Then cast it on a presenter in Cast.

Outputs carry Resemble's imperceptible Perth watermark.

## Transcription

`transcribe.py <video-or-audio>` recovers the words actually spoken in a
finished video (Whisper `medium.en` via faster-whisper, MIT; on this machine,
~40 s for a one-minute video). Setup: `.venv/bin/pip install faster-whisper`;
the model downloads on first use.

## Not built yet

Rendering a HeyGen avatar video **from** approved local audio. Until it is, a
HeyGen render of a line cast with a local voice is refused with
`LOCAL_VOICE_RENDER` — it never falls back to a different voice. Voice-only videos
(screen recording + narration) need only the approved audio.
