"""Measure your own recordings for the Edit step. Runs on this machine only.

    .venv/bin/python media_tools.py analyze <takes.json>
    .venv/bin/python media_tools.py frames <video>
    .venv/bin/python media_tools.py draw <spec.json>

analyze: for each take {id, file, start, end}, the words spoken in that span
with their times (absolute, in the file), keeping filler words. Whisper writes
clean prose by default and drops "um" and "uh"; a disfluent prompt and no
conditioning on earlier text make it write them down, so they can be cut.

frames: where the face sits (centre, as a share of width and height) and how
bright the footage is (mean luma 0-255), from frames sampled across the file.

draw: caption images (transparent, text in a dark box near the bottom) and
title cards, as PNGs. This machine's ffmpeg is built without a font renderer,
so text is drawn here and overlaid by ffmpeg.
"""

from __future__ import annotations

import json
import sys

FILLER_PROMPT = "Umm, uh, so, hmm. Okay, uh, let me, um, think. Bialkowned, FutureForge Mentors."


def analyze(path: str) -> int:
    from faster_whisper import WhisperModel, decode_audio

    takes = json.load(open(path))
    model = WhisperModel("medium.en", device="cpu", compute_type="int8")
    out = []
    cache: dict[str, object] = {}
    for t in takes:
        if t["file"] not in cache:
            cache[t["file"]] = decode_audio(t["file"], sampling_rate=16000)
        audio = cache[t["file"]]
        a, b = int(t["start"] * 16000), int(t["end"] * 16000)
        segments, _ = model.transcribe(audio[a:b], beam_size=5, word_timestamps=True,
                                       condition_on_previous_text=False, initial_prompt=FILLER_PROMPT)
        words = [{"start": round(t["start"] + w.start, 3), "end": round(t["start"] + w.end, 3), "word": w.word.strip()}
                 for s in segments for w in (s.words or [])]
        out.append({"id": t["id"], "words": words})
    print(json.dumps(out))
    return 0


def frames(path: str) -> int:
    import cv2

    cap = cv2.VideoCapture(path)
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 1
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    detector = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
    centres, lumas = [], []
    for i in range(12):
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(total * (i + 0.5) / 12))
        ok, frame = cap.read()
        if not ok:
            continue
        grey = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        lumas.append(float(grey.mean()))
        faces = detector.detectMultiScale(grey, scaleFactor=1.1, minNeighbors=6, minSize=(w // 12, w // 12))
        if len(faces):
            x, y, fw, fh = max(faces, key=lambda f: f[2] * f[3])
            centres.append(((x + fw / 2) / w, (y + fh / 2) / h))
    cap.release()
    face = None
    if centres:
        xs = sorted(c[0] for c in centres)
        ys = sorted(c[1] for c in centres)
        face = {"x": round(xs[len(xs) // 2], 4), "y": round(ys[len(ys) // 2], 4), "seen": len(centres)}
    print(json.dumps({"width": w, "height": h, "face": face, "luma": round(sum(lumas) / len(lumas), 1) if lumas else None}))
    return 0


FONTS = ["/System/Library/Fonts/Supplemental/Arial Bold.ttf", "/System/Library/Fonts/SFNS.ttf",
         "C:/Windows/Fonts/arialbd.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"]


def font(size: int):
    from PIL import ImageFont

    for f in FONTS:
        try:
            return ImageFont.truetype(f, size)
        except OSError:
            continue
    return ImageFont.load_default()


def wrap(draw, text: str, fnt, width: int) -> list[str]:
    lines, cur = [], ""
    for word in text.split():
        trial = f"{cur} {word}".strip()
        if draw.textlength(trial, font=fnt) <= width or not cur:
            cur = trial
        else:
            lines.append(cur)
            cur = word
    return lines + ([cur] if cur else [])


def draw(path: str) -> int:
    """spec: {width, height, dir, captions: [text], cards: [{name, title, text}]}"""
    from pathlib import Path
    from PIL import Image, ImageDraw

    spec = json.load(open(path))
    w, h, out = spec["width"], spec["height"], Path(spec["dir"])
    out.mkdir(parents=True, exist_ok=True)
    Image.new("RGBA", (w, h), (0, 0, 0, 0)).save(out / "blank.png")
    size = max(28, round(min(w, h) * 0.055))
    fnt = font(size)
    for i, text in enumerate(spec.get("captions", [])):
        img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        lines = wrap(d, text, fnt, int(w * 0.82))
        lh = round(size * 1.25)
        box_h = lh * len(lines) + size
        # Low in the frame: below a screen recording fitted into a vertical video, at chest height on camera.
        top = round(h * 0.80) - box_h // 2
        box_w = max(d.textlength(line, font=fnt) for line in lines) + size * 1.2
        d.rounded_rectangle([(w - box_w) / 2, top, (w + box_w) / 2, top + box_h], radius=size // 3, fill=(0, 0, 0, 165))
        for j, line in enumerate(lines):
            d.text((w / 2, top + size / 2 + j * lh), line, font=fnt, fill=(255, 255, 255, 255), anchor="ma")
        img.save(out / f"cap_{i:04d}.png")
    for card in spec.get("cards", []):
        img = Image.new("RGB", (w, h), (31, 34, 48))
        d = ImageDraw.Draw(img)
        big = font(round(size * 1.5))
        y = h * 0.38
        for line in wrap(d, card.get("title", ""), big, int(w * 0.8)):
            d.text((w / 2, y), line, font=big, fill=(255, 255, 255), anchor="ma")
            y += size * 1.9
        for line in wrap(d, card.get("text", ""), fnt, int(w * 0.75)):
            d.text((w / 2, y + size * 0.6), line, font=fnt, fill=(205, 208, 222), anchor="ma")
            y += size * 1.3
        img.save(out / f"{card['name']}.png")
    print(json.dumps({"dir": str(out), "captions": len(spec.get("captions", [])), "cards": len(spec.get("cards", []))}))
    return 0


if __name__ == "__main__":
    commands = {"analyze": analyze, "frames": frames, "draw": draw}
    if len(sys.argv) != 3 or sys.argv[1] not in commands:
        print(__doc__, file=sys.stderr)
        raise SystemExit(2)
    raise SystemExit(commands[sys.argv[1]](sys.argv[2]))
