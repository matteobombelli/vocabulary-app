"""Where the pipeline reads downloads from and writes outputs to (all under data/, gitignored)."""

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
DOWNLOADS = DATA / "downloads"
SEED = DATA / "seed"


def lang_dir(lang: str) -> Path:
    d = DATA / lang
    d.mkdir(parents=True, exist_ok=True)
    return d
