"""Loot Run - Riverwalk Heist Challenge server (Flask + Flask-SocketIO).

The driver's browser streams small JPEG webcam frames over Socket.IO. Each frame
is run through a face detector (MediaPipe Face Landmarker, or OpenCV Haar
cascades as a fallback), turned into a handful of signals (face present, nose
height, blink score, smile score), and fed into a per-player state machine:

    face detected -> nod -> blink twice -> smile -> vault open ($)

Run locally:   python app.py
Run on Render: gunicorn -k gthread -w 1 --threads 8 -b 0.0.0.0:$PORT app:app
(gthread, not eventlet - gunicorn deleted its eventlet worker in 26.0, so
this falls back to Flask-SocketIO's "threading" async_mode, same as local
dev; one worker only: game state lives in memory)
"""
import base64
import hashlib
import hmac
import os
import sys
import threading
import time
from dataclasses import dataclass, field

import cv2
import numpy as np
from flask import Flask, jsonify, request
from flask_cors import CORS
from flask_socketio import SocketIO, emit, join_room

from alamo_challenge import AlamoChallenge
from download_assets import MODELS_DIR, ensure_assets

try:
    from dotenv import load_dotenv

    load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))
except ImportError:
    pass

try:
    import mediapipe as mp
    from mediapipe.tasks.python import BaseOptions
    from mediapipe.tasks.python import vision as mp_vision
except Exception:  # missing wheel for this Python version, etc.
    mp = None

# --------------------------------------------------------------------------- #
# Tunables
# --------------------------------------------------------------------------- #
RIVERWALK_REWARD = 5_000
MAX_ATTEMPTS = 3
MAX_WANTED_LEVEL = 5
STEP_TIMEOUT_S = 20.0           # per step; only live frames tick it, dev buttons never time out
FACE_CONFIRM_FRAMES = 5         # consecutive frames with a face before "face detected" ticks
FACE_LOST_GRACE_S = 0.4         # how long without a face before we pause
FRAME_GAP_PAUSE_S = 1.0         # no frames for this long (tab hidden, camera off) = paused time
FAIL_COOLDOWN_S = 1.5           # ignore everything right after a failure

NOD_DELTA = 0.07                # nose must move this many face-heights away from baseline...
NOD_RETURN = 0.03               # ...then come back within this many...
NOD_MAX_S = 1.5                 # ...within this many seconds
NOD_BASELINE_ALPHA = 0.1        # how fast the resting position follows slow drift

BLINK_CLOSED = 0.45             # blink score above this = eyes closed
BLINK_OPEN = 0.25               # below this = eyes open again (hysteresis)
BLINK_MAX_CLOSED_S = 0.8        # longer than this is "eyes shut", not a blink
DOUBLE_BLINK_WINDOW_S = 3.0     # both blinks must land within this window

SMILE_THRESHOLD = 0.6
SMILE_FRAMES = 3

MAX_FRAME_BYTES = 512 * 1024
NFC_MAX_AMOUNT = 10_000
NFC_SECRET = os.environ.get("NFC_SECRET", "")
PRESAGE_API_KEY = os.environ.get("PRESAGE_API_KEY", "")
# Enables the simulate socket event (and Alamo's admin/sim events further down).
# Set RIVERWALK_DEV_MODE=0 in production. reset_car is NOT gated by this - it's
# core gameplay (every player restart), not a dev-only tool.
DEV_MODE = os.environ.get("RIVERWALK_DEV_MODE", "1") != "0"

STEPS = ["face", "nod", "blink", "smile"]
# Prompts echo the clue: "Acknowledge the guard, signal twice, and look pleased."
PROMPTS = {
    "face": "Face the guard's camera.",
    "nod": "Acknowledge the guard.",
    "blink": "Signal twice.",
    "smile": "Look pleased.",
}


# --------------------------------------------------------------------------- #
# Vision: frame -> FaceSignals
# --------------------------------------------------------------------------- #
@dataclass
class FaceSignals:
    present: bool
    nose_y: float = 0.0   # normalized image y (0 top, 1 bottom)
    face_h: float = 0.0   # normalized face height, used to scale nod deltas
    blink: float = 0.0    # 0 open .. 1 closed
    smile: float = 0.0    # 0 neutral .. 1 big smile


class MediaPipeDetector:
    name = "mediapipe"

    def __init__(self, model_path):
        options = mp_vision.FaceLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=model_path),
            running_mode=mp_vision.RunningMode.VIDEO,
            num_faces=1,
            output_face_blendshapes=True,
        )
        self._landmarker = mp_vision.FaceLandmarker.create_from_options(options)
        self._last_ts = 0

    def detect(self, bgr):
        # VIDEO mode requires strictly increasing timestamps.
        ts = max(int(time.monotonic() * 1000), self._last_ts + 1)
        self._last_ts = ts
        image = mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB))
        result = self._landmarker.detect_for_video(image, ts)
        if not result.face_landmarks:
            return FaceSignals(False)
        lm = result.face_landmarks[0]
        scores = {c.category_name: c.score for c in result.face_blendshapes[0]}
        return FaceSignals(
            present=True,
            nose_y=lm[1].y,                       # 1 = nose tip
            face_h=abs(lm[152].y - lm[10].y),     # 10 = forehead, 152 = chin
            blink=(scores.get("eyeBlinkLeft", 0) + scores.get("eyeBlinkRight", 0)) / 2,
            smile=(scores.get("mouthSmileLeft", 0) + scores.get("mouthSmileRight", 0)) / 2,
        )

    def close(self):
        self._landmarker.close()


class HaarDetector:
    """Fallback when MediaPipe isn't available. Coarser: blink/smile are 0 or 1."""

    name = "haar"

    def __init__(self, models):
        self._face = cv2.CascadeClassifier(models["haarcascade_frontalface_alt2.xml"])
        eye_path = models.get("haarcascade_eye_tree_eyeglasses.xml")
        smile_path = models.get("haarcascade_smile.xml")
        self._eye = cv2.CascadeClassifier(eye_path) if eye_path else None
        self._smile = cv2.CascadeClassifier(smile_path) if smile_path else None

    def detect(self, bgr):
        gray = cv2.equalizeHist(cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY))
        img_h = gray.shape[0]
        faces = self._face.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(60, 60))
        if len(faces) == 0:
            return FaceSignals(False)
        x, y, w, h = max(faces, key=lambda f: f[2] * f[3])
        blink = smile = 0.0
        if self._eye is not None:
            upper = gray[y : y + h // 2, x : x + w]
            eyes = self._eye.detectMultiScale(upper, 1.1, 4, minSize=(w // 10, w // 10))
            blink = 1.0 if len(eyes) == 0 else 0.0
        if self._smile is not None:
            lower = gray[y + h // 2 : y + h, x : x + w]
            smiles = self._smile.detectMultiScale(lower, 1.7, 22, minSize=(w // 4, h // 10))
            smile = 1.0 if len(smiles) else 0.0
        return FaceSignals(True, nose_y=(y + 0.55 * h) / img_h, face_h=h / img_h, blink=blink, smile=smile)

    def close(self):
        pass


MODELS = ensure_assets(quiet=True)


def make_detector():
    if mp is not None and "face_landmarker.task" in MODELS:
        return MediaPipeDetector(MODELS["face_landmarker.task"])
    if "haarcascade_frontalface_alt2.xml" in MODELS:
        return HaarDetector(MODELS)
    raise RuntimeError(f"No face model in {MODELS_DIR}; run `python download_assets.py`")


def decode_frame(data):
    """Accept raw JPEG bytes, a base64 string, or a data: URL. Returns a BGR image or None."""
    if isinstance(data, dict):
        data = data.get("image")
    if isinstance(data, str):
        if data.startswith("data:"):
            data = data.split(",", 1)[-1]
        try:
            data = base64.b64decode(data)
        except ValueError:
            return None
    if not isinstance(data, (bytes, bytearray)) or not data or len(data) > MAX_FRAME_BYTES:
        return None
    return cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)


# --------------------------------------------------------------------------- #
# Gesture trackers: FaceSignals over time -> discrete events
# --------------------------------------------------------------------------- #
class NodTracker:
    """Nod = nose leaves its resting height by NOD_DELTA face-heights and returns quickly."""

    def __init__(self):
        self.reset()

    def reset(self):
        self.baseline = None
        self.moving_since = None
        self.delta = 0.0

    def update(self, nose_y, face_h, now):
        if self.baseline is None:
            self.baseline = nose_y
            return False
        self.delta = (nose_y - self.baseline) / max(face_h, 1e-3)

        if self.moving_since is None:
            if abs(self.delta) > NOD_DELTA:
                self.moving_since = now
            else:
                self.baseline += NOD_BASELINE_ALPHA * (nose_y - self.baseline)
            return False

        if abs(self.delta) < NOD_RETURN:
            quick = now - self.moving_since <= NOD_MAX_S
            self.moving_since = None
            return quick
        if now - self.moving_since > NOD_MAX_S:
            # Head moved and stayed there (leaned, shifted seat): adopt it as the new rest.
            self.moving_since = None
            self.baseline = nose_y
        return False


class BlinkTracker:
    """Blink = eyes go closed then open again within BLINK_MAX_CLOSED_S."""

    def __init__(self):
        self.reset()

    def reset(self):
        self.closed_since = None

    def update(self, score, now):
        if self.closed_since is None:
            if score > BLINK_CLOSED:
                self.closed_since = now
            return False
        if score < BLINK_OPEN:
            blinked = now - self.closed_since <= BLINK_MAX_CLOSED_S
            self.closed_since = None
            return blinked
        return False


class SmileTracker:
    def __init__(self):
        self.reset()

    def reset(self):
        self.frames = 0

    def update(self, score):
        self.frames = self.frames + 1 if score >= SMILE_THRESHOLD else 0
        return self.frames >= SMILE_FRAMES


# --------------------------------------------------------------------------- #
# Challenge state machine
# --------------------------------------------------------------------------- #
class RiverwalkChallenge:
    """status: idle | active | paused | alarm | complete

    Rules:
      * Steps must happen in order: face -> nod -> blink x2 -> smile.
      * Out-of-order actions (e.g. smiling while the step is "nod") are ignored:
        no progress, no failure, no reset.
      * A failed attempt is running out the step timer (live camera only) or a
        dev "fail" input. Each failure resets the sequence; MAX_ATTEMPTS failures
        trip the alarm.

    update()/simulate() return event names ("failed", "alarm", "complete") so the
    socket layer can apply side effects (wanted level, loot) to the shared car.
    """

    def __init__(self):
        self.status = "idle"
        self.failures = 0
        self._reset_sequence()
        self.message = "Pull up to the Riverwalk checkpoint and press Start."
        self.last_fail_reason = None
        self._last_update = None
        self._last_signals = FaceSignals(False)

    def _reset_sequence(self):
        self.step = 0
        self.blinks = 0
        self.first_blink_at = None
        self.face_frames = 0
        self.lost_since = None
        self.paused_at = None
        self.deadline = float("inf")
        self.cooldown_until = 0.0
        self.nod = NodTracker()
        self.blink = BlinkTracker()
        self.smile = SmileTracker()

    def start(self, now):
        if self.status == "alarm":
            self.failures = 0  # cops already called; give them a fresh set of tries
        self.status = "active"
        self._reset_sequence()
        self._enter_step(0, now)

    def _enter_step(self, step, now):
        self.step = step
        self.deadline = now + STEP_TIMEOUT_S
        name = STEPS[step]
        if name == "nod":
            self.nod.reset()
        elif name == "blink":
            self.blink.reset()
            self.blinks = 0
            self.first_blink_at = None
        elif name == "smile":
            self.smile.reset()
        self.message = PROMPTS[name]

    def _fail(self, reason, now):
        self.failures += 1
        self.last_fail_reason = reason
        if self.failures >= MAX_ATTEMPTS:
            self.status = "alarm"
            self.message = f"ALARM! {reason} Security is on the way."
            return ["failed", "alarm"]
        left = MAX_ATTEMPTS - self.failures
        self._reset_sequence()
        self._enter_step(0, now)
        self.cooldown_until = now + FAIL_COOLDOWN_S
        self.message = f"{reason} Sequence reset - {left} attempt{'s' if left != 1 else ''} left."
        return ["failed"]

    def _complete(self):
        self.status = "complete"
        self.step = len(STEPS)
        self.message = "Vault open! Riverwalk cash secured."
        return ["complete"]

    def _register_blink(self, now):
        self.blinks += 1
        if self.blinks == 1:
            self.first_blink_at = now
            self.message = "One more..."
        else:
            self._enter_step(3, now)

    def _resume(self, now):
        self.status = "active"
        if self.paused_at is not None:
            self.deadline += now - self.paused_at
        self.paused_at = None
        self.lost_since = None
        self.nod.reset()  # the head moved; re-learn its resting position
        self.blink.reset()
        self.smile.reset()

    def update(self, sig, now):
        """Advance the sequence from one live camera frame."""
        self._last_signals = sig
        if self.status not in ("active", "paused"):
            return []

        # Frames stopped arriving (tab hidden, camera unplugged): don't burn the timer.
        # (While paused, _resume() already credits the lost time.)
        if self.status == "active" and self._last_update is not None and now - self._last_update > FRAME_GAP_PAUSE_S:
            gap = now - self._last_update
            self.deadline += gap
            self.cooldown_until += gap
        self._last_update = now

        if not sig.present:
            self.face_frames = 0
            if self.lost_since is None:
                self.lost_since = now
            if self.status == "active" and now - self.lost_since > FACE_LOST_GRACE_S:
                self.status = "paused"
                self.paused_at = self.lost_since
                self.message = "Lost tracking - get back in frame. Progress paused."
            return []

        self.lost_since = None
        if self.status == "paused":
            self._resume(now)
            self.message = "Tracking restored. " + PROMPTS[STEPS[self.step]]

        # Trackers run every frame so a gesture already in motion isn't lost at a
        # step boundary; only the gesture matching the current step is acted on.
        nodded = self.nod.update(sig.nose_y, sig.face_h, now)
        blinked = self.blink.update(sig.blink, now)
        smiling = self.smile.update(sig.smile)

        if now < self.cooldown_until:
            return []
        step = STEPS[self.step]
        if step != "face" and now > self.deadline:
            return self._fail("Too slow - the guard got suspicious!", now)

        if step == "face":
            self.face_frames += 1
            if self.face_frames >= FACE_CONFIRM_FRAMES:
                self._enter_step(1, now)
        elif step == "nod" and nodded:
            self._enter_step(2, now)
        elif step == "blink":
            if self.first_blink_at is not None and now - self.first_blink_at > DOUBLE_BLINK_WINDOW_S:
                self.blinks = 0
                self.first_blink_at = None
                self.message = "Too slow between signals - do both quickly."
            if blinked:
                self._register_blink(now)
        elif step == "smile" and smiling:
            return self._complete()
        return []

    def simulate(self, action, now):
        """Dev input: one of face | nod | blink | smile | fail. Same rules as live input."""
        if self.status in ("idle", "complete"):
            self.start(now)
        if self.status == "alarm":
            return []
        if self.status == "paused":
            self._resume(now)
        if action == "fail":
            return self._fail("Wrong signal!", now)

        step = STEPS[self.step]
        if action != step:
            return []  # out of order: ignored
        if step == "face":
            self._enter_step(1, now)
        elif step == "nod":
            self._enter_step(2, now)
        elif step == "blink":
            self._register_blink(now)
        elif step == "smile":
            return self._complete()
        return []

    def snapshot(self, now):
        if self.status == "paused" and self.paused_at is not None:
            time_left = self.deadline - self.paused_at
        elif self.status == "active":
            time_left = self.deadline - now
        else:
            time_left = None
        if time_left is not None:
            time_left = None if time_left == float("inf") else round(max(0.0, time_left), 1)
        sig = self._last_signals
        return {
            "status": self.status,
            "step": STEPS[self.step] if self.step < len(STEPS) else "done",
            "checklist": {name: self.step > i for i, name in enumerate(STEPS)},
            "faceVisible": sig.present,
            "blinks": self.blinks,
            "failures": self.failures,
            "maxAttempts": MAX_ATTEMPTS,
            "timeLeft": time_left,
            "stepTimeout": STEP_TIMEOUT_S,
            "message": self.message,
            "lastFailReason": self.last_fail_reason,
            "debug": {
                "blink": round(sig.blink, 2),
                "smile": round(sig.smile, 2),
                "nodDelta": round(self.nod.delta, 3),
            },
        }


# --------------------------------------------------------------------------- #
# Shared car state (loot pool + wanted level) and NFC tags
# --------------------------------------------------------------------------- #
@dataclass
class CarState:
    loot: int = 0
    wanted_level: int = 0
    riverwalk_cleared: bool = False
    alamo_cleared: bool = False
    alamo_code: str = None   # the Alamo vault's 4-digit code, set once on ALAMO_DONE
    claimed_tags: set = field(default_factory=set)

    def to_dict(self, car_id):
        return {"carId": car_id, "loot": self.loot, "wantedLevel": self.wanted_level,
                "riverwalkCleared": self.riverwalk_cleared,
                "alamoCleared": self.alamo_cleared, "alamoCode": self.alamo_code}


def sign_nfc_payload(tag_id, amount):
    msg = f"LOOTRUN|RIVERWALK|{tag_id}|{amount}".encode()
    return hmac.new(NFC_SECRET.encode(), msg, hashlib.sha256).hexdigest()[:16]


def parse_nfc_payload(raw):
    """LOOTRUN|RIVERWALK|<tagId>|<amount>[|<sig>] -> (tag_id, amount). Raises ValueError."""
    parts = str(raw or "").strip().split("|")
    if len(parts) not in (4, 5) or parts[0] != "LOOTRUN" or parts[1] != "RIVERWALK":
        raise ValueError("Not a Riverwalk loot tag.")
    tag_id, amount_str = parts[2], parts[3]
    if not tag_id.isalnum() or len(tag_id) > 32:
        raise ValueError("Bad tag id.")
    try:
        amount = int(amount_str)
    except ValueError:
        raise ValueError("Bad amount.") from None
    if not 0 < amount <= NFC_MAX_AMOUNT:
        raise ValueError("Amount out of range.")
    if NFC_SECRET:
        sig = parts[4] if len(parts) == 5 else ""
        if not hmac.compare_digest(sig, sign_nfc_payload(tag_id, amount)):
            raise ValueError("Tag signature invalid - counterfeit loot!")
    return tag_id, amount


# --------------------------------------------------------------------------- #
# Flask / Socket.IO
# --------------------------------------------------------------------------- #
def _pick_async_mode():
    forced = os.environ.get("SOCKETIO_ASYNC_MODE")
    if forced:
        return forced
    # gunicorn's eventlet worker monkey-patches before importing us.
    if "eventlet" in sys.modules:
        from eventlet import patcher

        if patcher.is_monkey_patched("socket"):
            return "eventlet"
    return "threading"


CORS_ORIGINS = [o.strip() for o in os.environ.get("CORS_ORIGINS", "*").split(",") if o.strip()]
if CORS_ORIGINS == ["*"]:
    CORS_ORIGINS = "*"

app = Flask(__name__)
CORS(app, origins=CORS_ORIGINS)
socketio = SocketIO(
    app,
    cors_allowed_origins=CORS_ORIGINS,
    async_mode=_pick_async_mode(),
    max_http_buffer_size=MAX_FRAME_BYTES * 2,
)


def _run_blocking(fn, *args):
    """Run CPU-heavy vision work off the event loop when using eventlet."""
    if socketio.async_mode == "eventlet":
        from eventlet import tpool

        return tpool.execute(fn, *args)
    return fn(*args)


def _sleep(seconds):
    """time.sleep blocks eventlet's whole worker thread; eventlet.sleep yields instead."""
    if socketio.async_mode == "eventlet":
        import eventlet

        eventlet.sleep(seconds)
    else:
        time.sleep(seconds)


class Session:
    def __init__(self, car_id, role):
        self.car_id = car_id
        self.role = role
        self.challenge = RiverwalkChallenge()
        self.detector = None
        self.lock = threading.Lock()


cars = {}
sessions = {}
state_lock = threading.Lock()

# One AlamoChallenge per car (shared by that car's Pi, driver and hacker
# clients), unlike RiverwalkChallenge which is per-session (each browser tab
# runs its own face check).
alamo_challenges = {}
_alamo_loop_started = False


def get_car(car_id):
    with state_lock:
        return cars.setdefault(car_id, CarState())


def get_alamo(car_id):
    global _alamo_loop_started
    with state_lock:
        ch = alamo_challenges.setdefault(car_id, AlamoChallenge())
        if not _alamo_loop_started:
            _alamo_loop_started = True
            # daemon=True: a plain test run (or REPL) must be able to exit even
            # though this loop never returns on its own.
            threading.Thread(target=_alamo_tick_loop, daemon=True).start()
    return ch


def broadcast_car(car_id):
    socketio.emit("car_state", get_car(car_id).to_dict(car_id), to=f"car:{car_id}")


def _apply_alamo_events(car_id, events, ch):
    """Side effects of Alamo events on the shared car (both players see them).
    Takes the already-looked-up `ch` rather than calling get_alamo() again here -
    that would try to re-acquire state_lock while the "done" branch below is
    still holding it, which deadlocks (threading.Lock isn't reentrant).

    Alamo mistakes (wrong move/spotted/wrong code) deliberately do NOT raise
    the car's wanted_level - the Alamo challenge has no heat/difficulty tie-in
    by design, unlike Riverwalk's alarm."""
    car = get_car(car_id)
    if "done" in events:
        with state_lock:
            first = not car.alamo_cleared
            car.alamo_cleared = True
            if first:
                car.alamo_code = ch.correct_code
        broadcast_car(car_id)


_alamo_last_snapshot = {}  # car_id -> last emitted general snapshot, to dedupe the 10Hz tick loop


def _flush_alamo(car_id, ch):
    """Sends queued Pi commands and pushes fresh state to the car/hacker rooms.

    The tick loop below calls this ~10x/sec for every active car so the sensor
    hold timers and LCD/hint cycling keep advancing - but most of those ticks
    change nothing (idle waiting for a move, steady light reading, etc.), and
    broadcasting the full snapshot anyway was forcing a React re-render on
    every connected browser 10x/sec, which is visible as UI jank/"glitching"
    fighting the driving game's render loop for the main thread. Only emit
    when the general snapshot actually differs from the last one sent (or
    there are Pi commands to deliver, which always accompany a real change).
    """
    now = time.monotonic()
    cmds = ch.pop_cmds()
    for cmd in cmds:
        socketio.emit("cmd", cmd, to=f"car:{car_id}:pi")
    snap = ch.snapshot(now)
    if cmds or snap != _alamo_last_snapshot.get(car_id):
        _alamo_last_snapshot[car_id] = snap
        socketio.emit("alamo_state", snap, to=f"car:{car_id}")
        socketio.emit("alamo_state", ch.snapshot(now, include_hacker=True), to=f"car:{car_id}:hacker")


def _alamo_tick_loop():
    """Server-side timers: light-sensor hold windows and the hint/LCD cycle keep
    advancing even when the Pi isn't sending new readings."""
    while True:
        with state_lock:
            car_ids = list(alamo_challenges.keys())
        for car_id in car_ids:
            ch = alamo_challenges[car_id]
            if not ch.active:
                continue
            events = ch.tick(time.monotonic())
            _apply_alamo_events(car_id, events, ch)
            _flush_alamo(car_id, ch)
        _sleep(0.1)


def _session():
    s = sessions.get(request.sid)
    if s is None:
        s = sessions[request.sid] = Session("solo", "driver")
        join_room("car:solo")
    return s


def detector_name():
    return "mediapipe" if (mp is not None and "face_landmarker.task" in MODELS) else "haar"


@app.get("/health")
def health():
    return jsonify(
        ok=True,
        detector=detector_name(),
        models=sorted(MODELS),
        presageConfigured=bool(PRESAGE_API_KEY),
        devMode=DEV_MODE,
        asyncMode=socketio.async_mode,
    )


@app.get("/api/car/<car_id>")
def car_info(car_id):
    return jsonify(get_car(car_id).to_dict(car_id))


@socketio.on("connect")
def on_connect():
    sessions[request.sid] = Session("solo", "driver")
    join_room("car:solo")


@socketio.on("disconnect")
def on_disconnect(*_):
    s = sessions.pop(request.sid, None)
    if s and s.detector:
        with s.lock:
            s.detector.close()


@socketio.on("join_car")
def on_join_car(data):
    car_id = str((data or {}).get("carId") or "solo")[:40]
    role = (data or {}).get("role", "driver")
    s = _session()
    s.car_id, s.role = car_id, role
    join_room(f"car:{car_id}")
    # The vault's "cmd" stream only goes to the Pi room. Solo play has no
    # separate hacker device, so the one browser (role "driver" or "hacker")
    # doubles as the hacker dashboard and gets the full route/hints; only the
    # hardware relay ("pi") is kept out of that room.
    is_hacker = role != "pi"
    if role == "pi":
        join_room(f"car:{car_id}:pi")
    if is_hacker:
        join_room(f"car:{car_id}:hacker")
    emit("car_state", get_car(car_id).to_dict(car_id))
    now = time.monotonic()
    ch = get_alamo(car_id)
    emit("alamo_state", ch.snapshot(now, include_hacker=is_hacker))
    return {"ok": True}


# --------------------------------------------------------------------------- #
# Alamo challenge: Raspberry Pi hardware relay + hacker dashboard
# --------------------------------------------------------------------------- #
@socketio.on("input")
def on_input(data):
    """Raspberry Pi relay: {"device": "joystick"|"light", "value": ...}.

    This is the fixed Pi wire protocol; AlamoChallenge itself ignores input
    whenever no run is active, so this handler doesn't need to gate on substage.
    """
    s = _session()
    device = (data or {}).get("device")
    value = (data or {}).get("value")
    if device not in ("joystick", "light"):
        return {"error": f"unknown device {device!r}"}
    ch = get_alamo(s.car_id)
    events = ch.handle_input(device, value, time.monotonic())
    _apply_alamo_events(s.car_id, events, ch)
    _flush_alamo(s.car_id, ch)
    return {"ok": True}


@socketio.on("alamo_start")
def on_alamo_start(*_):
    """Call when the crew reaches Challenge 1. A no-op if a run is already
    active, so a client reconnecting/rejoining can't wipe live progress -
    use alamo_admin_reset to force a fresh run."""
    s = _session()
    ch = get_alamo(s.car_id)
    if not ch.active:
        ch.start(time.monotonic())
    _flush_alamo(s.car_id, ch)
    return {"ok": True}


@socketio.on("alamo_submit_code")
def on_alamo_submit_code(data):
    """Hacker's code-entry keypad (NOT the Pi protocol - the 4-digit code is
    typed on the website). {"code": "1234"}. The server is the only validator;
    the correct code is never sent to any non-admin client."""
    s = _session()
    code = (data or {}).get("code") if isinstance(data, dict) else data
    ch = get_alamo(s.car_id)
    events, correct = ch.submit_code(code, time.monotonic())
    _apply_alamo_events(s.car_id, events, ch)
    _flush_alamo(s.car_id, ch)
    return {"ok": True, "correct": correct}


@socketio.on("alamo_admin_skip")
def on_alamo_admin_skip(*_):
    """Dev: jump straight to ALAMO_DONE."""
    if not DEV_MODE:
        return {"error": "dev mode disabled"}
    s = _session()
    ch = get_alamo(s.car_id)
    events = ch.skip(time.monotonic())
    _apply_alamo_events(s.car_id, events, ch)
    _flush_alamo(s.car_id, ch)
    return {"ok": True}


@socketio.on("alamo_admin_reset")
def on_alamo_admin_reset(*_):
    """Dev: restart the Alamo run with fresh sequences and a fresh code."""
    if not DEV_MODE:
        return {"error": "dev mode disabled"}
    s = _session()
    ch = get_alamo(s.car_id)
    ch.reset(time.monotonic())
    _flush_alamo(s.car_id, ch)
    return {"ok": True}


@socketio.on("alamo_admin_show_sequence")
def on_alamo_admin_show_sequence(data):
    """Dev: {"show": bool} -> the current round's memory sequence as text."""
    if not DEV_MODE:
        return {"error": "dev mode disabled"}
    s = _session()
    ch = get_alamo(s.car_id)
    show = bool((data or {}).get("show"))
    sequence = ch.sequence if show and ch.active and ch.sequence else None
    return {"ok": True, "sequence": sequence}


@socketio.on("alamo_admin_show_code")
def on_alamo_admin_show_code(data):
    """Dev: {"show": bool} -> the correct 4-digit code, for the hidden admin panel."""
    if not DEV_MODE:
        return {"error": "dev mode disabled"}
    s = _session()
    ch = get_alamo(s.car_id)
    show = bool((data or {}).get("show"))
    return {"ok": True, "code": ch.correct_code if show else None}


@socketio.on("alamo_sim_input")
def on_alamo_sim_input(data):
    """Dev simulator (admin page stands in for the Pi): same shape as a real
    `input` event, so it exercises the exact same code path."""
    if not DEV_MODE:
        return {"error": "dev mode disabled"}
    return on_input(data)


@socketio.on("start_challenge")
def on_start(*_):
    s = _session()
    with s.lock:
        if s.detector is None:
            s.detector = make_detector()
        s.challenge.start(time.monotonic())
        snap = s.challenge.snapshot(time.monotonic())
    emit("challenge_state", snap)
    return snap


@socketio.on("frame")
def on_frame(data):
    """Process one webcam frame. Returns the challenge snapshot as the Socket.IO ack."""
    s = _session()
    img = decode_frame(data)
    if img is None:
        return {"error": "bad frame"}
    with s.lock:
        if s.detector is None:
            s.detector = make_detector()
        sig = _run_blocking(s.detector.detect, img)
        now = time.monotonic()
        events = s.challenge.update(sig, now)
        snap = s.challenge.snapshot(now)

    _apply_events(s, events, snap)
    return snap


def _apply_events(s, events, snap):
    """Side effects of challenge events on the shared car (both players see them)."""
    car = get_car(s.car_id)
    room = f"car:{s.car_id}"
    if "alarm" in events:
        with state_lock:
            car.wanted_level = min(MAX_WANTED_LEVEL, car.wanted_level + 1)
        socketio.emit("alarm", {"reason": snap["lastFailReason"], "wantedLevel": car.wanted_level}, to=room)
        broadcast_car(s.car_id)
    if "complete" in events:
        # Cash and heat are awarded once per car; a cleared vault stays cleared.
        with state_lock:
            first = not car.riverwalk_cleared
            car.riverwalk_cleared = True
            if first:
                car.loot += RIVERWALK_REWARD
                car.wanted_level = min(MAX_WANTED_LEVEL, car.wanted_level + 1)
        socketio.emit("reward", {"source": "riverwalk_vault", "amount": RIVERWALK_REWARD if first else 0,
                                 "loot": car.loot, "wantedLevel": car.wanted_level}, to=room)
        broadcast_car(s.car_id)


@socketio.on("simulate")
def on_simulate(data):
    """Dev buttons: {"action": "face" | "nod" | "blink" | "smile" | "fail"}."""
    if not DEV_MODE:
        return {"error": "dev mode disabled"}
    action = (data or {}).get("action") if isinstance(data, dict) else data
    if action not in (*STEPS, "fail"):
        return {"error": f"unknown action {action!r}"}
    s = _session()
    with s.lock:
        now = time.monotonic()
        events = s.challenge.simulate(action, now)
        snap = s.challenge.snapshot(now)
    _apply_events(s, events, snap)
    return snap


@socketio.on("reset_car")
def on_reset_car(*_):
    """Zeroes this car's loot/wanted level and re-locks both vaults so the
    whole heist can be replayed. Not DEV_MODE-gated: the frontend calls this
    on every player-triggered game restart (R after being caught), not just
    from a dev button - see useRiverwalkTrigger's epoch handling in
    sa-drive/src/heist/HeistLayer.jsx."""
    s = _session()
    with state_lock:
        cars[s.car_id] = CarState()
        alamo_challenges[s.car_id] = AlamoChallenge()
    with s.lock:
        s.challenge = RiverwalkChallenge()
    broadcast_car(s.car_id)
    return {"ok": True}


@socketio.on("reset_challenge")
def on_reset(*_):
    s = _session()
    with s.lock:
        s.challenge = RiverwalkChallenge()
        snap = s.challenge.snapshot(time.monotonic())
    emit("challenge_state", snap)
    return snap


@socketio.on("nfc_scan")
def on_nfc_scan(data):
    s = _session()
    car = get_car(s.car_id)
    raw = data.get("payload") if isinstance(data, dict) else data
    try:
        tag_id, amount = parse_nfc_payload(raw)
    except ValueError as e:
        return {"ok": False, "error": str(e)}
    with state_lock:
        if not car.riverwalk_cleared:
            return {"ok": False, "error": "Vault is still locked - finish the face check first."}
        if tag_id in car.claimed_tags:
            return {"ok": False, "error": "This loot was already claimed."}
        car.claimed_tags.add(tag_id)
        car.loot += amount
    socketio.emit("reward", {"source": "nfc", "tagId": tag_id, "amount": amount, "loot": car.loot},
                  to=f"car:{s.car_id}")
    broadcast_car(s.car_id)
    return {"ok": True, "tagId": tag_id, "amount": amount, "loot": car.loot}


if __name__ == "__main__":
    if len(sys.argv) >= 4 and sys.argv[1] == "make-tag":
        # python app.py make-tag <tagId> <amount>  -> text to write onto an NFC tag
        tag, amt = sys.argv[2], int(sys.argv[3])
        payload = f"LOOTRUN|RIVERWALK|{tag}|{amt}"
        print(payload + (f"|{sign_nfc_payload(tag, amt)}" if NFC_SECRET else ""))
        sys.exit(0)
    port = int(os.environ.get("PORT", 5000))
    print(f"Riverwalk server on http://localhost:{port} (async={socketio.async_mode}, detector={detector_name()})")
    socketio.run(app, host="0.0.0.0", port=port, debug=False, allow_unsafe_werkzeug=True)
