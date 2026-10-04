"""Tests for the Alamo vault state machine using synthetic input (no hardware needed).

Run: python -m pytest test_alamo.py -q
"""
import random
import time

import pytest

import alamo_challenge as alamo
import app as server
from alamo_challenge import AlamoChallenge, ChangeThrottle, normalize_joystick
from alamo_config import (
    BLIND_BELOW, BLIND_HOLD_S, SEQUENCE_LENGTH, SPOTTED_ABOVE, SPOTTED_HOLD_S,
    WRONG_MOVE_PAUSE_S,
)


def new_challenge(seed=1):
    return AlamoChallenge(rng=random.Random(seed))


def cover(ch, t, hold=BLIND_HOLD_S + 0.1):
    """Covers the camera and ticks past the hold window; returns the new time."""
    ch.handle_input("light", BLIND_BELOW - 50, t)
    t += hold
    ch.tick(t)
    return t


def enter_input(ch, t):
    """From ALAMO_COVER (or mid ALAMO_SHOW, if the camera is already blind -
    e.g. right after a retry) waits until ALAMO_INPUT starts."""
    if ch.status == "cover":
        t = cover(ch, t)
    assert ch.status == "show"
    t = ch._show_end_at + 0.01
    ch.tick(t)
    assert ch.status == "input"
    return t


def solve_sequence(ch, t):
    """Starts a run, covers, waits for the sequence, and plays it correctly.
    Returns (t, events)."""
    ch.start(t)
    t = enter_input(ch, t)
    events = []
    for move in ch.sequence:
        events = ch.handle_input("joystick", move, t)
    return t, events


# --------------------------------------------------------------------------- #
# Light sensor ("the camera") hysteresis
# --------------------------------------------------------------------------- #
def test_blind_requires_continuous_hold_not_just_a_low_reading():
    ch = new_challenge()
    ch.start(0.0)
    ch.handle_input("light", 20, 0.0)
    ch.tick(0.5)
    assert ch.is_covered is False and ch.status == "cover"
    ch.handle_input("light", 300, 0.5)
    ch.tick(1.2)
    assert ch.is_covered is False and ch.status == "cover"


def test_blind_for_the_full_hold_starts_the_sequence():
    ch = new_challenge()
    ch.start(0.0)
    cover(ch, 0.0)
    assert ch.is_covered is True and ch.status == "show"


def test_fresh_run_defaults_to_uncovered_until_a_real_reading_arrives():
    ch = new_challenge()
    ch.start(0.0)
    ch.tick(10.0)
    assert ch.is_covered is False and ch.status == "cover"


def test_resetting_while_still_physically_covered_transitions_immediately():
    ch = new_challenge()
    ch.start(0.0)
    t = cover(ch, 0.0)  # now in ALAMO_SHOW, light still held low
    ch.reset(t + 5.0)   # admin reset back to ALAMO_COVER; light input never resent
    assert ch.status == "cover"
    ch.tick(t + 5.01)
    assert ch.is_covered is True and ch.status == "show"


def test_spotted_mid_sequence_resets_to_cover():
    ch = new_challenge()
    ch.start(0.0)
    t = cover(ch, 0.0)
    assert ch.status == "show"
    ch.handle_input("light", SPOTTED_ABOVE + 50, t)
    t += SPOTTED_HOLD_S + 0.1
    events = ch.tick(t)
    assert "spotted" in events
    assert ch.status == "cover"


# --------------------------------------------------------------------------- #
# The sequence
# --------------------------------------------------------------------------- #
def test_sequence_plays_as_words_then_switches_to_input():
    ch = new_challenge()
    ch.start(0.0)
    cover(ch, 0.0)
    assert ch.status == "show"
    assert len(ch._show_schedule) == 2 * SEQUENCE_LENGTH  # word + blank per move
    t = ch._show_end_at + 0.01
    ch.tick(t)
    assert ch.status == "input" and ch.progress == 0


def test_correct_moves_advance_progress():
    ch = new_challenge()
    ch.start(0.0)
    t = enter_input(ch, 0.0)
    events = ch.handle_input("joystick", ch.sequence[0], t)
    assert "correct" in events and ch.progress == 1


def test_wrong_move_replays_the_same_sequence():
    ch = new_challenge()
    ch.start(0.0)
    t = enter_input(ch, 0.0)
    wrong = next(m for m in ("up", "down", "left", "right") if m != ch.sequence[0])
    events = ch.handle_input("joystick", wrong, t)
    assert "wrong" in events and ch.progress == 0
    assert ch.status == "input"  # event message showing; substage unchanged yet
    t += WRONG_MOVE_PAUSE_S + 0.1
    ch.tick(t)
    assert ch.status == "show"  # replayed, camera was still blind throughout


def test_completing_the_sequence_reveals_the_code():
    ch = new_challenge()
    ch.start(0.0)
    t, events = solve_sequence(ch, 0.0)
    assert events == ["sequence_complete"]
    assert ch.status == "code"
    assert ch.correct_code is not None and ch.correct_code.isalpha()
    assert any(cmd == {"type": "speak", "text": ch.correct_code} for cmd in ch.pop_cmds())


# --------------------------------------------------------------------------- #
# Code entry (from the hacker's website, not the Pi)
# --------------------------------------------------------------------------- #
def test_correct_code_completes_the_challenge():
    ch = new_challenge()
    t, _ = solve_sequence(ch, 0.0)
    events, correct = ch.submit_code(ch.correct_code, t)
    assert correct is True and events == ["done"] and ch.status == "done"


def test_wrong_code_stays_in_code_phase():
    ch = new_challenge()
    t, _ = solve_sequence(ch, 0.0)
    wrong = "0000" if ch.correct_code != "0000" else "1111"
    events, correct = ch.submit_code(wrong, t)
    assert correct is False and events == ["wrong_code"]
    assert ch.status == "code"


def test_code_submitted_outside_the_code_phase_is_ignored():
    ch = new_challenge()
    ch.start(0.0)
    events, correct = ch.submit_code("1234", 0.0)
    assert events == [] and correct is False


def test_keyword_is_spoken_once_revealed_but_never_sent_to_the_hacker():
    """The Pi receives the keyword as speech; the browser only gets a prompt.
    The joystick sequence and keyword must never reach a normal client."""
    ch = new_challenge()
    t, _ = solve_sequence(ch, 0.0)
    snap = ch.snapshot(t, include_hacker=True)
    assert snap["currentLcdText"] == ["SAY KEYWORD", "TYPE ON SITE"]
    assert ch.correct_code not in repr(snap)
    assert "sequence" not in snap
    for move in ch.sequence:
        assert move.upper() not in repr(snap)


# --------------------------------------------------------------------------- #
# No heat/hints: make sure nothing re-adds them silently
# --------------------------------------------------------------------------- #
def test_no_heat_or_hint_concept_exists():
    ch = new_challenge()
    assert not hasattr(ch, "heat")
    assert not hasattr(ch, "request_hint")
    assert not hasattr(ch, "mistakes")


# --------------------------------------------------------------------------- #
# Admin
# --------------------------------------------------------------------------- #
def test_admin_skip_from_idle_synthesizes_enough_state_to_reach_done():
    ch = new_challenge()
    events = ch.skip(0.0)
    assert events == ["done"] and ch.status == "done" and ch.correct_code is not None


def test_admin_skip_mid_run_jumps_straight_to_done():
    ch = new_challenge()
    ch.start(0.0)
    t = enter_input(ch, 0.0)
    events = ch.skip(t)
    assert events == ["done"] and ch.status == "done"


def test_admin_reset_starts_a_fresh_run():
    ch = new_challenge()
    ch.start(0.0)
    t = enter_input(ch, 0.0)
    ch.handle_input("joystick", ch.sequence[0], t)
    assert ch.progress == 1
    ch.reset(t + 10.0)
    assert ch.status == "cover" and ch.progress == 0


# --------------------------------------------------------------------------- #
# LCD / throttling / orientation (unchanged mechanics)
# --------------------------------------------------------------------------- #
def test_change_throttle_caps_rate_and_skips_unchanged_values():
    th = ChangeThrottle(0.25)
    assert th.maybe_send("a", 0.0) == "a"
    assert th.maybe_send("a", 0.1) is None
    assert th.maybe_send("b", 0.1) is None
    assert th.maybe_send("b", 0.3) == "b"


def test_lcd_text_never_exceeds_16_chars_through_a_full_run():
    ch = new_challenge()
    t, _ = solve_sequence(ch, 0.0)

    def check(now):
        l1, l2 = ch._current_lcd_text(now)
        assert len(l1) <= 16 and len(l2) <= 16

    check(t)
    ch.submit_code("0000" if ch.correct_code != "0000" else "1111", t)
    check(t)


def test_joystick_orientation_rotate_90(monkeypatch):
    monkeypatch.setitem(alamo.JOYSTICK_ORIENTATION, "rotate", 90)
    assert normalize_joystick("up") == "right"
    assert normalize_joystick("right") == "down"


def test_joystick_orientation_swap(monkeypatch):
    monkeypatch.setitem(alamo.JOYSTICK_ORIENTATION, "swap_up_down", True)
    assert normalize_joystick("up") == "down"
    assert normalize_joystick("left") == "left"


# --------------------------------------------------------------------------- #
# Socket.IO round trip (admin path only; timing-sensitive paths are covered
# against the class directly above)
# --------------------------------------------------------------------------- #
def test_socket_join_pi_and_hacker_then_admin_skip_propagates_car_state():
    pi = server.socketio.test_client(server.app)
    hacker = server.socketio.test_client(server.app)
    assert pi.emit("join_car", {"carId": "car-alamo2", "role": "pi"}, callback=True)["ok"]
    ack = hacker.emit("join_car", {"carId": "car-alamo2", "role": "hacker"}, callback=True)
    assert ack["ok"] is True

    assert pi.emit("input", {"device": "light", "value": 20}, callback=True)["ok"]
    assert hacker.emit("alamo_admin_skip", callback=True)["ok"]

    car = server.get_car("car-alamo2")
    assert car.alamo_cleared is True and car.alamo_code is not None

    hacker_states = [m["args"][0] for m in hacker.get_received() if m["name"] == "alamo_state"]
    assert any(s.get("substage") == "ALAMO_DONE" for s in hacker_states)
    pi.disconnect()
    hacker.disconnect()


def test_socket_submit_code_and_admin_reveal():
    client = server.socketio.test_client(server.app)
    client.emit("join_car", {"carId": "car-alamo3", "role": "hacker"}, callback=True)
    client.emit("alamo_start", callback=True)
    ch = server.get_alamo("car-alamo3")
    ch._enter_code(time.monotonic())  # jump straight to code phase for this plumbing test

    wrong = "0000" if ch.correct_code != "0000" else "1111"
    res = client.emit("alamo_submit_code", {"code": wrong}, callback=True)
    assert res["ok"] is True and res["correct"] is False

    revealed = client.emit("alamo_admin_show_code", {"show": True}, callback=True)
    assert revealed["code"] == ch.correct_code

    res = client.emit("alamo_submit_code", {"code": ch.correct_code}, callback=True)
    assert res["correct"] is True
    assert server.get_car("car-alamo3").alamo_cleared is True
    client.disconnect()
