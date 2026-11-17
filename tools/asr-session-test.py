"""模拟实时听声：按 20ms 帧喂音频，测每句字幕的到达延迟"""
import asyncio, os, sys, time, wave
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "engine"))
sys.stdout.reconfigure(encoding="utf-8")

import main as engine_mod

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(BASE, "engine"))
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

        msg = json.loads(payload)
        if msg.get("type") == "caption":
            self.events.append((time.time(), msg))


async def run():
    cfg = engine_mod.load_config()
    eng = engine_mod.Engine(cfg)
    print("实时 ASR 模型:", eng._asr_model_id("realtime"), "| 高质量:", eng._asr_model_id("quality"))

    ws = FakeWS()
    session = engine_mod.AudioSession(ws, eng, "bench", "en")
    # 模拟 stt.start 时的预热
    engine_mod._preload_asr(eng)
    audio = load_wav(WAV)
    pcm = (audio * 32767).astype("<i2").tobytes()

    frame_bytes = 16000 * 2 * 0.02  # 20ms
    frame_bytes = int(frame_bytes)
    start = time.time()
    print(f"音频 {len(pcm)/32000:.1f}s，开始按实时速度喂入…")

    for i in range(0, len(pcm), frame_bytes):
        await session.feed(pcm[i : i + frame_bytes])
        target = start + (i + frame_bytes) / 32000
        delay = target - time.time()
        if delay > 0:
            await asyncio.sleep(delay)

    await asyncio.sleep(2.0)  # 等最后一句
    print("\n字幕到达情况（延迟 = 到达时刻 - 该段音频结束时刻）：")
    for t, msg in ws.events:
        kind = "最终" if msg.get("final") else "中间"
        print(f"  +{t - start:5.1f}s  {msg['ms']:4d}ms  [{kind}]  {msg['text'][:60]}")
    print(f"\n共 {len(ws.events)} 条字幕（中间结果 {sum(1 for _, m in ws.events if not m.get('final'))} 条）")


asyncio.run(run())
