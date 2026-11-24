#!/usr/bin/env python3
"""Forced alignment of the hand-made voice take onto the script words (local, free).

  align.py <voice> <script.json|-> <out.json> [--recognised rec.json] [--raw out.raw.json]

Transcribes <voice> with faster-whisper (small.en, cpu, int8, word timestamps, initial_prompt = script text),
maps the recognised words onto the script words (difflib SequenceMatcher), interpolates unmatched words and writes
{"meta": {"lead", "matchRate", ...}, "words": [{line, w, word, start, end, matched}]}.
Times in words.json are timeline seconds: voice time minus meta.lead (first word start - 0.1 s).
With no script ("-") only the recognised words are written (words.raw.json).
--recognised skips transcription and reads [{word,start,end}] from a file (tests).
Exit 1 when matchRate < 0.9 (prints the first unmatched stretch).
"""
import difflib
import json
import re
import sys

MIN_RATE = 0.9
LEAD_PAD = 0.1


def strip_tags(text):
    return re.sub(r"\[[^\]]*\]", " ", text)


def norm(word):
    return re.sub(r"[^a-z0-9]", "", word.lower())


ONES = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split()
TENS = "_ _ twenty thirty forty fifty sixty seventy eighty ninety".split()


def number_words(n):
    """Cardinal words for 0 <= n < 1e6; 4-digit years 1100-1999 (not whole hundreds) are read in pairs ("nineteen twelve")."""
    if 1100 <= n <= 1999 and n % 100:
        return number_words(n // 100) + number_words(n % 100)
    if n < 20:
        return [ONES[n]]
    if n < 100:
        return [TENS[n // 10]] + ([ONES[n % 10]] if n % 10 else [])
    if n < 1000:
        return [ONES[n // 100], "hundred"] + (number_words(n % 100) if n % 100 else [])
    return number_words(n // 1000) + ["thousand"] + (number_words(n % 1000) if n % 1000 else [])


def tokens(word):
    """Normalised match tokens of one word: digits become number words (40 -> forty, 90,000 -> ninety thousand)."""
    w = norm(word)
    if w.isdigit() and len(w) <= 6:
        return number_words(int(w))
    return [w] if w else []


def join_thousands(rec):
    """Whisper may split "90,000" into "90" + ",000": join those back into one recognised word."""
    out = []
    for r in rec:
        if out and re.fullmatch(r",\d{3}[.,!?]*", r["word"].strip()) and re.fullmatch(r"\d{1,3}", norm(out[-1]["word"])):
            out[-1] = {"word": out[-1]["word"] + r["word"].strip(), "start": out[-1]["start"], "end": r["end"]}
        else:
            out.append(dict(r))
    return out


def script_words(script):
    out = []
    for line in script["lines"]:
        w = 0
        for tok in strip_tags(line["text"]).split():
            if not norm(tok):
                continue
            out.append({"line": line["id"], "w": w, "word": tok, "norm": norm(tok), "toks": tokens(tok)})
            w += 1
    return out


def prompt_text(script):
    return " ".join(strip_tags(l["text"]) for l in script["lines"]).replace("  ", " ").strip()


def map_words(swords, rec):
    """swords: script_words(); rec: [{word,start,end}]. Returns (words, matchRate)."""
    # Match on number-normalised tokens; a script word is matched when all of its tokens are.
    a, owner = [], []
    for i, s in enumerate(swords):
        for tk in s.get("toks") or [s["norm"]]:
            a.append(tk)
            owner.append(i)
    b, bt = [], []
    for r in join_thousands(rec):
        tk = tokens(r["word"])
        d = (r["end"] - r["start"]) / max(1, len(tk))
        for k, x in enumerate(tk):
            b.append(x)
            bt.append((r["start"] + k * d, r["start"] + (k + 1) * d))
    sm = difflib.SequenceMatcher(None, a, b, autojunk=False)
    ta = [None] * len(a)
    for blk in sm.get_matching_blocks():
        for k in range(blk.size):
            ta[blk.a + k] = bt[blk.b + k]
    n = len(swords)
    t = [None] * n
    for i in range(n):
        own = [ta[j] for j in range(len(a)) if owner[j] == i]
        if own and all(x is not None for x in own):
            t[i] = (own[0][0], own[-1][1])
    words = [None] * n
    avg = 0.3
    if rec:
        avg = max(0.12, min(0.5, sum(r["end"] - r["start"] for r in rec) / len(rec)))
    i = 0
    while i < n:
        if t[i] is not None:
            words[i] = (t[i][0], t[i][1], True)
            i += 1
            continue
        j = i
        while j < n and t[j] is None:
            j += 1
        lo = t[i - 1][1] if i > 0 else None
        hi = t[j][0] if j < n else None
        cnt = j - i
        if lo is None and hi is None:
            lo, hi = 0.0, cnt * avg
        elif lo is None:
            lo = max(0.0, hi - cnt * avg)
        elif hi is None:
            hi = lo + cnt * avg
        hi = max(hi, lo)
        step = (hi - lo) / cnt
        for k in range(cnt):
            words[i + k] = (lo + k * step, lo + (k + 1) * step, False)
        i = j
    matched = sum(1 for w in words if w[2])
    rate = matched / n if n else 0.0
    out = [
        {"line": s["line"], "w": s["w"], "word": s["word"], "start": w[0], "end": w[1], "matched": w[2]}
        for s, w in zip(swords, words)
    ]
    return out, rate


def build(script, rec):
    """Returns (doc, rate). Times are shifted so the timeline starts 0.1 s before the first word."""
    words, rate = map_words(script_words(script), rec)
    lead = (words[0]["start"] - LEAD_PAD) if words else 0.0
    for w in words:
        w["start"] = round(w["start"] - lead, 3)
        w["end"] = round(w["end"] - lead, 3)
    return {"meta": {"lead": round(lead, 3), "matchRate": round(rate, 4)}, "words": words}, rate


def first_unmatched(words, ctx=5):
    for i, w in enumerate(words):
        if not w["matched"]:
            j = i
            while j < len(words) and not words[j]["matched"]:
                j += 1
            before = " ".join(x["word"] for x in words[max(0, i - ctx):i])
            bad = " ".join(x["word"] for x in words[i:j])
            after = " ".join(x["word"] for x in words[j:j + ctx])
            return f'{words[i]["line"]}:{words[i]["w"]}  ...{before} [[{bad}]] {after}...'
    return None


def transcribe(voice, prompt):
    from faster_whisper import WhisperModel  # lazy: tests never load the model

    import subprocess

    import numpy as np

    # decode with ffmpeg (16 kHz mono float) so we do not depend on the PyAV version
    pcm = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", voice, "-f", "f32le", "-ac", "1", "-ar", "16000", "-"],
        check=True, capture_output=True,
    ).stdout
    audio = np.frombuffer(pcm, dtype=np.float32)
    model = WhisperModel("small.en", device="cpu", compute_type="int8")
    segs, _ = model.transcribe(
        audio, word_timestamps=True, initial_prompt=prompt or None, language="en", beam_size=5,
        condition_on_previous_text=False,
    )
    rec = []
    for s in segs:
        for w in s.words or []:
            rec.append({"word": w.word.strip(), "start": round(w.start, 3), "end": round(w.end, 3)})
    return rec


def main(argv):
    args = [a for a in argv if not a.startswith("--")]
    opt = {}
    for k in ("--recognised", "--raw"):
        if k in argv:
            opt[k] = argv[argv.index(k) + 1]
            args.remove(opt[k])
    if len(args) != 3:
        print(__doc__)
        return 2
    voice, script_path, out = args
    script = None if script_path == "-" else json.load(open(script_path))
    if "--recognised" in opt:
        rec = json.load(open(opt["--recognised"]))
    else:
        rec = transcribe(voice, prompt_text(script) if script else None)
    if script is None:
        raw = opt.get("--raw", out)
        json.dump({"words": rec}, open(raw, "w"))
        dur = rec[-1]["end"] if rec else 0
        print(f"words.raw.json: {len(rec)} words, {dur:.2f} s")
        return 0
    doc, rate = build(script, rec)
    json.dump(doc, open(out, "w"), indent=1)
    print(f"align: {len(doc['words'])} words, matchRate {rate:.1%}, lead {doc['meta']['lead']}s")
    if rate < MIN_RATE:
        print("align: matchRate under 90%. First unmatched stretch: " + first_unmatched(doc["words"]))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
