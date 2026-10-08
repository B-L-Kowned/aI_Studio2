"""Transcribe a finished video or audio file to the words actually spoken.

    .venv/bin/python transcribe.py <file> [--model medium.en] [--json] [--words]

Runs Whisper (faster-whisper) on this machine; nothing is uploaded. Prints the
transcript, or with --json the segments with start/end times (and with --words,
each word's own times). Used to recover the script of a finished video, and to
split a recording into script lines by what was said.
"""

from __future__ import annotations

import argparse
import json
import sys
import time

from faster_whisper import WhisperModel, decode_audio
from faster_whisper.vad import VadOptions, get_speech_timestamps

VOCABULARY = ("Bialkowned, bialkowned.com, Pat Bialko, Fixology, Get Liberated, FutureForge Mentors, "
              "Northstar Fractional Services, Launchpad Collective.")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("file")
    ap.add_argument("--model", default="medium.en")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--words", action="store_true")
    a = ap.parse_args()

    started = time.time()
    model = WhisperModel(a.model, device="cpu", compute_type="int8")
    # Names Whisper cannot guess: without them "Bialkowned" comes back "BuyElkOwned".
    if a.words:
        # Splitting a recording into script lines: every stretch between pauses
        # is transcribed on its own. In one 30-second window Whisper keeps only
        # one copy of a repeated sentence, so a retake after a stumble vanished
        # and the line was matched to the stumble.
        audio = decode_audio(a.file, sampling_rate=16000)
        spans = get_speech_timestamps(audio, VadOptions(min_silence_duration_ms=500, speech_pad_ms=150))
        clips = [round(t / 16000, 2) for sp in spans for t in (sp["start"], sp["end"])]
        segments, info = model.transcribe(audio, beam_size=5, word_timestamps=True, initial_prompt=VOCABULARY,
                                          condition_on_previous_text=False, clip_timestamps=clips or "0")
    else:
        segments, info = model.transcribe(a.file, beam_size=5, vad_filter=True, initial_prompt=VOCABULARY)
    segs = []
    for s in segments:
        seg = {"start": round(s.start, 2), "end": round(s.end, 2), "text": s.text.strip()}
        if a.words:
            seg["words"] = [{"start": round(w.start, 2), "end": round(w.end, 2), "word": w.word.strip()} for w in s.words or []]
        segs.append(seg)
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
