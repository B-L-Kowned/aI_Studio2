"""Transcribe a finished video or audio file to the words actually spoken.

    .venv/bin/python transcribe.py <file> [--model medium.en] [--json]

Runs Whisper (faster-whisper) on this machine; nothing is uploaded. Prints the
transcript, or with --json the segments with start/end times. Used to recover
the script of a video that was finished before its text was kept.
"""

from __future__ import annotations

import argparse
import json
import sys
import time

from faster_whisper import WhisperModel

VOCABULARY = ("Bialkowned, bialkowned.com, Pat Bialko, Fixology, Get Liberated, FutureForge Mentors, "
              "Northstar Fractional Services, Launchpad Collective.")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("file")
    ap.add_argument("--model", default="medium.en")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()

    started = time.time()
    model = WhisperModel(a.model, device="cpu", compute_type="int8")
    # Names Whisper cannot guess: without them "Bialkowned" comes back "BuyElkOwned".
    segments, info = model.transcribe(a.file, beam_size=5, vad_filter=True, initial_prompt=VOCABULARY)
    segs = [{"start": round(s.start, 2), "end": round(s.end, 2), "text": s.text.strip()} for s in segments]
    if not segs:
        print("No speech found.", file=sys.stderr)
        return 1
    if a.json:
        print(json.dumps({"duration": round(info.duration, 2), "seconds_taken": round(time.time() - started, 1),
                          "model": a.model, "segments": segs}))
    else:
        print(" ".join(s["text"] for s in segs))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
