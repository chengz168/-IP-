"""Shared stdlib-only configuration for the local TTS launcher."""
from __future__ import annotations

import json
import os
from pathlib import Path
import tempfile
import urllib.request

UPSTREAM_URL = "https://github.com/index-tts/index-tts.git"
UPSTREAM_REVISION = "d9e41aac89fd00b3d71497fddb287b7f24613712"
MODEL_ID = "IndexTeam/IndexTTS-2.5"
ENDPOINTS = {"hf": "https://huggingface.co", "hf-mirror": "https://hf-mirror.com"}
SCRIPTS = Path(__file__).resolve().parent


def read_json(path: Path, default=None):
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8-sig"))


def default_home() -> Path:
    """Resolve persistent storage independently of the chat's working directory."""
    if os.environ.get("INDEXTTS_HOME"):
        return Path(os.environ["INDEXTTS_HOME"]).expanduser()
    for name in ("runtime.json", "installation.json"):
        config = read_json(SCRIPTS.parent / name, {})
        if config.get("runtimeHome"):
            return Path(config["runtimeHome"]).expanduser()
    if os.name == "nt":
        base = Path(os.environ.get("LOCALAPPDATA") or Path.home() / "AppData/Local")
    else:
        base = Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local/share")
    return base / "indextts-local"


def write_json(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=path.name + ".", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(value, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def runtime_python(home: Path) -> Path:
    return home / "upstream" / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")


def models(home: Path) -> Path:
    return home / "upstream" / "checkpoints"


def environment(home: Path, source: str | None = None) -> dict[str, str]:
    selected = source or read_json(home / "settings.json", {}).get("source", "hf-mirror")
    env = os.environ.copy()
    # Git and uv do not consistently inherit the Windows Internet Settings proxy.
    # Reuse it only when the user has not supplied an explicit process proxy.
    if os.name == "nt" and not any(env.get(key) for key in ("HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy")):
        proxies = urllib.request.getproxies()
        for scheme in ("http", "https"):
            if proxies.get(scheme):
                env[scheme.upper() + "_PROXY"] = proxies[scheme]
    env.update({
        "HF_ENDPOINT": ENDPOINTS[selected],
        "HF_HOME": str(home / "cache" / "huggingface"),
        "HF_HUB_CACHE": str(models(home) / "hf_cache"),
        "HF_HUB_DISABLE_XET": "1",
        "HF_HUB_DOWNLOAD_TIMEOUT": "120",
        "HF_HUB_ETAG_TIMEOUT": "30",
        "UV_CACHE_DIR": str(home / "cache" / "uv"),
        "UV_PYTHON_INSTALL_DIR": str(home / "python"),
        "UV_LINK_MODE": "copy",
        "NLTK_DATA": str(home / "cache" / "nltk"),
        "XDG_CACHE_HOME": str(home / "cache"),
        "PYTHONUTF8": "1",
        "PYTHONIOENCODING": "utf-8",
        "PYTHONPATH": str(home / "upstream"),
        "GIT_LFS_SKIP_SMUDGE": "1",
        "GIT_HTTP_LOW_SPEED_LIMIT": "1024",
        "GIT_HTTP_LOW_SPEED_TIME": "60",
    })
    return env


MODEL_MANIFEST = read_json(SCRIPTS.parent / "model-manifest.json")
REQUIRED_MODELS = tuple(MODEL_MANIFEST["required"])


def missing_models(home: Path) -> list[str]:
    root = models(home)
    missing = [name for name in REQUIRED_MODELS if not (root / name).is_file() or (root / name).stat().st_size == 0]
    for alternative in MODEL_MANIFEST["alternatives"]:
        if not any((root / name).is_file() and (root / name).stat().st_size > 0
                   for name in alternative["files"]):
            missing.append(alternative["label"])
    receipt = home / MODEL_MANIFEST["receipt"]
    if not receipt.is_file() or receipt.stat().st_size == 0:
        missing.append(MODEL_MANIFEST["receipt"] + " (download completion record)")
    return missing
