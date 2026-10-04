"""Alamo vault challenge: the state machine behind Challenge 1.

    Phase 1 (Simon Says):
        ALAMO_COVER (waiting for the camera - a light sensor - to be
        blinded) -> ALAMO_SHOW (vault LCD plays the round's sequence) ->
        ALAMO_INPUT (player repeats it on the joystick) -> back to
        ALAMO_COVER/ALAMO_SHOW on a mistake, or the next round on success.
    Phase 2 (order the code pieces):
        ALAMO_CODE (vault reveals shuffled tag+digit pieces; the hacker
        orders them using the Archive and submits a 4-digit code from the
        website) -> ALAMO_DONE.

"Camera" is a story name for the light sensor - there is no real camera.
Player-facing text says "camera"; code says lightSensorCovered/BLIND/SPOTTED
so the hardware is never ambiguous to a future reader.

The only hardware is a joystick and a light sensor relayed by the Raspberry
Pi over the existing `input` ({"device": "joystick"|"light", "value": ...})
and `cmd` ({"type": "lcd"|"rgb"|"led"|"beep"|"servo", ...}) Socket.IO events -
that wire protocol is fixed by the Pi-side code and is not touched here. The
4-digit code comes from the HACKER'S WEBSITE, not the Pi - see submit_code().

AlamoChallenge is a plain class driven by explicit `now` timestamps (no
threads, no sockets), so it's fully unit-testable. Methods that advance the
run return event name strings for the socket layer to apply side effects
with; `pop_cmds()` drains the Pi commands (lcd/rgb/led/beep/servo) queued by
that call.

Light readings only arrive on change (a steady reading sends nothing), so the
"blind for 1.0s" / "spotted for 0.5s" hold timers are evaluated from the last
known value on every `tick()`, not just when a new reading comes in.
"""
import logging
import random

from alamo_config import (
    BEEP_SHORT_MS, BEEP_VICTORY_GAP_S, BEEP_VICTORY_PATTERN_MS, BEEP_WRONG_MS,
    BLIND_BELOW, BLIND_HOLD_S, BLIND_TRANSITION_S, BRIEFING, CAMERA_HINTS,
    CAMERA_HINT_TIMERS_S, CODE_HINTS, CODE_HINT_TIMERS_S, COLOR_CODE, COLOR_COVER,
    COLOR_DONE, COLOR_FLASH_OFF, COLOR_FLASH_ON, COLOR_HINT, COLOR_PHASE1,
    DISTRACTOR_FACTS, EVENT_MESSAGE_S, FLASH_COUNT, FLASH_STEP_S,
    HINT_REQUEST_HEAT, JOYSTICK_ORIENTATION, LCD_HINT_CYCLE_S, LCD_MAX_LEN,
    LCD_MIN_SEND_INTERVAL_S, LCD_NORMAL_CYCLE_S, LCD_STATUS,
    MEMORY_HINT_TRIGGER_MISTAKES, MEMORY_HINTS, MOVE_DISPLAY_S, MOVE_GAP_S,
    PUZZLE_SETS, RGB_MIN_SEND_INTERVAL_S, ROUND_LENGTHS, SERVO_OPEN_ON_DONE,
    SPOTTED_ABOVE, SPOTTED_HEAT, SPOTTED_HOLD_S, WRONG_CODE_HEAT,
    WRONG_MOVE_HEAT, WRONG_MOVE_PAUSE_S,
)

log = logging.getLogger(__name__)

MOVES = ("up", "down", "left", "right")


# --------------------------------------------------------------------------- #
# Startup validation: fail fast on a malformed puzzle set, warn on LCD text
# that's too long
# --------------------------------------------------------------------------- #
def _validate_puzzle_sets():
    for pset in PUZZLE_SETS:
        tags = [t["tag"] for t in pset["tags"]]
        if len(tags) != 4 or len(set(tags)) != 4 or any(len(t) != 1 for t in tags):
            raise ValueError(f"puzzle set {pset['key']} needs exactly 4 distinct single-letter tags")


def _validate_lcd_text():
    """Logs a warning (doesn't raise) for any configured LCD line over 16 chars."""
    candidates = {
        "LCD_STATUS.cover[0]": LCD_STATUS["cover"][0],
        "LCD_STATUS.cover[1]": LCD_STATUS["cover"][1],
        "LCD_STATUS.just_blind[0]": LCD_STATUS["just_blind"][0],
        "LCD_STATUS.just_blind[1]": LCD_STATUS["just_blind"][1],
        "LCD_STATUS.show[0] (worst case)": LCD_STATUS["show"][0].format(round=3, total=3),
        "LCD_STATUS.show[1] (worst case)": "RIGHT",
        "LCD_STATUS.input[0]": LCD_STATUS["input"][0],
        "LCD_STATUS.input[1] (worst case)": LCD_STATUS["input"][1].format(progress=5, total=5),
        "LCD_STATUS.wrong_move[0]": LCD_STATUS["wrong_move"][0],
        "LCD_STATUS.wrong_move[1]": LCD_STATUS["wrong_move"][1],
        "LCD_STATUS.spotted[0]": LCD_STATUS["spotted"][0],
        "LCD_STATUS.spotted[1]": LCD_STATUS["spotted"][1],
        "LCD_STATUS.phase1_done[0]": LCD_STATUS["phase1_done"][0],
        "LCD_STATUS.code[0]": LCD_STATUS["code"][0],
        "LCD_STATUS.code[1] (worst case)": "X9 X9 X9 X9",
        "LCD_STATUS.wrong_code[0]": LCD_STATUS["wrong_code"][0],
        "LCD_STATUS.wrong_code[1]": LCD_STATUS["wrong_code"][1],
        "LCD_STATUS.done[0]": LCD_STATUS["done"][0],
        "LCD_STATUS.done[1]": LCD_STATUS["done"][1],
    }
    for hints, label in ((CAMERA_HINTS, "CAMERA_HINTS"), (MEMORY_HINTS, "MEMORY_HINTS"), (CODE_HINTS, "CODE_HINTS")):
        for i, hint in enumerate(hints):
            if "lcd" in hint:
                candidates[f"{label}[{i}].lcd[0]"] = hint["lcd"][0]
                candidates[f"{label}[{i}].lcd[1]"] = hint["lcd"][1]
    for label, text in candidates.items():
        if len(text) > LCD_MAX_LEN:
            log.warning("Alamo LCD text %s is %d chars (max %d): %r", label, len(text), LCD_MAX_LEN, text)


_validate_puzzle_sets()
_validate_lcd_text()


def normalize_joystick(raw):
    """Applies the configured swap/rotate so a remounted joystick needs no rewiring."""
    v = raw
    o = JOYSTICK_ORIENTATION
    if o.get("swap_up_down") and v in ("up", "down"):
        v = "down" if v == "up" else "up"
    if o.get("swap_left_right") and v in ("left", "right"):
        v = "right" if v == "left" else "left"
    rotate = o.get("rotate", 0) % 360
    if rotate and v in MOVES:
        order = ("up", "right", "down", "left")
        v = order[(order.index(v) + rotate // 90) % 4]
    return v


class ChangeThrottle:
    """At most one send per `min_interval`, and only when the value changed."""

    def __init__(self, min_interval):
        self.min_interval = min_interval
        self.sent = None
        self.sent_at = -float("inf")

    def maybe_send(self, value, now, force=False):
        if value == self.sent:
            return None
        if not force and now - self.sent_at < self.min_interval:
            return None
        self.sent, self.sent_at = value, now
        return value


class AlamoChallenge:
    """status: idle | cover | show | input | code | done."""

    def __init__(self, rng=None):
        self._rng = rng or random.Random()
        self.status = "idle"
        self.run_started_at = None

        # Phase 1: 3 pre-generated sequences (lengths from ROUND_LENGTHS),
        # which round we're on, and how far the player has repeated it.
        self.sequences = []
        self.round = 0
        self.progress = 0
        self.round_mistakes = 0  # wrong moves + spotted events on the CURRENT round

        # Phase 2: puzzle set, its digit-per-tag mapping and the answer, plus
        # the shuffled (tag, digit) pairs actually shown on the LCD.
        self.puzzle_set = None
        self.piece_digits = {}
        self.correct_code = None
        self.display_pieces = []
        self.code_phase_started_at = None
        self.last_code_attempt = None  # {"correct": bool, "at": float} | None

        self.heat = 0
        self.mistakes = 0

        # Light sensor ("the camera"): last known reading + hysteresis timers.
        # Starts at max brightness (uncovered) - see the comment in __init__
        # below for why 0 would be wrong.
        self.light_value = 1023
        self.is_covered = False
        self._below_since = None
        self._above_since = None

        # Hints: per-category manual unlock level (request_hint), combined
        # with the automatic (timer- or mistake-based) count at read time.
        self.camera_hint_manual = 0
        self.memory_hint_manual = 0
        self.code_hint_manual = 0

        # Display: one of "normal" | "hint" | "event".
        self._display_mode = "normal"
        self._display_until = 0.0
        self._event_text = None
        self._event_color = None
        self._event_on_complete = None
        self._flash_schedule = []   # [(at, (r,g,b))]
        self._beep_schedule = []    # [(at, ms)]
        self._show_schedule = []    # [(at, MOVE_WORD | None)]
        self._show_end_at = 0.0

        self._cmds = []
        self._lcd_throttle = ChangeThrottle(LCD_MIN_SEND_INTERVAL_S)
        self._rgb_throttle = ChangeThrottle(RGB_MIN_SEND_INTERVAL_S)
        self._led_red = None
        self._led_green = None

    # ------------------------------------------------------------------ #
    # Admin / lifecycle
    # ------------------------------------------------------------------ #
    def start(self, now):
        """First entry (or admin reset): fresh sequences, puzzle set and code."""
        self.run_started_at = now
        self.sequences = [[self._rng.choice(MOVES) for _ in range(n)] for n in ROUND_LENGTHS]
        self.round = 0
        self.round_mistakes = 0
        self.heat = 0
        self.mistakes = 0
        self.last_code_attempt = None
        self.camera_hint_manual = 0
        self.memory_hint_manual = 0
        self.code_hint_manual = 0
        self.code_phase_started_at = None

        self.puzzle_set = self._rng.choice(PUZZLE_SETS)
        tag_order = [t["tag"] for t in self.puzzle_set["tags"]]  # already chronological
        digits = self._rng.sample(range(10), 4)
        self.piece_digits = dict(zip(tag_order, digits))
        self.correct_code = "".join(str(d) for d in digits)
        self.display_pieces = list(zip(tag_order, digits))
        self._rng.shuffle(self.display_pieces)

        # Deliberately NOT resetting light_value/is_covered/_below_since here:
        # they reflect the camera's actual current physical state, which a
        # software-side restart doesn't change. __init__'s defaults (assume
        # uncovered) only apply before any real reading has ever arrived.
        self._enter_cover(now)
        self._flush_scheduled(now)
        self._flush_lcd_rgb_led(now, force=True)
        return []

    def reset(self, now):
        """Admin: restart the whole run from scratch."""
        return self.start(now)

    def skip(self, now):
        """Admin: jump straight to ALAMO_DONE."""
        if self.correct_code is None:
            # Never actually started - synthesize just enough state for the
            # DONE display (code digits, etc.) to make sense.
            self.puzzle_set = self.puzzle_set or self._rng.choice(PUZZLE_SETS)
            tag_order = [t["tag"] for t in self.puzzle_set["tags"]]
            digits = self._rng.sample(range(10), 4)
            self.piece_digits = dict(zip(tag_order, digits))
            self.correct_code = "".join(str(d) for d in digits)
            self.display_pieces = list(zip(tag_order, digits))
        self._enter_done(now)
        self._flush_scheduled(now)
        self._flush_lcd_rgb_led(now, force=True)
        return ["done"]

    @property
    def active(self):
        return self.status != "idle"

    # ------------------------------------------------------------------ #
    # Input from the Pi (joystick/light) - Phase 1 only
    # ------------------------------------------------------------------ #
    def handle_input(self, device, value, now):
        events = []
        if self.status not in ("cover", "show", "input"):
            return events
        if device == "light":
            try:
                self.light_value = int(value)
            except (TypeError, ValueError):
                return events
            events += self._update_sensor(now)
        elif device == "joystick":
            if self.status == "input":
                move = normalize_joystick(value)
                if move in MOVES:
                    events += self._handle_move(move, now)
            # Ignored with no penalty during ALAMO_COVER/ALAMO_SHOW.
        events += self._advance_display(now)
        self._flush_scheduled(now)
        self._flush_lcd_rgb_led(now)
        return events

    # ------------------------------------------------------------------ #
    # Code entry from the HACKER'S WEBSITE (not the Pi) - Phase 2 only
    # ------------------------------------------------------------------ #
    def submit_code(self, code, now):
        """Returns (events, correct). The server is the only validator."""
        if self.status != "code":
            return [], False
        code = str(code).strip()
        correct = code == self.correct_code
        self.last_code_attempt = {"correct": correct, "at": now}
        if correct:
            self._enter_done(now)
            self._flush_scheduled(now)
            self._flush_lcd_rgb_led(now)
            return ["done"], True
        self.mistakes += 1
        self.heat += WRONG_CODE_HEAT
        self._trigger_event(*LCD_STATUS["wrong_code"], now, EVENT_MESSAGE_S, flash=False)
        self._flush_scheduled(now)
        self._flush_lcd_rgb_led(now)
        return ["wrong_code"], False

    def request_hint(self, now):
        """Hacker pressed "Request hint": unlock the next hint immediately, +1 heat."""
        if self.status == "cover" and self.camera_hint_manual < len(CAMERA_HINTS):
            self.camera_hint_manual += 1
        elif self.status == "input" and self.memory_hint_manual < len(MEMORY_HINTS):
            self.memory_hint_manual += 1
        elif self.status == "code" and self.code_hint_manual < len(CODE_HINTS):
            self.code_hint_manual += 1
        else:
            return []
        self.heat += HINT_REQUEST_HEAT
        events = ["hint"] + self._advance_display(now)
        self._flush_lcd_rgb_led(now)
        return events

    def tick(self, now):
        """Call every ~100ms: evaluates sensor hold timers, the sequence-display
        schedule and scheduled cmds even when no new `input` event has arrived."""
        if not self.active:
            return []
        events = []
        if self.status in ("cover", "show", "input"):
            events += self._update_sensor(now)
        if self.status == "show" and now >= self._show_end_at:
            self._enter_input(now)
        events += self._advance_display(now)
        self._flush_scheduled(now)
        self._flush_lcd_rgb_led(now)
        return events

    # ------------------------------------------------------------------ #
    # Light sensor ("the camera") hysteresis
    # ------------------------------------------------------------------ #
    def _update_sensor(self, now):
        if self.light_value < BLIND_BELOW:
            if self._below_since is None:
                self._below_since = now
        else:
            self._below_since = None
        if self.light_value > SPOTTED_ABOVE:
            if self._above_since is None:
                self._above_since = now
        else:
            self._above_since = None

        if self._below_since is not None and now - self._below_since >= BLIND_HOLD_S:
            self.is_covered = True
        elif self._above_since is not None and now - self._above_since >= SPOTTED_HOLD_S:
            self.is_covered = False

        # Checked against the current value every call (not just on the edge
        # where is_covered just flipped), so a substage freshly (re-)entered
        # while already blind/spotted - e.g. an admin reset mid-hold - still
        # transitions, instead of waiting forever for a change that already happened.
        if self.status == "cover" and self.is_covered:
            self._begin_round_show(now)
            return []
        if self.status in ("show", "input") and not self.is_covered:
            self.heat += SPOTTED_HEAT
            self.round_mistakes += 1
            self.progress = 0
            self._enter_cover(now)
            self._trigger_event(*LCD_STATUS["spotted"], now, EVENT_MESSAGE_S, flash=True)
            return ["spotted"]
        return []

    # ------------------------------------------------------------------ #
    # Phase 1: round flow
    # ------------------------------------------------------------------ #
    def _begin_round_show(self, now):
        """Starts (or resumes waiting for) the current round, depending on
        whether the camera is blind right now."""
        if self.is_covered:
            self._enter_show(now)
        else:
            self._enter_cover(now)

    def _handle_move(self, move, now):
        seq = self.sequences[self.round]
        if move == seq[self.progress]:
            self.progress += 1
            self._queue_beep(BEEP_SHORT_MS, now)
            if self.progress >= len(seq):
                return self._complete_round(now)
            return ["correct"]
        self.heat += WRONG_MOVE_HEAT
        self.round_mistakes += 1
        self.mistakes += 1
        self.progress = 0
        self._queue_beep(BEEP_WRONG_MS, now)
        self._trigger_event(
            *LCD_STATUS["wrong_move"], now, WRONG_MOVE_PAUSE_S, flash=True,
            on_complete=self._begin_round_show,
        )
        return ["wrong"]

    def _complete_round(self, now):
        if self.round + 1 < len(ROUND_LENGTHS):
            self.round += 1
            self.progress = 0
            self.round_mistakes = 0
            self._begin_round_show(now)
            return ["round_complete"]
        self._trigger_event(
            *LCD_STATUS["phase1_done"], now, EVENT_MESSAGE_S, flash=False,
            color=COLOR_DONE, on_complete=self._enter_code,
        )
        return ["phase1_done"]

    # ------------------------------------------------------------------ #
    # Substage transitions
    # ------------------------------------------------------------------ #
    def _enter_cover(self, now):
        self.status = "cover"
        self._show_schedule = []
        self._led_set(red=True, green=False)
        self._reset_display(now)

    def _enter_show(self, now):
        self.status = "show"
        self.progress = 0
        self._led_set(red=False, green=False)
        self._trigger_event(*LCD_STATUS["just_blind"], now, BLIND_TRANSITION_S, flash=False)

        t = now + BLIND_TRANSITION_S
        schedule = []
        for move in self.sequences[self.round]:
            schedule.append((t, move.upper()))
            self._queue_beep(BEEP_SHORT_MS, t)
            t += MOVE_DISPLAY_S
            schedule.append((t, None))
            t += MOVE_GAP_S
        self._show_schedule = schedule
        self._show_end_at = t

    def _enter_input(self, now):
        self.status = "input"
        self.progress = 0
        self._reset_display(now)

    def _enter_code(self, now):
        self.status = "code"
        self.code_phase_started_at = now
        self.code_hint_manual = 0
        self._led_set(red=False, green=False)
        self._reset_display(now)

    def _enter_done(self, now):
        self.status = "done"
        self._led_set(red=False, green=True)
        self._reset_display(now)
        self._queue_victory_beeps(now)
        if SERVO_OPEN_ON_DONE:
            self._cmds.append({"type": "servo", "state": "open"})

    # ------------------------------------------------------------------ #
    # Hints
    # ------------------------------------------------------------------ #
    def _camera_hint_count(self, now):
        elapsed = 0 if self.run_started_at is None else now - self.run_started_at
        auto = sum(1 for t in CAMERA_HINT_TIMERS_S if elapsed >= t)
        return max(auto, self.camera_hint_manual)

    def _memory_hint_count(self, now):
        auto = len(MEMORY_HINTS) if self.round_mistakes >= MEMORY_HINT_TRIGGER_MISTAKES else 0
        return max(auto, self.memory_hint_manual)

    def _code_hint_count(self, now):
        elapsed = 0 if self.code_phase_started_at is None else now - self.code_phase_started_at
        auto = sum(1 for t in CODE_HINT_TIMERS_S if elapsed >= t)
        return max(auto, self.code_hint_manual)

    def _active_hint_count(self, now):
        # Never during ALAMO_SHOW - the LCD is busy playing the sequence.
        if self.status == "cover":
            return self._camera_hint_count(now)
        if self.status == "input":
            return self._memory_hint_count(now)
        if self.status == "code":
            return self._code_hint_count(now)
        return 0

    def _latest_hint_with_lcd(self, now):
        """Most recently unlocked hint that has LCD text (some code hints are
        screen-only, e.g. "highlight the dates" has no safecracker-facing line)."""
        if self.status == "cover":
            hints, n = CAMERA_HINTS, self._camera_hint_count(now)
        elif self.status == "input":
            hints, n = MEMORY_HINTS, self._memory_hint_count(now)
        elif self.status == "code":
            hints, n = CODE_HINTS, self._code_hint_count(now)
        else:
            return None
        for hint in reversed(hints[:n]):
            if "lcd" in hint:
                return hint
        return None

    def hints_unlocked_screen(self, now):
        """Screen text for every hint unlocked so far in the current category, in order."""
        if self.status == "cover":
            return [h["screen"] for h in CAMERA_HINTS[: self._camera_hint_count(now)]]
        if self.status == "input":
            return [h["screen"] for h in MEMORY_HINTS[: self._memory_hint_count(now)]]
        if self.status == "code":
            return [h["screen"] for h in CODE_HINTS[: self._code_hint_count(now)]]
        return []

    def highlight_dates(self, now):
        """True once the "highlight the dates" code hint has unlocked."""
        return self.status == "code" and self._code_hint_count(now) >= len(CODE_HINTS)

    # ------------------------------------------------------------------ #
    # Display: normal <-> hint cycling, with event messages interrupting
    # ------------------------------------------------------------------ #
    def _show_current_word(self, now):
        word = None
        for at, w in self._show_schedule:
            if at <= now:
                word = w
            else:
                break
        return word

    def _normal_text(self, now):
        if self.status == "cover":
            return LCD_STATUS["cover"]
        if self.status == "show":
            l1, l2 = LCD_STATUS["show"]
            return l1.format(round=self.round + 1, total=len(ROUND_LENGTHS)), self._show_current_word(now) or ""
        if self.status == "input":
            l1, l2 = LCD_STATUS["input"]
            return l1, l2.format(progress=self.progress, total=len(self.sequences[self.round]))
        if self.status == "code":
            l1, l2 = LCD_STATUS["code"]
            pieces = " ".join(f"{tag}{digit}" for tag, digit in self.display_pieces)
            return l1, l2.format(pieces=pieces)
        if self.status == "done":
            return LCD_STATUS["done"]
        return "", ""

    def _reset_display(self, now):
        self._display_mode = "normal"
        self._display_until = now + LCD_NORMAL_CYCLE_S
        self._event_text = None
        self._event_color = None
        self._event_on_complete = None
        self._flash_schedule = []

    def _trigger_event(self, line1, line2, now, duration=EVENT_MESSAGE_S, flash=False, color=None, on_complete=None):
        self._display_mode = "event"
        self._event_text = (line1, line2)
        self._display_until = now + duration
        self._event_color = color
        self._event_on_complete = on_complete
        self._flash_schedule = []
        if flash:
            for i in range(FLASH_COUNT):
                self._flash_schedule.append((now + 2 * i * FLASH_STEP_S, COLOR_FLASH_ON))
                self._flash_schedule.append((now + (2 * i + 1) * FLASH_STEP_S, COLOR_FLASH_OFF))

    def _advance_display(self, now):
        """Moves the normal<->hint cycle / event interrupt forward. No events of
        its own; callers already return the right event strings."""
        if self._display_mode == "event":
            if now >= self._display_until:
                on_complete = self._event_on_complete
                self._reset_display(now)
                if on_complete:
                    on_complete(now)
        elif self._active_hint_count(now) > 0:
            if self._display_mode == "normal" and now >= self._display_until:
                self._display_mode, self._display_until = "hint", now + LCD_HINT_CYCLE_S
            elif self._display_mode == "hint" and now >= self._display_until:
                self._display_mode, self._display_until = "normal", now + LCD_NORMAL_CYCLE_S
        else:
            self._display_mode = "normal"
        return []

    def _current_lcd_text(self, now):
        if self._display_mode == "event":
            return self._event_text
        if self._display_mode == "hint":
            hint = self._latest_hint_with_lcd(now)
            if hint:
                return hint["lcd"]
        return self._normal_text(now)

    def _current_rgb(self, now):
        for at, color in self._flash_schedule:
            if at <= now <= at + FLASH_STEP_S:
                return color
        if self._display_mode == "event" and self._event_color:
            return self._event_color
        if self._display_mode == "hint":
            return COLOR_HINT
        return {
            "cover": COLOR_COVER, "show": COLOR_PHASE1, "input": COLOR_PHASE1,
            "code": COLOR_CODE, "done": COLOR_DONE,
        }.get(self.status, COLOR_DONE)

    # ------------------------------------------------------------------ #
    # Pi commands: LCD/RGB (throttled + change-only) and LED/beep (direct)
    # ------------------------------------------------------------------ #
    def _led_set(self, red, green):
        if red != self._led_red:
            self._led_red = red
            self._cmds.append({"type": "led", "color": "red", "on": red})
        if green != self._led_green:
            self._led_green = green
            self._cmds.append({"type": "led", "color": "green", "on": green})

    def _queue_beep(self, ms, at):
        self._beep_schedule.append((at, ms))

    def _queue_victory_beeps(self, now):
        t = now
        for ms in BEEP_VICTORY_PATTERN_MS:
            self._beep_schedule.append((t, ms))
            t += ms / 1000.0 + BEEP_VICTORY_GAP_S

    def _flush_scheduled(self, now):
        due, pending = [], []
        for at, ms in self._beep_schedule:
            (due if at <= now else pending).append((at, ms))
        self._beep_schedule = pending
        for _, ms in due:
            self._cmds.append({"type": "beep", "ms": ms})

    def _flush_lcd_rgb_led(self, now, force=False):
        line1, line2 = self._current_lcd_text(now)
        lcd = self._lcd_throttle.maybe_send((line1, line2), now, force=force)
        if lcd is not None:
            self._cmds.append({"type": "lcd", "line1": lcd[0], "line2": lcd[1]})
        r, g, b = self._current_rgb(now)
        rgb = self._rgb_throttle.maybe_send((r, g, b), now, force=force)
        if rgb is not None:
            self._cmds.append({"type": "rgb", "r": rgb[0], "g": rgb[1], "b": rgb[2]})

    def pop_cmds(self):
        cmds, self._cmds = self._cmds, []
        return cmds

    # ------------------------------------------------------------------ #
    # Snapshots pushed to clients. The memory sequence and the correct code
    # are NEVER included (admin reveal is a separate, DEV_MODE-gated call).
    # ------------------------------------------------------------------ #
    def snapshot(self, now, include_hacker=False):
        snap = {
            "substage": f"ALAMO_{self.status.upper()}" if self.active else "ALAMO_IDLE",
            "lightSensorCovered": self.is_covered,
            "lightValue": self.light_value,
            "round": self.round + 1 if self.active else 0,
            "progress": self.progress,
            "sequenceLength": len(self.sequences[self.round]) if self.active and self.sequences else 0,
            "mistakes": self.mistakes,
            "heat": self.heat,
            "hintsUnlocked": self._active_hint_count(now),
            "currentLcdText": list(self._current_lcd_text(now)) if self.active else ["", ""],
            "puzzleSet": self.puzzle_set["key"] if self.puzzle_set else None,
            "lastCodeAttempt": self.last_code_attempt,
        }
        if include_hacker:
            snap["hintsScreen"] = self.hints_unlocked_screen(now)
            snap["highlightDates"] = self.highlight_dates(now)
            snap["briefing"] = BRIEFING
            snap["codeLength"] = len(self.correct_code) if self.correct_code else 4
            snap["archive"] = {
                "setKey": self.puzzle_set["key"],
                "title": self.puzzle_set["title"],
                "facts": [t["text"] for t in self.puzzle_set["tags"]],
                "distractors": DISTRACTOR_FACTS,
            } if self.puzzle_set else None
        return snap
