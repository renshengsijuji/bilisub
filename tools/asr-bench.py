"""ASR 速度基准：对比 tiny / small 在 2 秒与 5 秒窗口下的耗时"""
import sys, time, wave, os
import numpy as np

sys.stdout.reconfigure(encoding="utf-8")

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODELS = os.path.join(BASE, "models")
WAV = os.path.join(BASE, "tools", "speech.wav")


def load_wav(path):
    with wave.open(path, "rb") as w:
        sr = w.getframerate()
        ch = w.getnchannels()
        sw = w.getsampwidth()
        data = w.readframes(w.getnframes())
    if sw != 2:
        raise SystemExit("需要 16bit wav")
    audio = np.frombuffer(data, dtype="<i2").astype("float32") / 32768.0
    if ch == 2:
        audio = audio.reshape(-1, 2).mean(axis=1)
    if sr != 16000:
        n = int(len(audio) * 16000 / sr)
        audio = np.interp(np.linspace(0, len(audio), n, endpoint=False), np.arange(len(audio)), audio).astype("float32")
    return audio


def bench(model_id, audio, seconds, rounds=3):
    from faster_whisper import WhisperModel

    path = os.path.join(MODELS, model_id)
    threads = os.cpu_count() or 4
    t0 = time.time()
    model = WhisperModel(path, device="cpu", compute_type="int8", cpu_threads=threads)
    load_ms = (time.time() - t0) * 1000

    clip = audio[: int(16000 * seconds)]
    # 预热
    list(model.transcribe(clip, language="en", vad_filter=True, beam_size=1, best_of=1,
                          temperature=0.0, without_timestamps=True,
                          condition_on_previous_text=False)[0])

    times = []
    text = ""
    for _ in range(rounds):
        t = time.time()
        segs, _ = model.transcribe(clip, language="en", vad_filter=True, beam_size=1, best_of=1,
                                   temperature=0.0, without_timestamps=True,
                                   condition_on_previous_text=False,
                                   vad_parameters={"min_silence_duration_ms": 300})
        text = " ".join(s.text.strip() for s in segs).strip()
        times.append((time.time() - t) * 1000)

    avg = sum(times) / len(times)
    print(f"{model_id:18} {seconds:>2}s窗口  加载 {load_ms:5.0f}ms  识别均 {avg:6.0f}ms  RTF {avg/(seconds*1000):.2f}  → {text[:50]}")
    return avg


if __name__ == "__main__":
    audio = load_wav(WAV)
    print(f"样本时长 {len(audio)/16000:.1f}s，线程 {os.cpu_count()}")
    for mid in ["asr-whisper-tiny", "asr-whisper-small"]:
        if not os.path.isdir(os.path.join(MODELS, mid)):
            print("跳过", mid)
            continue
        for sec in (2, 3, 5):
            if sec > len(audio) / 16000:
                continue
            bench(mid, audio, sec)
        print()
