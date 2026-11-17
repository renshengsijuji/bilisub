"""硬件检测：CPU / 内存 / 显卡 / 显存 / 磁盘，并给出模型档位建议（Windows 10/11 通用）"""
import ctypes
import os
import platform
import shutil
import subprocess


class _MEMORYSTATUSEX(ctypes.Structure):
    _fields_ = [
        ("dwLength", ctypes.c_ulong),
        ("dwMemoryLoad", ctypes.c_ulong),
        ("ullTotalPhys", ctypes.c_ulonglong),
        ("ullAvailPhys", ctypes.c_ulonglong),
        ("ullTotalPageFile", ctypes.c_ulonglong),
        ("ullAvailPageFile", ctypes.c_ulonglong),
        ("ullTotalVirtual", ctypes.c_ulonglong),
        ("ullAvailVirtual", ctypes.c_ulonglong),
        ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
    ]


def total_ram_gb() -> float:
    try:
        stat = _MEMORYSTATUSEX()
        stat.dwLength = ctypes.sizeof(stat)
        ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(stat))
        return round(stat.ullTotalPhys / 1024 ** 3, 1)
    except Exception:
        return 0.0


def _run(cmd) -> str:
    try:
        out = subprocess.run(
            cmd, capture_output=True, text=True, timeout=8,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        return out.stdout or ""
    except Exception:
        return ""


def gpu_names():
    """返回去重后的显卡名（跳过虚拟显示器）"""
    text = _run(["powershell", "-NoProfile", "-Command",
                 "Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name"])
    if not text.strip():
        text = _run(["wmic", "path", "win32_VideoController", "get", "name"])
    names = []
    for line in text.splitlines():
        name = line.strip()
        if not name or name.lower() in ("name",):
            continue
        low = name.lower()
        if any(k in low for k in ("virtual", "idd", "remote", "basic display", "mumu")):
            continue
        if name not in names:
            names.append(name)
    return names


def vram_gb():
    """从注册表读显存（WMI 的 AdapterRAM 会被截断到 4GB，不能用）"""
    try:
        import winreg
    except Exception:
        return 0.0

    base = r"SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}"
    best = 0.0
    try:
        root = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, base)
    except OSError:
        return 0.0

    for i in range(8):
        try:
            key = winreg.OpenKey(root, "%04d" % i)
        except OSError:
            continue
        try:
            value, _ = winreg.QueryValueEx(key, "HardwareInformation.qwMemorySize")
            best = max(best, float(value) / 1024 ** 3)
        except OSError:
            pass
        finally:
            key.Close()
    root.Close()
    return round(best, 1)


def disk_free_gb(path: str) -> float:
    try:
        return round(shutil.disk_usage(path).free / 1024 ** 3, 1)
    except Exception:
        return 0.0


def detect(models_dir: str) -> dict:
    ram = total_ram_gb()
    vram = vram_gb()
    gpus = gpu_names()
    cores = os.cpu_count() or 4

    if vram >= 8:
        tier = "high"
    elif ram >= 16:
        tier = "standard"
    else:
        tier = "light"

    recommend = {
        "light": {"mt": "mt-opus-en-zh", "asr": "asr-whisper-tiny"},
        "standard": {"mt": "mt-opus-en-zh", "asr": "asr-whisper-small"},
        "high": {"mt": "mt-nllb-600m", "asr": "asr-whisper-small"},
    }[tier]

    return {
        "os": platform.platform(),
        "cpu": platform.processor() or platform.machine(),
        "cores": cores,
        "ramGB": ram,
        "gpus": gpus,
        "vramGB": vram,
        "diskFreeGB": disk_free_gb(models_dir),
        "tier": tier,
        "recommend": recommend,
    }
