"""Use U.S. English narration, with only Swahili words read by sw-TZ-Daudi."""

import asyncio
import html
import json
import os
import re
import uuid
import sys
from pathlib import Path

import edge_tts

ROOT = Path(__file__).resolve().parent
I18N = ROOT / "content" / "i18n" / "en-US"
TEXTS = json.loads((I18N / "texts.json").read_text(encoding="utf-8"))
AUDIO_MAP = json.loads((I18N / "audios.json").read_text(encoding="utf-8"))
OUT = I18N / "audio"
ENGLISH_VOICE = "en-US-GuyNeural"
SWAHILI_VOICE = "sw-TZ-DaudiNeural"
RATE = "-5%"
CONCURRENCY = 15

# Words and names that must keep Tanzanian Swahili pronunciation.  The
# display text is never changed: this dictionary is used only for the audio.
SWAHILI_WORDS = {
    "adumu", "baragumu", "bugobogobo", "fulana", "gauni", "hakika",
    "heri", "hoyee", "ibariki", "kaniki", "kanga", "karibu", "kayamba",
    "kitenge", "kiswahili", "kiume", "kwanza", "lubega", "makande",
    "manyara", "mataifa", "mbuga", "mgolole", "mikocheni", "mikumi",
    "mlenda", "mola", "msuli", "msewe", "muheme", "mungu", "naipenda",
    "nakupenda", "nawe", "nchi", "ndizi", "ngorongoro", "ninapokwenda",
    "njuga", "nzuri", "safarini", "serengeti", "shati", "tanzania",
    "tubariki", "ugali", "umetia", "wageni", "wanyama", "watu", "wavutia",
    "wasio", "wema", "ya", "yako", "yangu", "yawakaribisha",
    "za", "zuri", "awe", "che ma", "chema", "daima", "fora", "kwa", "kwao",
    "msewe", "muheme", "mpigane", "n i", "ni", "oh", "tamu", "tanzania",
    "watoto", "wavutia", "wema", "yako", "yangu", "rasilimali", "zetu",
    "nyama", "ng'ombe", "kobe", "kuku", "rushwa", "tujifunzeni",
}
TERM_PATTERN = re.compile(r"\b(" + "|".join(sorted(map(re.escape, SWAHILI_WORDS), key=len, reverse=True)) + r")\b", re.I)

CONTENTS_PAGE_NUMBERS = {
    "pg003_n0006": "Page number four.", "pg003_n0008": "Page number six.",
    "pg003_n0010": "Page number one.", "pg003_n0012": "Page number one.",
    "pg003_n0014": "Page number sixteen.", "pg003_n0016": "Page number sixteen.",
    "pg003_n0018": "Page number twenty-two.", "pg003_n0020": "Page number twenty-two.",
    "pg003_n0022": "Page number twenty-eight.", "pg003_n0024": "Page number twenty-eight.",
    "pg003_n0026": "Page number fifty-five.", "pg003_n0028": "Page number fifty-five.",
    "pg003_n0030": "Page number ninety-seven.", "pg003_n0032": "Page number ninety-eight.",
}

# Text labels which must be spoken differently from their visual form.
# In particular, a standalone "(i)" is a picture label, not the number one.
SPEECH_OVERRIDES = {
    "pg008_n0010": "i.",
    "pg008_n0015": "What kind of foods do you observe in picture a, b, c, d, e, f, g, h, i and j?",
}

# These lyric and poem lines are wholly in Kiswahili.  Reading the whole line
# with the Tanzanian male voice avoids an English voice breaking up words that
# are not in the short terminology dictionary above.
SWAHILI_ONLY_IDS = {
    *(f"pg054_n{number:04d}" for number in (7, 8, 9, 10, 11, 12, 13, 14)),
    *(f"pg056_n{number:04d}" for number in (12, 13, 14, 15)),
    *(f"pg058_n{number:04d}" for number in (7, 8, 9, 10, 12, 13, 14, 15, 17, 18)),
    *(f"pg059_n{number:04d}" for number in (4, 5, 6, 7, 9, 10, 11, 12, 14, 15, 19, 20, 21, 22, 24, 25, 26, 27, 29, 30)),
}

# Possessive Tanzania's is an English sentence construction.  Keep it as one
# phrase so the reader never separates the final "s" into a second utterance.
ENGLISH_ONLY_IDS = {"pg056_n0006"}


def fallback_text(text_id: str) -> str:
    page = ROOT / f"{text_id[:5]}_sec001.html"
    if not page.exists():
        page = ROOT / "pg003_sec001.html"
    source = page.read_text(encoding="utf-8")
    match = re.search(rf"<(?P<tag>[^ >]+)[^>]*data-id=[\"']{re.escape(text_id)}[\"'][^>]*>(?P<body>.*?)</(?P=tag)>", source, re.S)
    if not match and text_id.endswith("_easy_read"):
        return fallback_text(text_id.removesuffix("_easy_read"))
    if not match:
        raise KeyError(f"No source text for {text_id}")
    return html.unescape(re.sub(r"<[^>]+>", " ", match.group("body"))).strip()


def text_for(text_id: str) -> str:
    base_id = text_id.removesuffix("_easy_read")
    if base_id in SPEECH_OVERRIDES:
        return SPEECH_OVERRIDES[base_id]
    if base_id in CONTENTS_PAGE_NUMBERS:
        return CONTENTS_PAGE_NUMBERS[base_id]
    text = TEXTS.get(text_id, TEXTS.get(base_id, ""))
    text = str(text).strip() or fallback_text(text_id)
    # The multiplication mark in song lyrics directs repetition; it must not
    # be spoken as the letter x followed by a number.
    return re.sub(r"\\bx\\s*2\\b", "repeat twice", re.sub(r"\\bx\\s*3\\b", "repeat three times", text, flags=re.I), flags=re.I)


def speech_segments(text_id: str, text: str):
    if text_id.removesuffix("_easy_read") in ENGLISH_ONLY_IDS:
        yield ENGLISH_VOICE, text
        return
    if text_id.removesuffix("_easy_read") in SWAHILI_ONLY_IDS:
        yield SWAHILI_VOICE, text
        return
    position = 0
    for match in TERM_PATTERN.finditer(text):
        if match.start() > position:
            yield ENGLISH_VOICE, text[position:match.start()]
        yield SWAHILI_VOICE, match.group(0)
        position = match.end()
    if position < len(text):
        yield ENGLISH_VOICE, text[position:]


async def make_part(text: str, voice: str, temporary: Path) -> bytes:
    for attempt in range(1, 5):
        try:
            await asyncio.wait_for(edge_tts.Communicate(text, voice=voice, rate=RATE).save(str(temporary)), timeout=60)
            data = temporary.read_bytes()
            temporary.unlink(missing_ok=True)
            return data
        except Exception:
            temporary.unlink(missing_ok=True)
            if attempt == 4:
                raise
            await asyncio.sleep(attempt * 2)


async def generate(text_id: str, filename: str, gate: asyncio.Semaphore) -> None:
    text = text_for(text_id)
    if not text:
        return
    target = OUT / filename
    async with gate:
        parts = []
        for index, (voice, segment) in enumerate(speech_segments(text_id, text)):
            # A standalone comma, bracket, or dash has no speakable content;
            # asking the speech service to render it causes a NoAudioReceived
            # error.  Spoken words on either side remain unchanged.
            if not re.search(r"[A-Za-z0-9]", segment):
                continue
            temporary = OUT / f"{target.stem}.{uuid.uuid4().hex}.{index}.mp3"
            parts.append(await make_part(segment, voice, temporary))
        staged = OUT / f"{target.stem}.{uuid.uuid4().hex}.new.mp3"
        staged.write_bytes(b"".join(parts))
        for _ in range(20):
            try:
                os.replace(staged, target)
                return
            except PermissionError:
                await asyncio.sleep(1)
        raise PermissionError(f"Could not replace locked file: {target}")


async def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    gate = asyncio.Semaphore(CONCURRENCY)
    requested_ids = set(sys.argv[1:])
    items = [(text_id, filename) for text_id, filename in AUDIO_MAP.items() if not requested_ids or text_id in requested_ids]
    errors = []
    for start in range(0, len(items), CONCURRENCY):
        batch = items[start:start + CONCURRENCY]
        results = await asyncio.gather(*(generate(text_id, filename, gate) for text_id, filename in batch), return_exceptions=True)
        errors.extend(f"{text_id}: {result}" for (text_id, _), result in zip(batch, results) if isinstance(result, Exception))
        print(f"Completed {min(start + CONCURRENCY, len(items))}/{len(items)}", flush=True)
    if errors:
        raise RuntimeError("\n".join(errors))


if __name__ == "__main__":
    asyncio.run(main())
