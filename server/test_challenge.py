"""Tests for the Riverwalk state machine using synthetic FaceSignals (no webcam needed).

Run: python -m pytest -q
"""
import cv2
import numpy as np
import pytest

import app as server
from app import FaceSignals, RiverwalkChallenge

DT = 1 / 15  # simulate 15 fps


class Sim:
    def __init__(self):
        self.c = RiverwalkChallenge()
        self.t = 100.0
        self.events = []
        self.c.start(self.t)

    def feed(self, n=1, present=True, nose_y=0.5, blink=0.0, smile=0.0):
        for _ in range(n):
            self.t += DT
            self.events += self.c.update(FaceSignals(present, nose_y, 0.4, blink, smile), self.t)
        return self

    def idle(self, seconds):
        return self.feed(int(seconds / DT))

    def nod(self):
        for y in (0.52, 0.55, 0.56, 0.54, 0.51, 0.5):
            self.feed(nose_y=y)
        return self

    def blink(self):
        return self.feed(2, blink=0.9).feed(2)

    def smile(self):
        return self.feed(4, smile=0.9)

    @property
    def step(self):
        return self.c.snapshot(self.t)["step"]


def test_happy_path_completes():
    s = Sim().idle(0.5)
    assert s.step == "nod"
    s.idle(0.7).nod()
    assert s.step == "blink"
    s.idle(0.7).blink().idle(0.2).blink()
    assert s.step == "smile"
    s.idle(0.7).smile()
    assert s.c.status == "complete"
    assert s.events == ["complete"]
    assert all(s.c.snapshot(s.t)["checklist"].values())


def test_smiling_early_resets_sequence_and_counts_failure():
    s = Sim().idle(1.5).smile()
    assert s.events == ["failed"]
    assert s.c.failures == 1
    assert s.step == "face"


def test_nod_during_blink_step_is_wrong_action():
    s = Sim().idle(1.2).nod().idle(0.7).nod()
    assert "failed" in s.events
    assert s.step == "face"


def test_three_failures_trigger_alarm():
    s = Sim()
    for _ in range(3):
        s.idle(3.0).smile()
    assert s.c.status == "alarm"
    assert s.events.count("failed") == 3 and s.events[-1] == "alarm"


def test_losing_face_pauses_without_failure_and_freezes_timer():
    s = Sim().idle(1.2)
    left_before = s.c.snapshot(s.t)["timeLeft"]
    s.feed(int(30 / DT), present=False)  # 30s out of frame, longer than STEP_TIMEOUT_S
    assert s.c.status == "paused"
    s.feed(1)
    assert s.c.status == "active"
    assert s.c.failures == 0
    assert s.c.snapshot(s.t)["timeLeft"] >= left_before - 1.0
    assert s.step == "nod"


def test_step_timeout_counts_as_failure():
    s = Sim().idle(1.0).idle(server.STEP_TIMEOUT_S + 0.5)
    assert s.events == ["failed"]


def test_single_slow_blinks_dont_count_as_double():
    s = Sim().idle(1.2).nod().idle(0.7).blink().idle(server.DOUBLE_BLINK_WINDOW_S + 0.5)
    assert s.c.blinks == 0
    s.blink()
    assert s.step == "blink"


def test_restart_after_alarm_clears_failures():
    s = Sim()
    for _ in range(3):
        s.idle(3.0).smile()
    s.c.start(s.t)
    assert s.c.status == "active" and s.c.failures == 0


def test_nfc_payload_parsing(monkeypatch):
    assert server.parse_nfc_payload("LOOTRUN|RIVERWALK|TAG01|5000") == ("TAG01", 5000)
    for bad in ["hello", "LOOTRUN|ALAMO|T|5", "LOOTRUN|RIVERWALK|T|-5", "LOOTRUN|RIVERWALK|T|999999"]:
        with pytest.raises(ValueError):
            server.parse_nfc_payload(bad)
    monkeypatch.setattr(server, "NFC_SECRET", "s3cret")
    sig = server.sign_nfc_payload("TAG01", 5000)
    assert server.parse_nfc_payload(f"LOOTRUN|RIVERWALK|TAG01|5000|{sig}") == ("TAG01", 5000)
    with pytest.raises(ValueError):
        server.parse_nfc_payload("LOOTRUN|RIVERWALK|TAG01|5000|deadbeefdeadbeef")


def test_socket_flow_end_to_end():
    """Real Socket.IO round trip with a blank frame (no face) through the real detector."""
    client = server.socketio.test_client(server.app)
    assert client.emit("join_car", {"carId": "car42", "role": "driver"}, callback=True)["ok"]
    assert client.emit("start_challenge", callback=True)["status"] == "active"

    ok, jpg = cv2.imencode(".jpg", np.zeros((240, 320, 3), np.uint8))
    snap = client.emit("frame", jpg.tobytes(), callback=True)
    assert snap["faceVisible"] is False and snap["failures"] == 0

    assert client.emit("frame", b"not a jpeg", callback=True) == {"error": "bad frame"}

    res = client.emit("nfc_scan", {"payload": "LOOTRUN|RIVERWALK|TAG01|5000"}, callback=True)
    assert res["ok"] is False and "locked" in res["error"]

    server.get_car("car42").riverwalk_cleared = True
    res = client.emit("nfc_scan", {"payload": "LOOTRUN|RIVERWALK|TAG01|5000"}, callback=True)
    assert res == {"ok": True, "tagId": "TAG01", "amount": 5000, "loot": 5000}
    res = client.emit("nfc_scan", {"payload": "LOOTRUN|RIVERWALK|TAG01|5000"}, callback=True)
    assert res["ok"] is False and "already" in res["error"]
    client.disconnect()
