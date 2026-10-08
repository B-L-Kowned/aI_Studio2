"""Local voice: speech in a cloned voice, on this machine, for nothing.

One process holds the Chatterbox model in memory so each line costs only its
generation — loading the model takes ~40s, and conditioning on a reference
another few, which is why a script that shells out per line runs 7x slower
than real time and this runs ~2x.

Loopback only. It reads a reference recording and writes a WAV, both under
VOICE_ROOT, and never a path outside it: the backend names files, this does not
trust them.

    GET  /health   {"ok", "device", "loaded", "busy"}
    POST /speak    {"text", "reference", "out", "exaggeration"?, "cfg_weight"?, "seed"?}
                   -> {"out", "duration", "seconds_taken"}
    POST /align    {"file"} -> {"duration", "segments": [{"words": [{"start","end","word"}]}], "seconds_taken"}

Whisper for /align is loaded once, on first use, and kept: started fresh for
every line it cost ~6s of loading for ~0.5s of work.
"""

from __future__ import annotations

import gc
import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")

import torch  # noqa: E402
import torchaudio  # noqa: E402

HOST = "127.0.0.1"
PORT = int(os.environ.get("VOICE_PORT", "3533"))
ROOT = Path(os.environ.get("VOICE_ROOT", Path.home() / "Library/Application Support/AIVideoStudio/voices")).resolve()
MAX_CHARS = 1200  # one script line; longer text drifts and should be split upstream

device = "mps" if torch.backends.mps.is_available() else "cpu"
model = None
load_error: str | None = None
conditioned: tuple[str, float, float] | None = None  # (reference, exaggeration, mtime) last prepared
lock = threading.Lock()
aligner = None  # faster-whisper, loaded on first /align
align_lock = threading.Lock()  # on the CPU, so it runs beside speech on the GPU
ALIGN_MODEL = os.environ.get("ALIGN_MODEL", "small")


def load() -> None:
    global model, load_error
    try:
        from chatterbox.tts import ChatterboxTTS

        started = time.time()
        model = ChatterboxTTS.from_pretrained(device=device)
        print(f"[voice] model loaded on {device} in {time.time() - started:.1f}s", flush=True)
    except Exception as exc:  # reported on /health rather than crashing the process
        load_error = f"{type(exc).__name__}: {exc}"
        print(f"[voice] model failed to load: {load_error}", flush=True)


def inside_root(raw: str) -> Path:
    path = (ROOT / raw).resolve() if not os.path.isabs(raw) else Path(raw).resolve()
    if ROOT not in path.parents and path != ROOT:
        raise ValueError("path is outside the voice folder")
    return path


def speak(body: dict) -> dict:
    global conditioned
    text = str(body.get("text", "")).strip()
    if not text:
        raise ValueError("text is empty")
    if len(text) > MAX_CHARS:
        raise ValueError(f"text is {len(text)} characters; split lines over {MAX_CHARS}")
    reference = inside_root(str(body.get("reference", "")))
    if not reference.is_file():
        raise ValueError("reference recording not found")
    out = inside_root(str(body.get("out", "")))
    if out.suffix.lower() != ".wav":
        raise ValueError("out must be a .wav file")
    exaggeration = min(max(float(body.get("exaggeration", 0.5)), 0.25), 1.5)
    cfg_weight = min(max(float(body.get("cfg_weight", 0.5)), 0.0), 1.0)
    seed = body.get("seed")

    with lock:
        if model is None:
            raise RuntimeError(load_error or "model is still loading")
        key = (str(reference), exaggeration, reference.stat().st_mtime)
        if conditioned != key:
            model.prepare_conditionals(str(reference), exaggeration=exaggeration)
            conditioned = key
        if seed is not None:
            torch.manual_seed(int(seed))
        started = time.time()
        wav = model.generate(text, exaggeration=exaggeration, cfg_weight=cfg_weight)
        out.parent.mkdir(parents=True, exist_ok=True)
        torchaudio.save(str(out), wav, model.sr)
        taken = time.time() - started
        wav = wav.detach().cpu()
        # PyTorch keeps every GPU buffer it has used, and on Apple Silicon that
        # memory is the machine's own: without this the service grew to 22 GB
        # in a few minutes, macOS swapped the model out, and a reading that
        # takes ~12s took ~45s.
        if device == "mps":
            torch.mps.synchronize()
            torch.mps.empty_cache()
        gc.collect()

    duration = wav.shape[-1] / model.sr
    if out.stat().st_size < 1000 or duration <= 0:
        raise RuntimeError("generation produced no audio")
    return {"out": str(out), "duration": round(duration, 2), "seconds_taken": round(taken, 1)}


def align(body: dict) -> dict:
    global aligner
    file = inside_root(str(body.get("file") or ""))
    if not file.exists():
        raise ValueError("no such file")
    with align_lock:
        started = time.time()
        if aligner is None:
            from faster_whisper import WhisperModel
            aligner = WhisperModel(ALIGN_MODEL, device="cpu", compute_type="int8")
            print(f"[voice] aligner ({ALIGN_MODEL}) loaded in {time.time() - started:.1f}s", flush=True)
        from transcribe import transcribe
        result = transcribe(aligner, str(file), words=True)
        result["seconds_taken"] = round(time.time() - started, 2)
        return result


class Handler(BaseHTTPRequestHandler):
    def reply(self, status: int, payload: dict) -> None:
        data = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:  # noqa: N802
        if self.path != "/health":
            return self.reply(404, {"error": "not found"})
        self.reply(200, {
            "ok": model is not None, "device": device, "loaded": model is not None,
            "busy": lock.locked(), "error": load_error, "root": str(ROOT),
        })

    def do_POST(self) -> None:  # noqa: N802
        if self.path not in ("/speak", "/align"):
            return self.reply(404, {"error": "not found"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            body = json.loads(self.rfile.read(length) or b"{}")
            self.reply(200, speak(body) if self.path == "/speak" else align(body))
        except ValueError as exc:
            self.reply(400, {"error": str(exc)})
        except Exception as exc:
            self.reply(500, {"error": f"{type(exc).__name__}: {exc}"})

    def log_message(self, fmt: str, *args) -> None:
        print(f"[voice] {self.address_string()} {fmt % args}", flush=True)


if __name__ == "__main__":
    ROOT.mkdir(parents=True, exist_ok=True)
    threading.Thread(target=load, daemon=True).start()
    print(f"[voice] listening on http://{HOST}:{PORT} root={ROOT}", flush=True)
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
