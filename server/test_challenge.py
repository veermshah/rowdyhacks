"""Tests for the Riverwalk state machine using synthetic FaceSignals (no webcam needed).

Run: python -m pytest -q
"""
import cv2
import numpy as np
import pytest

import app as server
from app import FaceSignals, RiverwalkChallenge

DT = 1 / 15  # simulate 15 fps
STEP = lambda c: c.snapshot(0)["step"]


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


def test_out_of_order_actions_are_ignored():
    s = Sim().idle(1.2)
    assert s.step == "nod"
    s.smile().blink().blink()  # wrong gestures for the "nod" step
    assert s.step == "nod" and s.c.failures == 0 and s.events == []
    s.nod().idle(0.7).nod().smile()  # extra nod / early smile during "blink"
    assert s.step == "blink" and s.c.blinks == 0 and s.c.failures == 0


def test_three_failures_trigger_alarm():
    s = Sim()
    for _ in range(3):
        s.events += s.c.simulate("fail", s.t)
    assert s.c.status == "alarm"
    assert s.events == ["failed", "failed", "failed", "alarm"]


def test_simulated_sequence_completes_and_ignores_wrong_order():
    c = RiverwalkChallenge()
    t = 0.0
    assert c.simulate("nod", t) == [] and c.step == 0  # auto-starts, nod before face ignored
    c.simulate("face", t)
    c.simulate("smile", t)  # ignored
    c.simulate("nod", t)
    c.simulate("blink", t)
    assert c.blinks == 1 and STEP(c) == "blink"
    c.simulate("blink", t)
    assert STEP(c) == "smile"
    assert c.simulate("smile", t) == ["complete"]
    assert c.failures == 0


def test_simulated_fail_resets_progress():
    c = RiverwalkChallenge()
    for a in ("face", "nod", "blink"):
        c.simulate(a, 0.0)
    assert c.simulate("fail", 0.0) == ["failed"]
    assert STEP(c) == "face" and c.blinks == 0 and c.failures == 1


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
        s.c.simulate("fail", s.t)
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


def test_completion_awards_cash_and_wanted_level():
    client = server.socketio.test_client(server.app)
    client.emit("join_car", {"carId": "car-reward"}, callback=True)
    snap = None
    for action in ("face", "smile", "nod", "blink", "blink", "smile"):
        snap = client.emit("simulate", {"action": action}, callback=True)
    assert snap["status"] == "complete"
    car = server.get_car("car-reward")
    assert (car.loot, car.wanted_level, car.riverwalk_cleared) == (server.RIVERWALK_REWARD, 1, True)
    assert server.RIVERWALK_REWARD == 5000

    # Replaying a cleared vault pays nothing more; a reset re-locks it.
    for action in ("face", "nod", "blink", "blink", "smile"):
        client.emit("simulate", {"action": action}, callback=True)
    assert (car.loot, car.wanted_level) == (5000, 1)
    assert client.emit("reset_car", callback=True) == {"ok": True}
    assert server.get_car("car-reward").loot == 0
    client.disconnect()


def test_riverwalk_complete_from_presage_server_credits_car_once():
    """The game relays a clear from the separate Presage server (?presage=...)."""
    client = server.socketio.test_client(server.app)
    client.emit("join_car", {"carId": "car-presage-relay"}, callback=True)
    res = client.emit("riverwalk_complete", callback=True)
    assert res == {"ok": True, "loot": server.RIVERWALK_REWARD, "wantedLevel": 1, "riverwalkCleared": True}
    rewards = [m for m in client.get_received() if m["name"] == "reward"]
    assert rewards and rewards[-1]["args"][0]["amount"] == server.RIVERWALK_REWARD

    # A second relay (or a replay) pays nothing more; a game restart re-locks it.
    assert client.emit("riverwalk_complete", callback=True)["loot"] == server.RIVERWALK_REWARD
    client.emit("reset_car", callback=True)
    assert client.emit("riverwalk_complete", callback=True)["loot"] == server.RIVERWALK_REWARD
    client.disconnect()


def test_riverwalk_alarm_from_presage_server_raises_wanted_level():
    client = server.socketio.test_client(server.app)
    client.emit("join_car", {"carId": "car-presage-alarm"}, callback=True)
    res = client.emit("riverwalk_alarm", {"reason": "Too slow!"}, callback=True)
    assert res == {"ok": True, "wantedLevel": 1}
    alarms = [m for m in client.get_received() if m["name"] == "alarm"]
    assert alarms and alarms[-1]["args"][0] == {"reason": "Too slow!", "wantedLevel": 1}
    client.disconnect()


def test_alarm_raises_wanted_level_via_socket():
    client = server.socketio.test_client(server.app)
    client.emit("join_car", {"carId": "car-alarm"}, callback=True)
    for _ in range(3):
        client.emit("simulate", {"action": "fail"}, callback=True)
    assert server.get_car("car-alarm").wanted_level == 1
    assert any(m["name"] == "alarm" for m in client.get_received())
    client.disconnect()
