"""Choose a working model for a key, and fall back when the chosen one stalls.

A key can list many models it cannot actually call (retired, not on the free tier, or
overloaded), so ChemEZ asks the strongest-looking candidates for a one-word reply and keeps
the best that answers, plus a few working backups.
"""
import asyncio, re
from .providers import ProviderError

# Families known to answer chemistry well, strongest first; matched against model IDs.
PREFERRED = ['nemotron-3-ultra', 'claude-opus', 'gpt-5', 'gemini-3.5-pro', 'claude-sonnet', 'glm-5', 'nemotron-3.5-super', 'nemotron-3-super',
             'qwen3.5-122b', 'kimi-k2', 'deepseek-v4', 'minimax-m3', 'gemini-3.5-flash', 'gpt-oss-120b', 'llama-4', 'mistral-large', 'gpt-oss-20b',
             'nemotron-3.5-lightning', 'nemotron-3.5-bolt']
NOT_CHAT = re.compile(r'embed|rerank|guard|safety|reward|clip|parse|retriev|image|vision-?only|tts|whisper|asr|ocr|diffusion|flux|stable|coder|code|calibration|muse|translate', re.I)
STALL_SECONDS = 30
PROBE_SECONDS = 25


def rank(ids):
    """Chat models, most promising first: known strong families, then by parameter count."""
    def size(model):
        found = re.findall(r'(\d+(?:\.\d+)?)b(?![a-z])', model.lower())
        return max((float(x) for x in found), default=0)
    def score(model):
        lowered = model.lower()
        known = next((i for i, family in enumerate(PREFERRED) if family in lowered), len(PREFERRED))
        return (known, -size(model), model)
    return sorted((m for m in ids if not NOT_CHAT.search(m)), key=score)


async def works(provider):
    """True when the model returns any text within PROBE_SECONDS."""
    try:
        async with asyncio.timeout(PROBE_SECONDS):
            async for chunk in provider.stream([{'role': 'user', 'content': {'text': 'Reply with the word ok.', 'images': []}}], system='Reply with one word.'):
                if chunk.strip():
                    return True
    except Exception:
        return False
    return False


async def pick(config, key, provider_factory, candidates=10):
    """(best model, working backups) for this key, or (None, []) if nothing answers."""
    listed = [m['id'] for m in await provider_factory({**config, 'model': config.get('model') or 'auto'}, key).models()]
    ranked = rank(listed)[:candidates]
    results = await asyncio.gather(*(works(provider_factory({**config, 'model': model}, key)) for model in ranked))
    working = [model for model, ok in zip(ranked, results) if ok]
    return (working[0], working[1:5]) if working else (None, [])


async def stream_with_fallback(config, key, provider_factory, messages, system, on_switch=None):
    """Stream from the configured model; if it sends nothing for STALL_SECONDS, try the backups."""
    models = [config['model'], *[m for m in config.get('fallbacks') or [] if m != config['model']]]
    last_error = None
    for index, model in enumerate(models):
        stream = provider_factory({**config, 'model': model}, key).stream(messages, system=system).__aiter__()
        try:
            first = await asyncio.wait_for(stream.__anext__(), STALL_SECONDS if index < len(models) - 1 else None)
        except (asyncio.TimeoutError, StopAsyncIteration) as exc:
            last_error = exc
            await stream.aclose()
            if index + 1 < len(models) and on_switch:
                on_switch(model, models[index + 1])
            continue
        except Exception as exc:
            # A model that is gone or refused moves on to the next backup as well.
            if index + 1 < len(models) and re.search(r'not found|no longer|410|404|no new data|busy|stalled', str(exc), re.I):
                last_error = exc
                if on_switch:
                    on_switch(model, models[index + 1])
                continue
            raise
        if index and on_switch:
            on_switch(None, model)
        yield first
        async for chunk in stream:
            yield chunk
        return
    raise last_error if isinstance(last_error, Exception) and not isinstance(last_error, (asyncio.TimeoutError, StopAsyncIteration)) else ProviderError('None of the saved models answered. Open Model & API and choose Automatic to find a working model.')
