"""Fetch vision model files into server/models/ before the backend starts.

Usage:
    python download_assets.py               # download anything missing
    python download_assets.py --force       # re-download everything
    python download_assets.py --presage     # also run Presage SmartSpectra setup

app.py calls ensure_assets() on startup, so running this by hand is optional,
but doing it in the Render build step keeps cold starts fast.
"""
import argparse
import os
import shutil
import subprocess
import sys
import tempfile
import urllib3

SERVER_DIR = os.path.dirname(os.path.abspath(__file__))
MODELS_DIR = os.path.join(SERVER_DIR, "models")
ENV_FILE = os.path.join(SERVER_DIR, ".env")

HAAR_BASE = "https://raw.githubusercontent.com/opencv/opencv/4.x/data/haarcascades"

# filename -> (url, minimum plausible size in bytes)
ASSETS = {
    "face_landmarker.task": (
        "https://storage.googleapis.com/mediapipe-models/face_landmarker/"
        "face_landmarker/float16/1/face_landmarker.task",
        1_000_000,
    ),
    # Haar cascades are the fallback path when MediaPipe can't be imported.
    "haarcascade_frontalface_alt2.xml": (f"{HAAR_BASE}/haarcascade_frontalface_alt2.xml", 100_000),
    "haarcascade_eye_tree_eyeglasses.xml": (f"{HAAR_BASE}/haarcascade_eye_tree_eyeglasses.xml", 100_000),
    "haarcascade_smile.xml": (f"{HAAR_BASE}/haarcascade_smile.xml", 100_000),
}

ENV_TEMPLATE = """\
# Presage SmartSpectra (https://smartspectra.presagetech.com) - optional
PRESAGE_API_KEY=
# Shared secret used to sign NFC loot tags (leave blank to accept unsigned tags)
NFC_SECRET=
# Comma-separated allowed origins for the React client
CORS_ORIGINS=http://localhost:5173
"""


def _download(url, dest, min_size):
    http = urllib3.PoolManager(retries=urllib3.Retry(3, backoff_factor=0.5))
    resp = http.request("GET", url, preload_content=False, timeout=urllib3.Timeout(connect=10, read=60))
    try:
        if resp.status != 200:
            raise RuntimeError(f"HTTP {resp.status} for {url}")
        # Write to a temp file first so a half-finished download never looks valid.
        fd, tmp = tempfile.mkstemp(dir=MODELS_DIR, suffix=".part")
        with os.fdopen(fd, "wb") as f:
            for chunk in resp.stream(64 * 1024):
                f.write(chunk)
    finally:
        resp.release_conn()
    size = os.path.getsize(tmp)
    if size < min_size:
        os.remove(tmp)
        raise RuntimeError(f"{url} returned only {size} bytes")
    os.replace(tmp, dest)
    return size


def ensure_assets(force=False, quiet=False):
    """Download any missing model files. Returns {filename: path} for files present."""
    os.makedirs(MODELS_DIR, exist_ok=True)
    present = {}
    for name, (url, min_size) in ASSETS.items():
        dest = os.path.join(MODELS_DIR, name)
        if not force and os.path.exists(dest) and os.path.getsize(dest) >= min_size:
            present[name] = dest
            continue
        try:
            if not quiet:
                print(f"[assets] downloading {name} ...", flush=True)
            size = _download(url, dest, min_size)
            if not quiet:
                print(f"[assets]   saved {size / 1024:.0f} KB -> {dest}")
            present[name] = dest
        except Exception as e:  # keep going: the server can run with a partial set
            print(f"[assets] WARNING could not fetch {name}: {e}", file=sys.stderr)
    return present


def setup_presage():
    """Create a .env template and install the Presage SmartSpectra agent skill if npx exists."""
    if not os.path.exists(ENV_FILE):
        with open(ENV_FILE, "w") as f:
            f.write(ENV_TEMPLATE)
        print(f"[presage] wrote {ENV_FILE} - add your PRESAGE_API_KEY there")
    else:
        print(f"[presage] {ENV_FILE} already exists, leaving it alone")

    npx = shutil.which("npx")
    if not npx:
        print("[presage] npx not found; skipping `npx skills add Presage-Security/SmartSpectra`")
        return
    print("[presage] running: npx skills add Presage-Security/SmartSpectra")
    result = subprocess.run([npx, "--yes", "skills", "add", "Presage-Security/SmartSpectra"], cwd=SERVER_DIR)
    if result.returncode != 0:
        print("[presage] WARNING skill install failed (non-fatal)", file=sys.stderr)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--force", action="store_true", help="re-download even if files exist")
    parser.add_argument("--presage", action="store_true", help="also set up Presage SmartSpectra")
    args = parser.parse_args()

    present = ensure_assets(force=args.force)
    if args.presage:
        setup_presage()

    missing = set(ASSETS) - set(present)
    if "face_landmarker.task" in missing and "haarcascade_frontalface_alt2.xml" in missing:
        print("[assets] ERROR no face model available; the challenge cannot run", file=sys.stderr)
        sys.exit(1)
    print(f"[assets] ready ({len(present)}/{len(ASSETS)} files)")


if __name__ == "__main__":
    main()
