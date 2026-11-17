"""BiliSub 本地引擎
- WebSocket 服务：翻译、字幕识别、模型下载、硬件检测
- 仅监听 127.0.0.1，校验 Origin（只允许浏览器扩展）
"""
import argparse
import asyncio
import json
import os
import queue
import shutil
import sys
import threading
import time
import urllib.request

BASE = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(BASE, "config.json")
from hardware import detect
from models import ModelManager

PROTOCOL = 1
VERSION = "0.2.3"

try:  # Windows 控制台默认 GBK，统一成 UTF-8，避免中文乱码
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

DEFAULT_CONFIG = {
    "port": 8765,
    "models_dir": os.path.join(os.path.dirname(BASE), "models"),
    "mt": {
        "realtime": {"provider": "local", "model": "mt-opus-en-zh"},
        "quality": {"provider": "local", "model": "mt-nllb-600m"},
    },
    "asr": {"model": "asr-whisper-small", "enabled": True},
}


def load_config():
    cfg = json.loads(json.dumps(DEFAULT_CONFIG))
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                user = json.load(f)
            cfg.update({k: v for k, v in user.items() if k in cfg and k != "mt"})
            user_mt = user.get("mt")
            if isinstance(user_mt, dict):
                if "realtime" not in user_mt and "quality" not in user_mt:
                    # 旧版扁平配置：实时用快速模型，原有的选择留作高质量
                    flat = {k: user_mt[k] for k in ("provider", "model") if k in user_mt}
                    if flat:
                        cfg["mt"] = {
                            "realtime": {"provider": "local", "model": "mt-opus-en-zh"},
                            "quality": dict(flat),
                        }
                else:
                    cfg["mt"].update(user_mt)
            if isinstance(user.get("asr"), dict):
                cfg["asr"].update(user["asr"])
        except Exception as exc:
            print("[config] 读取失败，使用默认值:", exc, file=sys.stderr)
    os.makedirs(cfg["models_dir"], exist_ok=True)
    return cfg


class Engine:
    def __init__(self, cfg):
        with open(os.path.join(BASE, "catalog.json"), "r", encoding="utf-8") as f:
            catalog = json.load(f)

        self.cfg = cfg
        self.catalog = catalog
        self.models = ModelManager(cfg["models_dir"], catalog)
        self.hardware = detect(cfg["models_dir"])
        self.mt = {}
        self.asr = {}
        self.downloading = None
        self.notice = None
        self.warm = False
        self.mt_locks = {}
        self.lock = threading.Lock()

    # ---------- 翻译 ----------
    def _mt_cfg(self, role):
        mt = self.cfg.get("mt", {}) or {}
        if isinstance(mt.get(role), dict):
            return dict(mt[role])
        # 兼容旧配置（扁平的 provider/model）
        return {
            "provider": mt.get("provider", "local"),
            "model": mt.get("model", "mt-opus-en-zh"),
        }

    def get_mt(self, role="realtime"):
        with self.lock:
            if role in self.mt:
                return self.mt[role]

            from mt import build_mt

            wanted = self._mt_cfg(role)
            try:
                provider = build_mt(wanted, self.models)
                self.mt[role] = provider
                return provider
            except Exception as first_error:
                # 选中的模型坏了也不要让整个插件不可用：自动回退到其它已安装翻译模型
                for model in self.catalog:
                    if model.get("kind") != "mt":
                        continue
                    if model["id"] == wanted.get("model"):
                        continue
                    if not self.models.is_installed(model["id"]):
                        continue
                    try:
                        provider = build_mt({"provider": "local", "model": model["id"]}, self.models)
                        self.mt[role] = provider
                        self.notice = "%s 模型 %s 加载失败，已自动切换为 %s" % (
                            "实时" if role == "realtime" else "高质量",
                            wanted.get("model"),
                            model["id"],
                        )
                        print("[mt] " + self.notice, file=sys.stderr)
                        return provider
                    except Exception:
                        continue
                raise first_error

    def _role_lock(self, role):
        with self.lock:
            return self.mt_locks.setdefault(role, threading.Lock())

    def _translate_role(self, role, texts, src, tgt):
        provider = self.get_mt(role)
        # 同一角色的模型串行使用（CT2 模型不保证并发安全），不同角色互不阻塞
        with self._role_lock(role):
            return provider.translate(list(texts), src=src, tgt=tgt)

    def translate(self, texts, src, tgt, role="realtime"):
        try:
            return self._translate_role(role, texts, src, tgt)
        except Exception:
            # 实时模型不支持该语种/失败时，退回高质量模型（例如 OPUS 只支持英译中）
            if role == "realtime":
                self.notice = "实时模型无法处理该语言，已改用高质量模型"
                return self._translate_role("quality", texts, src, tgt)
            raise

    def warmup(self):
        """启动后预加载实时模型，避免第一句字幕干等 3 秒"""
        try:
            provider = self.get_mt("realtime")
            provider.translate(["hello"], src="en", tgt="zh")
            self.warm = True
            print("[mt] 实时模型已预热", file=sys.stderr)
        except Exception as exc:
            print("[mt] 预热失败: %s" % exc, file=sys.stderr)

        # Ollama 首次加载要十几秒：启动时也把它拉起来（失败不影响实时）
        cfg = self._mt_cfg("quality")
        if cfg.get("provider") == "ollama":
            try:
                self.get_mt("quality").translate(["hello"], src="en", tgt="zh")
                print("[mt] 高质量模型已预热（Ollama）", file=sys.stderr)
            except Exception as exc:
                print("[mt] 高质量模型预热失败: %s" % exc, file=sys.stderr)

    # ---------- 模型目录 ----------
    def set_models_dir(self, path):
        self.cfg["models_dir"] = path
        self.models = ModelManager(path, self.catalog)
        self.hardware = detect(path)
        self.mt = {}
        self.asr = {}

    def save_config(self):
        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(self.cfg, f, ensure_ascii=False, indent=2)

    def models_dir_info(self):
        root = self.cfg["models_dir"]
        total = 0
        for dirpath, _dirs, files in os.walk(root):
            for name in files:
                try:
                    total += os.path.getsize(os.path.join(dirpath, name))
                except OSError:
                    pass
        try:
            free = shutil.disk_usage(root).free
        except OSError:
            free = 0
        return {"path": root, "size": total, "free": free}

    # ---------- 语音识别 ----------
    def _asr_model_id(self, role="realtime"):
        cfg = self.cfg.get("asr", {})
        quality = cfg.get("model", "asr-whisper-small")
        if role == "final":
            # 定稿句用更准的模型（默认 small），没装就退回主模型
            want = cfg.get("final") or quality
            return want if self.models.is_installed(want) else quality
        if role != "realtime":
            return quality
        # 实时听声优先用 tiny（快 3~5 倍），没装则退回主模型
        want = cfg.get("realtime") or "asr-whisper-tiny"
        return want if self.models.is_installed(want) else quality

    def diagnose(self):
        """自检：翻译两个角色各跑一句，语音模型各加载一次"""
        result = {"mt": {}, "asr": {}}
        for role in ("realtime", "quality"):
            started = time.time()
            try:
                provider = self.get_mt(role)
                texts = provider.translate(["Hello, this is a health check."], src="en", tgt="zh")
                result["mt"][role] = {
                    "ok": True,
                    "model": self._mt_cfg(role).get("model"),
                    "provider": self._mt_cfg(role).get("provider"),
                    "ms": int((time.time() - started) * 1000),
                    "text": texts[0] if texts else "",
                }
            except Exception as exc:
                result["mt"][role] = {"ok": False, "model": self._mt_cfg(role).get("model"), "error": str(exc)}

        for role in ("realtime", "final"):
            started = time.time()
            try:
                asr = self.get_asr(role)
                result["asr"][role] = {
                    "ok": True,
                    "model": getattr(asr, "model_id", self._asr_model_id(role)),
                    "ms": int((time.time() - started) * 1000),
                }
            except Exception as exc:
                result["asr"][role] = {"ok": False, "model": self._asr_model_id(role), "error": str(exc)}

        return result

    def get_asr(self, role="realtime"):
        with self.lock:
            model_id = self._asr_model_id(role)
            cached = self.asr.get(role)
            # 模型被换掉（例如新下载了更准的定稿模型）时自动重建
            if cached is not None and getattr(cached, "model_id", "") == model_id:
                return cached

            from asr import WhisperASR, ASRError

            if not self.models.is_installed(model_id):
                raise ASRError("语音模型未安装: " + model_id)

            # 实时 tiny 与定稿模型并行解码，各占一部分核心，避免互相饿死
            cores = os.cpu_count() or 8
            threads = max(2, cores // 3) if role == "realtime" else max(4, cores - cores // 3)
            asr = WhisperASR(self.models.path(model_id), language="en", cpu_threads=threads)
            asr.model_id = model_id
            self.asr[role] = asr
            return asr

    def transcribe(self, pcm_bytes, language="en", role="realtime", prompt=None):
        import numpy as np
        audio = np.frombuffer(pcm_bytes, dtype="<i2").astype("float32") / 32768.0
        return self.get_asr(role).transcribe(audio, language=language, initial_prompt=prompt)

    # ---------- 信息 ----------
    def ollama_status(self):
        try:
            with urllib.request.urlopen("http://127.0.0.1:11434/api/tags", timeout=1.5) as res:
                data = json.loads(res.read().decode("utf-8"))
            return {"available": True, "models": [m.get("name") for m in data.get("models", [])]}
        except Exception:
            return {"available": False, "models": []}

    def welcome(self):
        return {
            "v": PROTOCOL,
            "type": "welcome",
            "server": VERSION,
            "hardware": self.hardware,
            "models": self.models.list(),
            "caps": {
                "mt": ["local", "ollama", "openai", "mock"],
                "asr": ["whisper"] if self._asr_available() else [],
            },
            "ollama": self.ollama_status(),
            "current": {
                "mt": {
                    "realtime": self._mt_cfg("realtime"),
                    "quality": self._mt_cfg("quality"),
                },
                "asr": {
                    "model": self._asr_model_id("quality"),
                    "realtime": self._asr_model_id("realtime"),
                    "final": self._asr_model_id("final"),
                },
                "warm": self.warm,
            },
        }

    def _asr_available(self):
        try:
            import faster_whisper  # noqa: F401
            return True
        except Exception:
            return False


# ------------------------------------------------------------------ 会话

class AudioSession:
    CHUNK_BYTES = 16000 * 2 * 2  # 2 秒 16k/16bit 单声道（最长等待）
    SILENCE_RMS = 0.006          # 低于此值视为静音
    MIN_SPEECH_BYTES = 16000 * 2 * 0.9  # 至少 0.9 秒才送去识别
    MIN_PARTIAL_BYTES = 16000 * 2 * 1.2  # 中间结果至少 1.2 秒
    MAX_BYTES = 16000 * 2 * 4    # 最多攒 4 秒（缩短定稿解码时间）

    def __init__(self, ws, engine, session_id, language="en"):
        self.ws = ws
        self.engine = engine
        self.id = session_id
        self.language = language
        self.buf = bytearray()
        self.running = True
        self.partial_busy = False
        self.final_busy = False
        self.silence_ms = 0
        self.last_partial = 0.0
        self.prompt = ""

    async def feed(self, data: bytes):
        self.buf.extend(data)

        # 用最近一小段的能量判断是否静音，静音持续 400ms 就切句
        try:
            import numpy as np

            tail = np.frombuffer(bytes(self.buf[-6400:]), dtype="<i2").astype("float32") / 32768.0
            rms = float(np.sqrt(np.mean(tail * tail))) if tail.size else 0.0
        except Exception:
            rms = 1.0

        if rms < self.SILENCE_RMS:
            self.silence_ms += min(200, int(len(data) / 32))
        else:
            self.silence_ms = 0

        ready = len(self.buf) >= self.MAX_BYTES or (
            self.silence_ms >= 400 and len(self.buf) >= self.MIN_SPEECH_BYTES
        )
        if ready and not self.final_busy:
            chunk = bytes(self.buf)
            self.buf.clear()
            self.silence_ms = 0
            self.last_partial = 0.0
            if len(chunk) < 16000:  # 太短，不值得识别
                return
            self.final_busy = True
            asyncio.get_running_loop().create_task(self._run(chunk, True))
            return

        # 定稿还在解码时限制缓冲长度，避免无限增长
        if self.final_busy and len(self.buf) > self.MAX_BYTES:
            del self.buf[: len(self.buf) - self.MAX_BYTES]

        # 中间结果：并行解码，定稿运行时也继续出字（每 0.8 秒一次）
        if self.partial_busy:
            return
        now = time.time()
        if len(self.buf) >= self.MIN_PARTIAL_BYTES and now - self.last_partial >= 0.8:
            self.last_partial = now
            self.partial_busy = True
            asyncio.get_running_loop().create_task(self._run(bytes(self.buf), False))

    async def _run(self, chunk, final=True):
        try:
            started = time.time()
            # 中间结果用 tiny（快），定稿句用更准的模型重解一次
            role = "final" if final else "realtime"
            text = await asyncio.to_thread(
                self.engine.transcribe, chunk, self.language, role, self.prompt if final else None
            )
            if text and (final or text != getattr(self, "_last_partial_text", "")):
                if not final:
                    self._last_partial_text = text
                else:
                    self._last_partial_text = ""
                    self.prompt = text[-160:]
                await self.ws.send(json.dumps({
                    "v": PROTOCOL,
                    "type": "caption",
                    "session": self.id,
                    "final": final,
                    "src": self.language,
                    "text": text,
                    "ms": int((time.time() - started) * 1000),
                }, ensure_ascii=False))
        except Exception as exc:
            try:
                await self.ws.send(json.dumps({
                    "v": PROTOCOL, "type": "error", "code": "ASR_FAILED",
                    "message": str(exc), "retryable": False,
                }, ensure_ascii=False))
            except Exception:
                pass
        finally:
            if final:
                self.final_busy = False
            else:
                self.partial_busy = False

    async def finish(self):
        self.running = False
        if len(self.buf) > 16000:
            await self._run(bytes(self.buf))
        self.buf.clear()


# ------------------------------------------------------------------ 服务

def origin_allowed(ws) -> bool:
    try:
        origin = ws.request.headers.get("Origin", "")
    except Exception:
        return True
    if not origin:
        return True  # 本地命令行测试
    return origin.startswith("chrome-extension://") or origin.startswith("extension://")


async def handle_set_dir(ws, engine, msg):
    req_id = msg.get("id")
    target = os.path.abspath(str(msg.get("path") or "").strip())
    if not target:
        await ws.send(json.dumps({
            "v": PROTOCOL, "type": "error", "id": req_id,
            "code": "BAD_PATH", "message": "路径为空",
        }, ensure_ascii=False))
        return

    try:
        os.makedirs(target, exist_ok=True)
        probe = os.path.join(target, ".bilisub_write_test")
        with open(probe, "wb") as f:
            f.write(b"ok")
        os.remove(probe)
    except Exception as exc:
        await ws.send(json.dumps({
            "v": PROTOCOL, "type": "error", "id": req_id,
            "code": "PATH_NOT_WRITABLE", "message": "目录不可写: " + str(exc),
        }, ensure_ascii=False))
        return

    old = engine.cfg["models_dir"]
    moved = 0
    if msg.get("move") and os.path.isdir(old) and os.path.abspath(old) != target:
        try:
            for name in os.listdir(old):
                src = os.path.join(old, name)
                dst = os.path.join(target, name)
                if os.path.exists(dst):
                    continue
                shutil.move(src, dst)
                moved += 1
        except Exception as exc:
            await ws.send(json.dumps({
                "v": PROTOCOL, "type": "error", "id": req_id,
                "code": "MOVE_FAILED", "message": "移动模型失败: " + str(exc),
            }, ensure_ascii=False))
            return

    engine.set_models_dir(target)
    engine.save_config()

    info = await asyncio.to_thread(engine.models_dir_info)
    await ws.send(json.dumps({
        "v": PROTOCOL, "type": "models.dir.set", "id": req_id,
        "moved": moved, **info,
    }, ensure_ascii=False))


def choose_directory(initial):
    """用系统原生目录选择框（tkinter），支持手动输入作为兜底"""
    try:
        import tkinter as tk
        from tkinter import filedialog
    except Exception as exc:
        raise RuntimeError("当前 Python 缺少 tkinter，请手动输入路径") from exc

    root = tk.Tk()
    root.withdraw()
    try:
        root.attributes("-topmost", True)
    except Exception:
        pass
    path = filedialog.askdirectory(initialdir=initial, title="选择模型存储位置")
    root.destroy()
    return path or None


async def handle(ws, engine):
    if not origin_allowed(ws):
        await ws.close(code=1008, reason="origin not allowed")
        return

    await ws.send(json.dumps(engine.welcome(), ensure_ascii=False))
    session = None
    translate_sem = asyncio.Semaphore(4)

    async for raw in ws:
        if isinstance(raw, (bytes, bytearray)):
            if session:
                await session.feed(bytes(raw))
            continue

        try:
            msg = json.loads(raw)
        except Exception:
            continue

        kind = msg.get("type")

        if kind == "ping":
            await ws.send(json.dumps({"v": PROTOCOL, "type": "pong"}))
            continue

        if kind == "hello":
            await ws.send(json.dumps(engine.welcome(), ensure_ascii=False))
            continue

        if kind == "translate.batch":
            # 并行处理：7B 加载/推理时不再堵住实时翻译请求
            asyncio.create_task(_handle_translate(ws, engine, msg, translate_sem))
            continue

        if kind == "diagnose":
            try:
                result = await asyncio.to_thread(engine.diagnose)
                await ws.send(json.dumps({
                    "v": PROTOCOL, "type": "diagnose.result", "id": msg.get("id"), **result,
                }, ensure_ascii=False))
            except Exception as exc:
                await ws.send(json.dumps({
                    "v": PROTOCOL, "type": "error", "id": msg.get("id"),
                    "code": "DIAGNOSE_FAILED", "message": str(exc),
                }, ensure_ascii=False))
            continue

        if kind == "models.list":
            await ws.send(json.dumps({
                "v": PROTOCOL, "type": "models.result", "id": msg.get("id"),
                "models": engine.models.list(),
            }, ensure_ascii=False))
            continue

        if kind == "models.download":
            await handle_download(ws, engine, msg)
            continue

        if kind == "models.dir":
            info = await asyncio.to_thread(engine.models_dir_info)
            await ws.send(json.dumps({
                "v": PROTOCOL, "type": "models.dir.result", "id": msg.get("id"), **info,
            }, ensure_ascii=False))
            continue

        if kind == "models.chooseDir":
            try:
                path = await asyncio.to_thread(choose_directory, engine.cfg["models_dir"])
                await ws.send(json.dumps({
                    "v": PROTOCOL, "type": "models.dir.chosen", "id": msg.get("id"), "path": path,
                }, ensure_ascii=False))
            except Exception as exc:
                await ws.send(json.dumps({
                    "v": PROTOCOL, "type": "error", "id": msg.get("id"),
                    "code": "CHOOSE_DIR_FAILED", "message": str(exc),
                }, ensure_ascii=False))
            continue

        if kind == "models.setDir":
            await handle_set_dir(ws, engine, msg)
            continue

        if kind == "config.set":
            # 运行期切换翻译引擎（不落盘）
            if isinstance(msg.get("mt"), dict):
                engine.cfg["mt"] = msg["mt"]
                engine.mt = {}
            await ws.send(json.dumps({"v": PROTOCOL, "type": "ok", "id": msg.get("id")}))
            continue

        if kind == "config.save":
            try:
                if isinstance(msg.get("mt"), dict):
                    engine.cfg["mt"] = msg["mt"]
                    engine.mt = {}
                if isinstance(msg.get("asr"), dict):
                    engine.cfg["asr"].update(msg["asr"])
                    engine.asr = {}
                with open(CONFIG_PATH, "w", encoding="utf-8") as f:
                    json.dump(engine.cfg, f, ensure_ascii=False, indent=2)
                await ws.send(json.dumps({"v": PROTOCOL, "type": "ok", "id": msg.get("id")}))
            except Exception as exc:
                await ws.send(json.dumps({
                    "v": PROTOCOL, "type": "error", "id": msg.get("id"),
                    "code": "CONFIG_SAVE_FAILED", "message": str(exc),
                }, ensure_ascii=False))
            continue

        if kind == "stt.start":
            session = AudioSession(ws, engine, msg.get("session") or "default", msg.get("src", "en"))
            # 后台预加载实时语音模型，避免第一句多等近 1 秒
            asyncio.get_running_loop().run_in_executor(None, _preload_asr, engine)
            await ws.send(json.dumps({
                "v": PROTOCOL, "type": "stt.ready", "session": session.id,
                "sampleRate": 16000, "format": "s16le",
            }))
            continue

        if kind == "stt.stop":
            if session:
                await session.finish()
                session = None
            await ws.send(json.dumps({"v": PROTOCOL, "type": "stt.stopped"}))
            continue


def _preload_asr(engine):
    """后台预加载实时语音模型（失败忽略，真正用到时会给出明确错误）"""
    try:
        engine.get_asr("realtime")
        print("[asr] 实时语音模型已预热", file=sys.stderr)
    except Exception as exc:
        print("[asr] 预热失败: %s" % exc, file=sys.stderr)


async def _handle_translate(ws, engine, msg, sem):
    """并发处理翻译请求：不同角色的模型各有独立锁，互不阻塞"""
    async with sem:
        try:
            texts = msg.get("texts") or []
            role = msg.get("role") or "realtime"
            result = await asyncio.to_thread(
                engine.translate, texts, msg.get("src", "en"), msg.get("tgt", "zh"), role
            )
            if engine.notice:
                await ws.send(json.dumps({
                    "v": PROTOCOL, "type": "notice", "level": "warn",
                    "message": engine.notice,
                }, ensure_ascii=False))
                engine.notice = None
            await ws.send(json.dumps({
                "v": PROTOCOL, "type": "translate.result", "id": msg.get("id"),
                "texts": result,
            }, ensure_ascii=False))
        except Exception as exc:
            try:
                await ws.send(json.dumps({
                    "v": PROTOCOL, "type": "error", "id": msg.get("id"),
                    "code": "TRANSLATE_FAILED", "message": str(exc), "retryable": True,
                }, ensure_ascii=False))
            except Exception:
                pass


async def handle_download(ws, engine, msg):
    model_id = msg.get("model")
    req_id = msg.get("id")

    if engine.downloading:
        await ws.send(json.dumps({
            "v": PROTOCOL, "type": "error", "id": req_id, "code": "DOWNLOAD_BUSY",
            "message": "已有下载任务在进行: " + str(engine.downloading),
        }, ensure_ascii=False))
        return

    engine.downloading = model_id
    progress_queue = queue.Queue()
    cancel = threading.Event()
    loop = asyncio.get_running_loop()

    def progress(info):
        loop.call_soon_threadsafe(progress_queue.put, info)

    async def runner():
        try:
            meta = await asyncio.to_thread(engine.models.download, model_id, progress, cancel)
            await ws.send(json.dumps({
                "v": PROTOCOL, "type": "models.done", "id": req_id, "model": model_id, "meta": meta,
            }, ensure_ascii=False))
        except Exception as exc:
            await ws.send(json.dumps({
                "v": PROTOCOL, "type": "error", "id": req_id, "code": "DOWNLOAD_FAILED",
                "message": str(exc), "retryable": True, "model": model_id,
            }, ensure_ascii=False))
        finally:
            progress_queue.put(None)

    task = asyncio.create_task(runner())
    while True:
        try:
            info = progress_queue.get_nowait()
        except queue.Empty:
            if task.done():
                break
            await asyncio.sleep(0.15)
            continue
        if info is None:
            break
        await ws.send(json.dumps({
            "v": PROTOCOL, "type": "models.progress", **info,
        }, ensure_ascii=False))

    try:
        await task
    finally:
        engine.downloading = None


async def main_async(port):
    import websockets

    cfg = load_config()
    engine = Engine(cfg)
    print(f"[engine] BiliSub {VERSION} | 硬件档位: {engine.hardware['tier']} | "
          f"RAM {engine.hardware['ramGB']}G | VRAM {engine.hardware['vramGB']}G")
    print(f"[engine] ws://127.0.0.1:{port}  模型目录: {cfg['models_dir']}")

    async with websockets.serve(lambda ws: handle(ws, engine), "127.0.0.1", port, max_size=8 * 1024 * 1024):
        # 启动即预热实时模型，避免第一句字幕等几秒
        asyncio.get_running_loop().run_in_executor(None, engine.warmup)
        await asyncio.Future()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=None)
    parser.add_argument("--check", action="store_true", help="只打印硬件与模型状态")
    args = parser.parse_args()

    cfg = load_config()
    port = args.port or cfg.get("port", 8765)

    if args.check:
        engine = Engine(cfg)
        print(json.dumps({
            "version": VERSION,
            "hardware": engine.hardware,
            "models": engine.models.list(),
            "asrAvailable": engine._asr_available(),
        }, ensure_ascii=False, indent=2))
        return

    try:
        asyncio.run(main_async(port))
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
