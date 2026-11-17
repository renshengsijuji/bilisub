"""语音识别（可选）：faster-whisper，未安装时给出明确错误"""
import os
import numpy as np


class ASRError(Exception):
    pass


class WhisperASR:
    def __init__(self, model_dir: str, language: str = "en", cpu_threads: int = None):
        try:
            from faster_whisper import WhisperModel
        except Exception as exc:
            raise ASRError(
                "未安装 faster-whisper，先执行: pip install faster-whisper\n" + str(exc)
            )

        threads = int(cpu_threads or os.cpu_count() or 4)
        self.model = WhisperModel(
            model_dir, device="cpu", compute_type="int8", cpu_threads=max(1, threads)
        )
        self.language = language

    def transcribe(self, audio_f32: "np.ndarray", language: str = None, initial_prompt: str = None) -> str:
        if audio_f32 is None or len(audio_f32) < 1600:
            return ""
        segments, _info = self.model.transcribe(
            audio_f32,
            language=language or self.language,
            vad_filter=True,
            vad_parameters={"min_silence_duration_ms": 300},
            beam_size=1,
            best_of=1,
            temperature=0.0,
            without_timestamps=True,
            condition_on_previous_text=False,
            initial_prompt=initial_prompt or None,
        )
        return " ".join(s.text.strip() for s in segments).strip()
