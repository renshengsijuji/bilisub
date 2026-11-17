"""ASR 长稳测试：同一会话连续喂 6 遍 14 秒语音（约 84 秒），观察延迟漂移与丢句"""
import asyncio, os, sys, time, wave
import numpy as np

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(BASE, "engine"))
sys.stdout.reconfigure(encoding="utf-8")

import main as engine_mod

WAV = os.path.join(BASE, "tools", "speech.wav")


def load_wav(path):
    with wave.open(path, "rb") as w:
        sr, ch, sw = w.getframerate(), w.getnchannels(), w.getsampwidth()
        data = w.readframes(w.getnframes())
    audio = np.frombuffer(data, dtype="<i2").astype("float32") / 32768.0
    if ch == 2:
        audio = audio.reshape(-1, 2).mean(axis=1)
    if sr != 16000:
        n = int(len(audio) * 16000 / sr)
        audio = np.interp(np.linspace(0, len(audio), n, endpoint=False), np.arange(len(audio)), audio)
    return np.clip(audio, -1, 1).astype("float32")


class FakeWS:
    def __init__(self):
        self.events = []

    async def send(self, payload):
        import json

        m = json.loads(payload)
        if m.get("type") == "caption":
            self.events.append((time.time(), m))


async def run():
    cfg = engine_mod.load_config()
    eng = engine_mod.Engine(cfg)
    engine_mod._preload_asr(eng)
    ws = FakeWS()
    session = engine_mod.AudioSession(ws, eng, "soak", "en")
    audio = load_wav(WAV)
    pcm = (audio * 32767).astype("<i2").tobytes()

    frame = int(16000 * 2 * 0.02)
    start = time.time()
    passes = 6
    for p in range(passes):
        for i in range(0, len(pcm), frame):
            await session.feed(pcm[i : i + frame])
            target = start + p * len(pcm) / 32000 + (i + frame) / 32000
            delay = target - time.time()
            if delay > 0:
                await asyncio.sleep(delay)
        print(f"  第 {p + 1} 遍完成 · 累计字幕 {len(ws.events)} 条 · 已运行 {time.time() - start:.0f}s")
    await asyncio.sleep(2.5)

    finals = [m for _, m in ws.events if m.get("final")]
    partials = [m for _, m in ws.events if not m.get("final")]
    print(f"\n总计 {passes} 遍 / {passes * len(audio) / 16000:.0f} 秒音频")
    print(f"  字幕 {len(ws.events)} 条（中间 {len(partials)} / 定稿 {len(finals)}）")
    if finals:
        ms = [m["ms"] for m in finals]
        print(f"  定稿延迟: 平均 {sum(ms) / len(ms):.0f}ms  最大 {max(ms)}ms")
        texts = [m["text"] for m in finals]
        print(f"  最后一句: {texts[-1][:60]}")
    if partials:
        pms = [m["ms"] for m in partials]
        print(f"  中间结果延迟: 平均 {sum(pms) / len(pms):.0f}ms  最大 {max(pms)}ms")


asyncio.run(run())
