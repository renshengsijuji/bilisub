"""模型管理：清单、下载（断点续传 / 多镜像）、校验、状态"""
import hashlib
import json
import os
import threading
import time
import urllib.error
import urllib.request

MIRRORS = [
    "https://hf-mirror.com",
    "https://huggingface.co",
]


class Cancelled(Exception):
    pass


def _http_json(url: str, timeout=15):
    req = urllib.request.Request(url, headers={"User-Agent": "BiliSub/0.1"})
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return json.loads(res.read().decode("utf-8"))


class ModelManager:
    def __init__(self, root: str, catalog: list):
        self.root = root
        self.catalog = {m["id"]: m for m in catalog}
        self.state_path = os.path.join(root, "installed.json")
        self.lock = threading.Lock()
        os.makedirs(root, exist_ok=True)
        self.state = self._load_state()

    # ---------- 状态 ----------
    def _load_state(self):
        try:
            with open(self.state_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {}

    def _save_state(self):
        tmp = self.state_path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(self.state, f, ensure_ascii=False, indent=2)
        os.replace(tmp, self.state_path)

    def path(self, model_id):
        return os.path.join(self.root, model_id)

    def is_installed(self, model_id):
        meta = self.state.get(model_id)
        if not meta:
            return False
        # 以当前清单为准：清单后续补充了文件（例如 config.json）也能发现缺失
        model = self.catalog.get(model_id)
        files = list(model["files"]) if model else list(meta.get("files", []))
        return all(os.path.exists(os.path.join(self.path(model_id), f)) for f in files)

    def list(self):
        out = []
        for m in self.catalog.values():
            out.append({
                "id": m["id"],
                "kind": m["kind"],
                "name": m["name"],
                "approxSize": m.get("approxSize", 0),
                "tier": m.get("tier", "standard"),
                "note": m.get("note", ""),
                "installed": self.is_installed(m["id"]),
                "path": self.path(m["id"]),
            })
        return out

    # ---------- 下载 ----------
    def remote_sizes(self, repo):
        """从镜像的 tree 接口拿每个文件的真实大小"""
        sizes = {}
        for base in MIRRORS:
            try:
                data = _http_json(f"{base}/api/models/{repo}/tree/main?recursive=true")
                if not isinstance(data, list):
                    continue
                for item in data:
                    if item.get("type") == "file":
                        sizes[item["path"]] = int(item.get("size") or (item.get("lfs") or {}).get("size") or 0)
                return sizes
            except Exception:
                continue
        return sizes

    def download(self, model_id, progress=None, cancel: threading.Event = None):
        """阻塞式下载，progress(dict) 回调；建议放在线程里跑"""
        model = self.catalog.get(model_id)
        if not model:
            raise KeyError("未知模型: " + model_id)

        dest = self.path(model_id)
        os.makedirs(dest, exist_ok=True)

        sizes = self.remote_sizes(model["repo"])
        files = model["files"]
        total = sum(sizes.get(f, 0) for f in files) or model.get("approxSize", 0)
        done_before = 0

        for name in files:
            target = os.path.join(dest, name)
            expected = sizes.get(name, 0)
            if os.path.exists(target) and (not expected or os.path.getsize(target) == expected):
                done_before += expected or os.path.getsize(target)
                continue

            last_error = None
            for base in MIRRORS:
                try:
                    self._fetch(base, model["repo"], name, target, expected,
                                lambda cur, exp: self._emit(progress, model_id, name, done_before + cur, total))
                    break
                except Cancelled:
                    raise
                except Exception as exc:  # 换镜像
                    last_error = exc
                    continue
            else:
                raise RuntimeError(f"下载失败 {name}: {last_error}")

            done_before += expected or os.path.getsize(target)

        meta = {
            "files": files,
            "installedAt": int(time.time()),
            "repo": model["repo"],
            "size": sum(os.path.getsize(os.path.join(dest, f)) for f in files),
        }
        with self.lock:
            self.state[model_id] = meta
            self._save_state()
        self._emit(progress, model_id, "", total, total)
        return meta

    def _emit(self, progress, model_id, file, done, total):
        if progress:
            progress({
                "model": model_id,
                "file": file,
                "done": done,
                "total": total,
                "percent": round(done * 100.0 / total, 1) if total else 0,
            })

    def _fetch(self, base, repo, name, target, expected, on_progress):
        part = target + ".part"
        pos = os.path.getsize(part) if os.path.exists(part) else 0
        url = f"{base}/{repo}/resolve/main/{name}"
        req = urllib.request.Request(url, headers={"User-Agent": "BiliSub/0.1"})
        if pos:
            req.add_header("Range", f"bytes={pos}-")

        with urllib.request.urlopen(req, timeout=60) as res:
            if res.status == 206:
                mode = "ab"
            else:
                mode = "wb"
                pos = 0
            with open(part, mode) as f:
                while True:
                    chunk = res.read(512 * 1024)
                    if not chunk:
                        break
                    f.write(chunk)
                    pos += len(chunk)
                    on_progress(pos, expected)

        if expected and os.path.getsize(part) != expected:
            raise RuntimeError(f"大小不匹配 {name}: {os.path.getsize(part)} != {expected}")
        os.replace(part, target)

    @staticmethod
    def sha256(path):
        h = hashlib.sha256()
        with open(path, "rb") as f:
            for chunk in iter(lambda: f.read(1024 * 1024), b""):
                h.update(chunk)
        return h.hexdigest()
