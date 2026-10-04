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
    BLIND_BELOW, BLIND_HOLD_S, CAMERA_HINT_TIMERS_S, CODE_HINT_TIMERS_S,
    HINT_REQUEST_HEAT, MEMORY_HINT_TRIGGER_MISTAKES, ROUND_LENGTHS,
    SPOTTED_ABOVE, SPOTTED_HOLD_S, WRONG_MOVE_PAUSE_S,
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
    e.g. right after a round transition) waits until ALAMO_INPUT starts for
    the current round. Never resends a light reading if already past COVER,
    since the real Pi wouldn't either (steady reading sends nothing)."""
    if ch.status == "cover":
        t = cover(ch, t)
    assert ch.status == "show"
    t = ch._show_end_at + 0.01
    ch.tick(t)
    assert ch.status == "input"
    return t


def finish_round(ch, t):
    """Enters input and plays the current round's sequence correctly."""
    t = enter_input(ch, t)
    seq = ch.sequences[ch.round]
    for move in seq:
        ch.handle_input("joystick", move, t)
    return t


def play_all_rounds(ch, t):
    """Starts a run, then covers + completes all 3 rounds correctly, landing in ALAMO_CODE."""
    ch.start(t)
    for _ in range(len(ROUND_LENGTHS)):
        t = finish_round(ch, t)
        t += 0.01
    assert ch.status in ("input",)  # phase1_done event is active; let it expire
    t += 2.5  # EVENT_MESSAGE_S for "PATTERN ACCEPTED"
    ch.tick(t)
    assert ch.status == "code"
    return t


# --------------------------------------------------------------------------- #
# Puzzle set validation
# --------------------------------------------------------------------------- #
def test_puzzle_sets_have_four_distinct_single_letter_tags():
    alamo._validate_puzzle_sets()  # should not raise


def test_bad_puzzle_set_is_rejected(monkeypatch):
    monkeypatch.setattr(alamo, "PUZZLE_SETS", [{"key": "X", "title": "t", "tags": [{"tag": "AA", "text": "x"}]}])
    with pytest.raises(ValueError):
        alamo._validate_puzzle_sets()


# --------------------------------------------------------------------------- #
# Light sensor ("the camera") hysteresis
# --------------------------------------------------------------------------- #
def test_blind_requires_continuous_hold_not_just_a_low_reading():
    ch = new_challenge()
    ch.start(0.0)
    ch.handle_input("light", 20, 0.0)
    ch.tick(0.5)  # under the hold window
    assert ch.is_covered is False and ch.status == "cover"
    ch.handle_input("light", 300, 0.5)  # interrupts the hold
    ch.tick(1.2)
    assert ch.is_covered is False and ch.status == "cover"


def test_blind_for_the_full_hold_starts_the_sequence():
    ch = new_challenge()
    ch.start(0.0)
    t = cover(ch, 0.0)
    assert ch.is_covered is True and ch.status == "show"


def test_fresh_run_defaults_to_uncovered_until_a_real_reading_arrives():
    """A vault that's never gotten a real light reading should read as armed
    (uncovered), not silently auto-advance after the hold window."""
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


def test_spotted_mid_sequence_resets_to_cover_with_heat():
    ch = new_challenge()
    ch.start(0.0)
    t = cover(ch, 0.0)
    assert ch.status == "show"
    ch.handle_input("light", SPOTTED_ABOVE + 50, t)
    t += SPOTTED_HOLD_S + 0.1
    events = ch.tick(t)
    assert "spotted" in events
    assert ch.status == "cover" and ch.heat == 1 and ch.round_mistakes == 1


# --------------------------------------------------------------------------- #
# Phase 1: Simon Says rounds
# --------------------------------------------------------------------------- #
def test_sequence_plays_as_words_then_switches_to_input():
    ch = new_challenge()
    ch.start(0.0)
    t = cover(ch, 0.0)
    assert ch.status == "show"
    assert len(ch._show_schedule) == 2 * ROUND_LENGTHS[0]  # word + blank per move
    t = ch._show_end_at + 0.01
    ch.tick(t)
    assert ch.status == "input" and ch.progress == 0


def test_correct_moves_advance_progress_through_a_round():
    ch = new_challenge()
    ch.start(0.0)
    t = enter_input(ch, 0.0)
    seq = ch.sequences[ch.round]
    events = ch.handle_input("joystick", seq[0], t)
    assert "correct" in events and ch.progress == 1


def test_wrong_move_costs_heat_and_replays_the_same_sequence():
    ch = new_challenge()
    ch.start(0.0)
    t = enter_input(ch, 0.0)
    seq = ch.sequences[ch.round]
    wrong = next(m for m in ("up", "down", "left", "right") if m != seq[0])
    events = ch.handle_input("joystick", wrong, t)
    assert "wrong" in events and ch.heat == 1 and ch.round_mistakes == 1 and ch.progress == 0
    assert ch.status == "input"  # event message showing; substage unchanged yet
    t += WRONG_MOVE_PAUSE_S + 0.1
    ch.tick(t)
    assert ch.status == "show"  # replayed, camera was still blind throughout


def test_completing_a_round_advances_to_the_next_round():
    ch = new_challenge()
    ch.start(0.0)
    t = finish_round(ch, 0.0)
    assert ch.round == 1
    assert ch.status == "show"  # camera still blind, so it goes straight back into ALAMO_SHOW
    assert len(ch.sequences[ch.round]) == ROUND_LENGTHS[1]


def test_completing_all_rounds_reaches_phase_1_done_then_code():
    ch = new_challenge()
    t = play_all_rounds(ch, 0.0)
    assert ch.status == "code"
    assert ch.correct_code is not None and len(ch.correct_code) == 4
    assert len(ch.display_pieces) == 4


def test_memory_hints_unlock_together_after_two_failed_attempts_on_a_round():
    ch = new_challenge()
    ch.start(0.0)
    t = enter_input(ch, 0.0)
    seq = ch.sequences[ch.round]
    wrong = next(m for m in ("up", "down", "left", "right") if m != seq[0])

    assert ch._memory_hint_count(t) == 0
    ch.handle_input("joystick", wrong, t)  # 1st failure -> replay scheduled
    assert ch.round_mistakes == 1 and ch._memory_hint_count(t) == 0

    t += WRONG_MOVE_PAUSE_S + 0.1
    ch.tick(t)  # on_complete fires: camera never left, so this replays straight into ALAMO_SHOW
    assert ch.status == "show"
    t = enter_input(ch, t)

    wrong = next(m for m in ("up", "down", "left", "right") if m != seq[0])
    ch.handle_input("joystick", wrong, t)  # 2nd failure
    assert ch.round_mistakes >= MEMORY_HINT_TRIGGER_MISTAKES
    assert ch._memory_hint_count(t) == 2  # both memory hints unlock together


# --------------------------------------------------------------------------- #
# Hints
# --------------------------------------------------------------------------- #
def test_camera_hints_unlock_on_a_timer_from_run_start():
    ch = new_challenge()
    ch.start(0.0)
    assert ch._camera_hint_count(0.0) == 0
    assert ch._camera_hint_count(CAMERA_HINT_TIMERS_S[0] + 1) == 1
    assert ch._camera_hint_count(CAMERA_HINT_TIMERS_S[-1] + 1) == len(CAMERA_HINT_TIMERS_S)


def test_code_hints_unlock_on_a_timer_from_phase_2_entry_and_last_hint_has_no_lcd():
    ch = new_challenge()
    t = play_all_rounds(ch, 0.0)
    assert ch._code_hint_count(t) == 0
    assert ch._code_hint_count(t + CODE_HINT_TIMERS_S[0] + 1) == 1
    assert ch._code_hint_count(t + CODE_HINT_TIMERS_S[-1] + 1) == len(CODE_HINT_TIMERS_S)
    assert ch.highlight_dates(t + CODE_HINT_TIMERS_S[-1] + 1) is True
    # The 3rd code hint is screen-only; LCD should fall back to the 1st (the
    # only one with an "lcd" entry), not go blank.
    hint = ch._latest_hint_with_lcd(t + CODE_HINT_TIMERS_S[-1] + 1)
    assert hint is not None and "lcd" in hint


def test_request_hint_unlocks_immediately_and_costs_heat():
    ch = new_challenge()
    ch.start(0.0)
    events = ch.request_hint(0.0)
    assert events == ["hint"]
    assert ch.heat == HINT_REQUEST_HEAT
    assert ch._camera_hint_count(0.0) == 1


def test_request_hint_is_a_noop_once_all_hints_in_the_category_are_unlocked():
    ch = new_challenge()
    ch.start(0.0)
    for _ in range(10):
        ch.request_hint(0.0)
    heat_after_max = ch.heat
    assert ch.request_hint(0.0) == []
    assert ch.heat == heat_after_max


def test_hints_never_show_while_the_sequence_is_playing():
    ch = new_challenge()
    ch.start(0.0)
    for _ in range(10):
        ch.request_hint(0.0)  # max out camera hints while still in cover
    t = cover(ch, 0.0)
    assert ch.status == "show"
    assert ch._active_hint_count(t + 1000) == 0


# --------------------------------------------------------------------------- #
# Phase 2: code entry (from the hacker's website, not the Pi)
# --------------------------------------------------------------------------- #
def test_correct_code_completes_the_challenge():
    ch = new_challenge()
    t = play_all_rounds(ch, 0.0)
    events, correct = ch.submit_code(ch.correct_code, t)
    assert correct is True and events == ["done"] and ch.status == "done"


def test_wrong_code_costs_heat_and_stays_in_code_phase():
    ch = new_challenge()
    t = play_all_rounds(ch, 0.0)
    wrong = "0000" if ch.correct_code != "0000" else "1111"
    events, correct = ch.submit_code(wrong, t)
    assert correct is False and events == ["wrong_code"]
    assert ch.status == "code" and ch.heat == 1 and ch.mistakes == 1


def test_code_submitted_outside_phase_2_is_ignored():
    ch = new_challenge()
    ch.start(0.0)
    events, correct = ch.submit_code("1234", 0.0)
    assert events == [] and correct is False


def test_correct_code_is_never_in_the_public_snapshot():
    ch = new_challenge()
    t = play_all_rounds(ch, 0.0)
    snap = ch.snapshot(t, include_hacker=True)
    assert ch.correct_code not in repr(snap)
    assert "sequences" not in snap


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


def test_admin_reset_clears_heat_and_mistakes():
    ch = new_challenge()
    ch.start(0.0)
    t = enter_input(ch, 0.0)
    seq = ch.sequences[ch.round]
    wrong = next(m for m in ("up", "down", "left", "right") if m != seq[0])
    ch.handle_input("joystick", wrong, t)
    assert ch.heat >= 1
    ch.reset(t + 10.0)
    assert ch.status == "cover" and ch.heat == 0 and ch.mistakes == 0 and ch.round == 0


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
    t = play_all_rounds(ch, 0.0)

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
    assert any(s.get("substage") == "ALAMO_DONE" and "archive" in s for s in hacker_states)
    pi.disconnect()
    hacker.disconnect()


def test_socket_submit_code_and_admin_reveal():
    """Exercises the socket plumbing for code entry/admin reveal. Reaching
    ALAMO_CODE for real requires playing all 3 rounds (covered by the direct
    class-level tests above), so this jumps there directly on the server-side
    object - start() has already populated the puzzle/code by this point."""
    client = server.socketio.test_client(server.app)
    client.emit("join_car", {"carId": "car-alamo3", "role": "hacker"}, callback=True)
    client.emit("alamo_start", callback=True)
    ch = server.get_alamo("car-alamo3")
    ch._enter_code(time.monotonic())

    wrong = "0000" if ch.correct_code != "0000" else "1111"
    res = client.emit("alamo_submit_code", {"code": wrong}, callback=True)
    assert res["ok"] is True and res["correct"] is False

    revealed = client.emit("alamo_admin_show_code", {"show": True}, callback=True)
    assert revealed["code"] == ch.correct_code

    res = client.emit("alamo_submit_code", {"code": ch.correct_code}, callback=True)
    assert res["correct"] is True
    assert server.get_car("car-alamo3").alamo_cleared is True
    client.disconnect()
