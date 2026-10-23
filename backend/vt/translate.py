import time

from deep_translator import GoogleTranslator, MyMemoryTranslator

from .util import emit

MYMEMORY_CODES = {
    "vi": "vi-VN", "en": "en-GB", "ja": "ja-JP", "ko": "ko-KR", "zh-CN": "zh-CN",
    "zh-TW": "zh-TW", "fr": "fr-FR", "de": "de-DE", "es": "es-ES", "th": "th-TH", "id": "id-ID",
}
MIN_INTERVAL = 0.25


class Translator:
    """Free translation with automatic fallback: Google (unofficial) -> MyMemory."""

    def __init__(self, source="zh-CN", target="vi", glossary=None, engine="auto"):
        self.glossary = glossary or {}
        self.cache = {}
        self.last_call = 0.0
        factories = {
            "google": lambda: GoogleTranslator(source=source, target=target),
            "mymemory": lambda: MyMemoryTranslator(
                source=MYMEMORY_CODES.get(source, source), target=MYMEMORY_CODES.get(target, target)
            ),
        }
        order = ["google", "mymemory"] if engine == "auto" else [engine]
        self.engines = [(name, factories[name]()) for name in order]

    def _apply_glossary(self, text):
        if text in self.glossary:
            return None, self.glossary[text]
        for key in sorted(self.glossary, key=len, reverse=True):
            if key and key in text:
                text = text.replace(key, self.glossary[key])
        return text, None

    def _call(self, text):
        last_error = None
        while self.engines:
            name, engine = self.engines[0]
            for _ in range(2):
                wait = MIN_INTERVAL - (time.time() - self.last_call)
                if wait > 0:
                    time.sleep(wait)
                self.last_call = time.time()
                try:
                    return engine.translate(text) or ""
                except Exception as exc:
                    last_error = exc
                    time.sleep(1.0)
            if len(self.engines) > 1:
                emit(type="warn", message=f"{name} failed ({last_error}); switching to {self.engines[1][0]}")
                self.engines.pop(0)
            else:
                break
        raise RuntimeError(f"Translate failed: {last_error}")

    def translate(self, text):
        text = text.strip()
        if not text:
            return ""
        prepared, direct = self._apply_glossary(text)
        if direct is not None:
            return direct
        if prepared not in self.cache:
            self.cache[prepared] = self._call(prepared)
        return self.cache[prepared]

    def translate_many(self, texts):
        return [self.translate(t) for t in texts]
