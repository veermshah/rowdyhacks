"""Tests for the Tower vault state machine (Challenge 3, "The Callback") using
synthetic input and direct calls for Margaret's webhook tools (no hardware, no
ElevenLabs needed). Identity checking (facts, override phrase) lives entirely
in the ElevenLabs agent, so it is deliberately not tested - or present - here.

Run: python -m pytest test_tower.py -q
"""
import json
import random
import time

import pytest

import app as server
import tower_challenge as tower
from tower_challenge import TowerChallenge, normalize_joystick
import tower_config
from tower_config import (
    MAX_OTP_ATTEMPTS, MAX_TRANSFER, OTP_DISPLAY_S, OTP_LENGTH, OTP_TTL_S,
    SUSPICION_ALARM_THRESHOLD, TOWER_REWARD, TOWER_WANTED_ON_CLEAR,
)


def new_challenge(seed=1):
    return TowerChallenge(rng=random.Random(seed))


def send_otp(ch, t):
    """Starts a call and has Margaret send the code. Returns t."""
    ch.start(t)
    assert ch.agent_send_otp(t) == ("code sent", ["code_sent"])
    return t


def start_entering(ch, t):
    """Runs a call up to the point the joystick entry starts. Returns the new time."""
    send_otp(ch, t)
    t += OTP_DISPLAY_S + 0.1
    ch.tick(t)
    assert ch.status == "entering"
    return t


def key_in(ch, code, t):
    """Keys `code` in on the joystick (up from 0 at each position) without submitting."""
    for pos, digit in enumerate(code):
        for _ in range(int(digit)):
            ch.handle_input("joystick", "up", t)
        if pos < len(code) - 1:
            ch.handle_input("joystick", "right", t)


def submit(ch, t):
    """Submits the way the vault does: right off the last digit (key_in leaves the cursor there)."""
    assert ch.cursor == OTP_LENGTH - 1
    return ch.handle_input("joystick", "right", t)


# --------------------------------------------------------------------------- #
# Happy path
# --------------------------------------------------------------------------- #
def test_full_happy_path_verify_send_enter_done():
    ch = new_challenge()
    ch.start(0.0)
    assert ch.status == "ringing"
    assert ch.agent_check_otp(1.0) == "OTP NOT SENT"

    result, events = ch.agent_send_otp(2.0)
    assert result == "code sent" and events == ["code_sent"] and ch.status == "code"
    assert ch.otp is not None and ch.otp not in result

    t = 2.0 + OTP_DISPLAY_S + 0.1
    ch.tick(t)
    assert ch.status == "entering"

    key_in(ch, ch.otp, t)
    events = submit(ch, t)
    assert events == ["done"] and ch.status == "done" and ch.verified
    assert ch.verified_code is not None and len(ch.verified_code) == OTP_LENGTH
    assert {"type": "servo", "state": "open"} in ch.pop_cmds()


def test_approve_transfer_after_verified_is_capped():
    ch = new_challenge()
    t = start_entering(ch, 0.0)
    key_in(ch, ch.otp, t)
    submit(ch, t)
    assert ch.agent_approve_transfer(TOWER_REWARD, t) == (True, f"approved {TOWER_REWARD}", TOWER_REWARD)
    ok, _, amount = ch.agent_approve_transfer(MAX_TRANSFER * 10, t)
    assert ok and amount == MAX_TRANSFER
    assert ch.agent_approve_transfer("junk", t)[2] == 0


# --------------------------------------------------------------------------- #
# Margaret can't skip the check
# --------------------------------------------------------------------------- #
def test_approve_transfer_refused_before_the_code_is_entered():
    ch = new_challenge()
    ch.start(0.0)
    assert ch.agent_approve_transfer(5000, 0.0) == (False, "not verified", 0)
    ch.agent_send_otp(2.0)
    assert ch.agent_approve_transfer(5000, 2.0)[0] is False   # code sent but not entered
    assert ch.status != "done"


def test_send_otp_never_returns_the_code_and_cannot_be_asked_twice():
    ch = new_challenge()
    send_otp(ch, 0.0)
    result, _ = ch.agent_send_otp(1.0)
    assert result == "code already sent"
    assert ch.otp not in result


def test_tool_calls_after_done_are_refused():
    ch = new_challenge()
    ch.skip(0.0)
    assert ch.agent_send_otp(1.0) == ("locked", [])
    assert ch.agent_trigger_alarm("x", 1.0) == ("locked", [])
    assert ch.status == "done"


# --------------------------------------------------------------------------- #
# Wrong code / expiry / burned
# --------------------------------------------------------------------------- #
def wrong_code_for(ch):
    return "".join(str((int(d) + 1) % 10) for d in ch.otp)


def test_wrong_code_costs_an_attempt_and_keeps_the_code_alive():
    ch = new_challenge()
    t = start_entering(ch, 0.0)
    key_in(ch, wrong_code_for(ch), t)
    events = submit(ch, t)
    assert events == ["wrong_code"] and ch.attempts_left == MAX_OTP_ATTEMPTS - 1
    assert ch.status == "entering" and ch.otp_status == "sent"


def test_code_burns_after_max_attempts_and_a_new_one_can_be_requested():
    ch = new_challenge()
    t = start_entering(ch, 0.0)
    bad = wrong_code_for(ch)
    key_in(ch, bad, t)
    events = []
    for _ in range(MAX_OTP_ATTEMPTS):
        events = submit(ch, t)
    assert "burned" in events
    assert ch.otp_status == "burned" and ch.otp is None and ch.status == "verify"
    assert ch.suspicion > 0 and not ch.verified
    assert ch.agent_send_otp(t)[0] == "code sent"
    assert ch.attempts_left == MAX_OTP_ATTEMPTS


def test_repeatedly_burning_codes_trips_the_alarm():
    ch = new_challenge()
    t = 0.0
    events = []
    for _ in range(5):
        if ch.status == "alarm":
            break
        t = start_entering(ch, t) if ch.status == "idle" else t
        if ch.status == "verify":
            ch.agent_send_otp(t)
            t += OTP_DISPLAY_S + 0.1
            ch.tick(t)
        key_in(ch, wrong_code_for(ch), t)
        for _ in range(MAX_OTP_ATTEMPTS):
            events = submit(ch, t)
        t += 3.0
    assert ch.status == "alarm" and ch.suspicion >= SUSPICION_ALARM_THRESHOLD
    assert ch.alarm_reason


def test_code_expires_after_the_ttl_even_if_never_entered():
    ch = new_challenge()
    t = start_entering(ch, 0.0)
    events = ch.tick(t + OTP_TTL_S)
    assert events == ["expired"]
    assert ch.status == "verify" and ch.otp_status == "expired" and ch.otp is None
    assert ch.agent_send_otp(t + OTP_TTL_S)[0] == "code sent"


def test_correct_code_submitted_after_expiry_is_rejected():
    ch = new_challenge()
    t = start_entering(ch, 0.0)
    code = ch.otp
    key_in(ch, code, t)
    late = 0.0 + OTP_TTL_S + 0.5   # past expiry, before a tick noticed
    events = submit(ch, late)
    assert events == ["expired"] and not ch.verified and ch.status == "verify"
    assert ch.agent_approve_transfer(100, late)[0] is False


def test_code_leaves_the_screen_after_display_time():
    ch = new_challenge()
    send_otp(ch, 0.0)
    assert ch.otp in "".join(ch._current_lcd_text(1.0))
    ch.tick(OTP_DISPLAY_S + 0.1)
    assert ch.otp not in "".join(ch._current_lcd_text(OTP_DISPLAY_S + 0.1))


# --------------------------------------------------------------------------- #
# Suspicion / alarm
# --------------------------------------------------------------------------- #
def test_raise_suspicion_returns_alarm_flag_at_threshold_and_clamps():
    ch = new_challenge()
    ch.start(0.0)
    assert ch.agent_raise_suspicion(30, "odd accent", 0.0) == ("noted", [])
    assert ch.suspicion == 30
    assert ch.agent_raise_suspicion(-500, "nothing", 0.0) == ("noted", [])
    assert ch.suspicion == 30
    assert ch.agent_raise_suspicion("lots", "bad input", 0.0)[0] == "noted"
    result, events = ch.agent_raise_suspicion(10_000, "definitely fake", 0.0)
    assert result == "alarm triggered" and events == ["alarm"] and ch.status == "alarm"


def test_trigger_alarm_enters_alarm_state_and_blocks_everything():
    ch = new_challenge()
    send_otp(ch, 0.0)
    assert ch.agent_trigger_alarm("voice mismatch", 1.0) == ("alarm triggered", ["alarm"])
    assert ch.status == "alarm" and ch.otp is None and ch.alarm_reason == "voice mismatch"
    assert ch.handle_input("button", True, 2.0) == []
    assert ch.agent_send_otp(2.0) == ("locked", [])
    assert ch.agent_approve_transfer(1, 2.0)[0] is False


# --------------------------------------------------------------------------- #
# Joystick entry
# --------------------------------------------------------------------------- #
def test_digit_editing_wraps_and_cursor_clamps():
    ch = new_challenge()
    t = start_entering(ch, 0.0)
    ch.handle_input("joystick", "down", t)
    assert ch.entry[0] == 9
    ch.handle_input("joystick", "up", t)
    assert ch.entry[0] == 0
    ch.handle_input("joystick", "left", t)
    assert ch.cursor == 0
    for _ in range(OTP_LENGTH - 1):
        assert ch.handle_input("joystick", "right", t) == []
    assert ch.cursor == OTP_LENGTH - 1
    ch.handle_input("joystick", "up", t)
    assert ch.entry == (0, 0, 0, 1)


def test_input_is_ignored_outside_the_entering_state():
    ch = new_challenge()
    ch.start(0.0)
    assert ch.handle_input("joystick", "up", 0.0) == [] and ch.entry == (0,) * OTP_LENGTH
    assert ch.handle_input("button", True, 0.0) == []
    send_otp(ch, 1.0)   # restarts, then code state: still not entering
    assert ch.status == "code"
    assert ch.handle_input("joystick", "up", 1.5) == [] and ch.entry == (0,) * OTP_LENGTH
    assert ch.handle_input("button", True, 1.5) == [] and not ch.verified


def test_right_on_the_last_digit_submits_and_earlier_rights_do_not():
    ch = new_challenge()
    t = start_entering(ch, 0.0)
    for _ in range(OTP_LENGTH - 1):
        assert ch.handle_input("joystick", "right", t) == []   # just moves the cursor
    assert ch.status == "entering" and not ch.verified
    key_in(ch, ch.otp, t)   # cursor walks back through the code from here
    assert ch.cursor == OTP_LENGTH - 1


def test_correct_code_auto_submits_without_a_button():
    ch = new_challenge()
    t = start_entering(ch, 0.0)
    key_in(ch, ch.otp, t)
    assert ch.handle_input("joystick", "right", t) == ["done"] and ch.verified


def test_lcd_hints_right_to_submit_on_the_last_digit():
    ch = new_challenge()
    t = start_entering(ch, 0.0)
    assert ch._current_lcd_text(t)[0].startswith("ENTER CODE")
    for _ in range(OTP_LENGTH - 1):
        ch.handle_input("joystick", "right", t)
    line1, line2 = ch._current_lcd_text(t)
    assert line1.startswith("RIGHT=SUBMIT") and len(line1) <= 16 and "[" in line2


def test_the_button_no_longer_submits():
    ch = new_challenge()
    t = start_entering(ch, 0.0)
    key_in(ch, ch.otp, t)
    assert ch.handle_input("button", True, t) == []
    assert ch.status == "entering" and not ch.verified


def test_joystick_orientation_rotate_90(monkeypatch):
    monkeypatch.setitem(tower.JOYSTICK_ORIENTATION, "rotate", 90)
    assert normalize_joystick("up") == "right"


def test_joystick_orientation_swap(monkeypatch):
    monkeypatch.setitem(tower.JOYSTICK_ORIENTATION, "swap_up_down", True)
    assert normalize_joystick("up") == "down" and normalize_joystick("left") == "left"


# --------------------------------------------------------------------------- #
# The code never leaks outside the vault LCD
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("seed", range(8))
def test_code_is_never_in_any_snapshot(seed):
    ch = new_challenge(seed)
    t = send_otp(ch, 0.0)
    code = ch.otp
    seen = []
    for now in (t, t + 1, OTP_DISPLAY_S + 0.1, OTP_DISPLAY_S + 5):
        ch.tick(now)
        seen.append(ch.snapshot(now, include_hacker=True))
        seen.append(ch.snapshot(now))
    assert any(s["currentLcdText"][1] == "*" * OTP_LENGTH for s in seen)   # masked while showing
    for snap in seen:
        assert code not in json.dumps(snap)
    # ...but the Pi does get it: that's the point.
    assert any(c.get("type") == "lcd" and code in c["line2"] for c in ch.pop_cmds())


def test_code_is_not_in_the_agent_return_values():
    ch = new_challenge()
    ch.start(0.0)
    out = [ch.agent_send_otp(1.0), ch.agent_check_otp(1.0), ch.agent_approve_transfer(1, 1.0)]
    assert ch.otp not in json.dumps(out)


def test_no_state_has_the_code_after_done_except_verified_code():
    ch = new_challenge()
    t = start_entering(ch, 0.0)
    code = ch.otp
    key_in(ch, code, t)
    submit(ch, t)
    assert ch.otp is None and ch.verified_code == code
    assert code not in json.dumps(ch.snapshot(t, include_hacker=True))


# --------------------------------------------------------------------------- #
# Admin / lifecycle / snapshot / LCD
# --------------------------------------------------------------------------- #
def test_admin_skip_from_idle_reaches_done():
    ch = new_challenge()
    assert ch.skip(0.0) == ["done"] and ch.status == "done" and ch.verified
    assert ch.verified_code is not None


def test_admin_reset_starts_a_fresh_run():
    ch = new_challenge()
    start_entering(ch, 0.0)
    ch.reset(50.0)
    assert ch.status == "ringing" and ch.otp is None and ch.suspicion == 0


def test_idle_challenge_is_inactive_and_snapshots_empty():
    ch = new_challenge()
    snap = ch.snapshot(0.0)
    assert not ch.active and snap["substage"] == "TOWER_IDLE" and snap["currentLcdText"] == ["", ""]


def test_agent_call_on_an_idle_vault_starts_the_call():
    ch = new_challenge()
    assert ch.agent_raise_suspicion(10, "odd", 0.0) == ("noted", [])
    assert ch.status == "verify" and ch.suspicion == 10


def test_nothing_about_identity_lives_on_the_server():
    """Facts, holder name and override phrase belong to the ElevenLabs agent."""
    for name in ("ACCOUNT_FACTS", "SECRET_PHRASE", "HOLDER_NAME"):
        assert not hasattr(tower_config, name)
    ch = new_challenge()
    for name in ("agent_verify", "agent_override", "identity_verified"):
        assert not hasattr(ch, name)


# --------------------------------------------------------------------------- #
# checkOtp: how Margaret learns the joystick result (never the code)
# --------------------------------------------------------------------------- #
def test_check_otp_tracks_the_joystick_entry():
    ch = new_challenge()
    ch.start(0.0)
    assert ch.agent_check_otp(0.0) == "OTP NOT SENT"
    t = start_entering(ch, 1.0)
    assert ch.agent_check_otp(t) == "OTP PENDING"
    key_in(ch, wrong_code_for(ch), t)
    submit(ch, t)
    assert ch.agent_check_otp(t) == "OTP FAILED - they can re-enter it"
    for _ in range(OTP_LENGTH):   # walk back to position 0 and zero the digits
        ch.handle_input("joystick", "left", t)
    ch.entry = (0,) * OTP_LENGTH
    key_in(ch, ch.otp, t)
    submit(ch, t)
    assert ch.agent_check_otp(t) == "OTP VERIFIED"


def test_check_otp_reports_dead_codes_and_alarm():
    ch = new_challenge()
    t = start_entering(ch, 0.0)
    ch.tick(t + OTP_TTL_S)
    assert ch.agent_check_otp(t + OTP_TTL_S).startswith("OTP FAILED")
    ch.agent_trigger_alarm("x", t + OTP_TTL_S)
    assert ch.agent_check_otp(t + OTP_TTL_S) == "locked"


def test_check_otp_does_not_start_a_call_or_change_state():
    ch = new_challenge()
    assert ch.agent_check_otp(0.0) == "OTP NOT SENT"
    assert ch.status == "idle"


def test_send_otp_works_without_any_server_side_identity_check():
    """Margaret decides when she is satisfied; the server trusts her."""
    ch = new_challenge()
    ch.start(0.0)
    assert ch.agent_send_otp(0.0)[0] == "code sent"


def test_snapshot_shape_and_substage_names():
    ch = new_challenge()
    ch.start(0.0)
    snap = ch.snapshot(0.0)
    assert snap["substage"] == "TOWER_RINGING" and "briefing" not in snap
    assert ch.snapshot(0.0, include_hacker=True)["briefing"]
    send_otp(ch, 0.0)
    snap = ch.snapshot(1.0)
    assert snap["substage"] == "TOWER_CODE" and snap["otpStatus"] == "sent"
    assert snap["otpRemainingS"] == OTP_TTL_S - 1 and snap["attemptsLeft"] == MAX_OTP_ATTEMPTS


def test_lcd_text_never_exceeds_16_chars_through_a_full_run():
    ch = new_challenge()
    t = send_otp(ch, 0.0)

    def check(now):
        l1, l2 = ch._current_lcd_text(now)
        assert len(l1) <= 16 and len(l2) <= 16, (l1, l2)

    check(t)
    t += OTP_DISPLAY_S + 0.1
    ch.tick(t)
    check(t)
    ch.handle_input("joystick", "down", t)
    check(t)
    key_in(ch, wrong_code_for(ch), t)
    submit(ch, t)
    check(t)
    for _ in range(MAX_OTP_ATTEMPTS):
        submit(ch, t)
        check(t)
    ch.agent_trigger_alarm("x", t)
    check(t)
    ch.skip(t)
    check(t)


def test_cmds_are_deduped_by_the_lcd_throttle():
    ch = new_challenge()
    ch.start(0.0)
    ch.pop_cmds()
    ch.tick(0.1)
    ch.tick(0.2)
    assert [c for c in ch.pop_cmds() if c["type"] == "lcd"] == []


# --------------------------------------------------------------------------- #
# Socket.IO + webhook round trip
# --------------------------------------------------------------------------- #
def post(client, path, car_id, **body):
    return client.post(f"/api/tower/{path}", json={"carId": car_id, **body})


def sim_key_in(client, code):
    for pos, digit in enumerate(code):
        for _ in range(int(digit)):
            assert client.emit("tower_sim_input", {"device": "joystick", "value": "up"}, callback=True)["ok"]
        if pos < len(code) - 1:
            client.emit("tower_sim_input", {"device": "joystick", "value": "right"}, callback=True)


def test_webhook_flow_end_to_end_pays_out_once():
    car_id = "car-tower1"
    http = server.app.test_client()
    pi = server.socketio.test_client(server.app)
    hacker = server.socketio.test_client(server.app)
    pi.emit("join_car", {"carId": car_id, "role": "pi"}, callback=True)
    hacker.emit("join_car", {"carId": car_id, "role": "hacker"}, callback=True)
    assert hacker.emit("tower_start", callback=True)["ok"]

    # Nothing is approved yet.
    res = post(http, "approve-transfer", car_id, amount=TOWER_REWARD)
    assert res.status_code == 403 and res.get_json()["result"] == "not verified"

    assert post(http, "check-otp", car_id).get_json() == {"result": "OTP NOT SENT"}
    otp_res = post(http, "send-otp", car_id)
    assert otp_res.get_json() == {"result": "code sent"}   # no code in the response

    ch = server.get_tower(car_id)
    code = hacker.emit("tower_admin_show_code", {"show": True}, callback=True)["code"]
    assert code == ch.otp
    assert code not in otp_res.get_data(as_text=True)
    pi_cmds = [m["args"][0] for m in pi.get_received() if m["name"] == "cmd"]
    assert any(c["type"] == "lcd" and code in c["line2"] for c in pi_cmds)

    # Still refused while the code is unentered, even though Margaret sent it.
    assert post(http, "approve-transfer", car_id, amount=TOWER_REWARD).status_code == 403
    assert post(http, "check-otp", car_id).get_json() == {"result": "OTP PENDING"}

    with server.state_lock:
        ch._enter_entering(time.monotonic())   # skip the 8s on-screen wait for this plumbing test
    sim_key_in(hacker, code)
    assert hacker.emit("tower_sim_input", {"device": "joystick", "value": "right"}, callback=True)["ok"]

    assert http.get(f"/api/tower/check-otp?carId={car_id}").get_json() == {"result": "OTP VERIFIED"}
    car = server.get_car(car_id)
    assert car.tower_cleared and car.loot == TOWER_REWARD and car.wanted_level == TOWER_WANTED_ON_CLEAR
    assert car.tower_code == code   # spent code, only after it was used
    approve = post(http, "approve-transfer", car_id, amount=TOWER_REWARD * 100)
    assert approve.status_code == 200 and approve.get_json()["amount"] == MAX_TRANSFER

    states = [m["args"][0] for m in hacker.get_received() if m["name"] == "tower_state"]
    assert any(s["substage"] == "TOWER_DONE" for s in states)
    assert all(code not in json.dumps(s) for s in states)
    pi_cmds_after = [m["args"][0] for m in pi.get_received() if m["name"] == "cmd"]
    assert {"type": "servo", "state": "open"} in pi_cmds_after

    # A second clear (admin skip) pays nothing more.
    assert hacker.emit("tower_admin_skip", callback=True)["ok"]
    assert server.get_car(car_id).loot == TOWER_REWARD
    pi.disconnect()
    hacker.disconnect()


def test_webhook_alarm_raises_wanted_level_and_emits_alarm():
    car_id = "car-tower2"
    http = server.app.test_client()
    hacker = server.socketio.test_client(server.app)
    hacker.emit("join_car", {"carId": car_id, "role": "hacker"}, callback=True)
    hacker.get_received()

    assert post(http, "trigger-alarm", car_id, reason="voice mismatch").get_json() == {"result": "alarm triggered"}
    assert server.get_car(car_id).wanted_level == 2
    names = [m["name"] for m in hacker.get_received()]
    assert "alarm" in names and "tower_state" in names
    assert post(http, "send-otp", car_id).get_json() == {"result": "locked"}
    hacker.disconnect()


def test_webhook_raise_suspicion_alarm_and_bad_json():
    car_id = "car-tower3"
    http = server.app.test_client()
    assert post(http, "raise-suspicion", car_id, amount=10, reason="hmm").get_json() == {"result": "noted"}
    assert post(http, "raise-suspicion", car_id, amount=500, reason="fake").get_json() == {"result": "alarm triggered"}
    # Non-JSON body falls back to the default car instead of crashing.
    res = http.post("/api/tower/send-otp", data="not json", content_type="text/plain")
    assert res.status_code == 200 and res.get_json()["result"] == "code sent"


def test_webhook_shared_secret_is_enforced_when_configured(monkeypatch):
    monkeypatch.setattr(server, "TOWER_WEBHOOK_SECRET", "s3cret")
    http = server.app.test_client()
    assert post(http, "send-otp", "car-tower4").status_code == 401
    assert post(http, "check-otp", "car-tower4").status_code == 401
    res = http.post("/api/tower/send-otp", json={"carId": "car-tower4"}, headers={"X-Tower-Secret": "s3cret"})
    assert res.status_code == 200


def test_tower_dev_events_are_gated_by_dev_mode(monkeypatch):
    monkeypatch.setattr(server, "DEV_MODE", False)
    client = server.socketio.test_client(server.app)
    client.emit("join_car", {"carId": "car-tower5", "role": "hacker"}, callback=True)
    for event in ("tower_admin_skip", "tower_admin_reset", "tower_admin_show_code", "tower_sim_input"):
        assert client.emit(event, {}, callback=True) == {"error": "dev mode disabled"}
    client.disconnect()


def test_shared_input_event_accepts_button_and_still_feeds_alamo():
    pi = server.socketio.test_client(server.app)
    pi.emit("join_car", {"carId": "car-tower6", "role": "pi"}, callback=True)
    assert pi.emit("input", {"device": "button", "value": True}, callback=True)["ok"]
    assert pi.emit("input", {"device": "joystick", "value": "up"}, callback=True)["ok"]
    assert pi.emit("input", {"device": "light", "value": 20}, callback=True)["ok"]
    assert "error" in pi.emit("input", {"device": "keypad", "value": "1"}, callback=True)
    pi.disconnect()


def test_reset_car_clears_the_tower():
    car_id = "car-tower7"
    client = server.socketio.test_client(server.app)
    client.emit("join_car", {"carId": car_id, "role": "hacker"}, callback=True)
    assert client.emit("tower_admin_skip", callback=True)["ok"]
    assert server.get_car(car_id).tower_cleared
    client.emit("reset_car", callback=True)
    assert not server.get_car(car_id).tower_cleared and not server.get_tower(car_id).active
    to_dict = server.get_car(car_id).to_dict(car_id)
    assert to_dict["towerCleared"] is False and to_dict["towerCode"] is None
    client.disconnect()
