"""Alamo vault challenge: the state machine behind Challenge 1.

Minimal flow, no rounds/hints/heat:

    ALAMO_COVER (waiting for the camera - a light sensor - to be blinded)
    -> ALAMO_SHOW (vault LCD plays a 4-move sequence)
    -> ALAMO_INPUT (player repeats it on the joystick; the initial cover is
       latched for the rest of the sequence)
    -> ALAMO_CODE (vault speaks a keyword)
    -> ALAMO_DONE (hacker typed the matching code on the website)

"Camera" is a story name for the light sensor - there is no real camera.
Player-facing text says "camera"; code says lightSensorCovered/BLIND/SPOTTED
so the hardware is never ambiguous to a future reader.

The only hardware is a joystick and a light sensor relayed by the Raspberry
Pi over the existing `input` ({"device": "joystick"|"light", "value": ...})
and `cmd` ({"type": "lcd"|"rgb"|"led"|"beep"|"servo", ...}) Socket.IO events -
that wire protocol is fixed by the Pi-side code and is not touched here. The
spoken keyword is delivered only to the Pi, while the hacker types it on the
website - see submit_code().

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
    BLIND_BELOW, BLIND_HOLD_S, BLIND_TRANSITION_S, BRIEFING, COLOR_CODE,
    COLOR_COVER, COLOR_DONE, COLOR_FLASH_OFF, COLOR_FLASH_ON, COLOR_PHASE1,
    EVENT_MESSAGE_S, FLASH_COUNT, FLASH_STEP_S, JOYSTICK_ORIENTATION,
    LCD_MAX_LEN, LCD_MIN_SEND_INTERVAL_S, LCD_STATUS, MOVE_DISPLAY_S,
    MOVE_GAP_S, RGB_MIN_SEND_INTERVAL_S, SEQUENCE_LENGTH, SERVO_OPEN_ON_DONE,
    SPOTTED_ABOVE, SPOTTED_HOLD_S, WRONG_MOVE_PAUSE_S, KEYWORDS,
)

log = logging.getLogger(__name__)

MOVES = ("up", "down", "left", "right")


# --------------------------------------------------------------------------- #
# Startup validation: log a warning if any configured LCD line is too long
# --------------------------------------------------------------------------- #
def _validate_lcd_text():
    candidates = {
        "LCD_STATUS.cover[0]": LCD_STATUS["cover"][0],
        "LCD_STATUS.cover[1]": LCD_STATUS["cover"][1],
        "LCD_STATUS.just_blind[0]": LCD_STATUS["just_blind"][0],
        "LCD_STATUS.just_blind[1]": LCD_STATUS["just_blind"][1],
        "LCD_STATUS.show[0]": LCD_STATUS["show"][0],
        "LCD_STATUS.show[1] (worst case)": "RIGHT",
        "LCD_STATUS.input[0]": LCD_STATUS["input"][0],
        "LCD_STATUS.input[1] (worst case)": LCD_STATUS["input"][1].format(
            progress=SEQUENCE_LENGTH, total=SEQUENCE_LENGTH
        ),
        "LCD_STATUS.wrong_move[0]": LCD_STATUS["wrong_move"][0],
        "LCD_STATUS.wrong_move[1]": LCD_STATUS["wrong_move"][1],
        "LCD_STATUS.spotted[0]": LCD_STATUS["spotted"][0],
        "LCD_STATUS.spotted[1]": LCD_STATUS["spotted"][1],
        "LCD_STATUS.code[0]": LCD_STATUS["code"][0],
        "LCD_STATUS.wrong_code[0]": LCD_STATUS["wrong_code"][0],
        "LCD_STATUS.wrong_code[1]": LCD_STATUS["wrong_code"][1],
        "LCD_STATUS.done[0]": LCD_STATUS["done"][0],
        "LCD_STATUS.done[1]": LCD_STATUS["done"][1],
    }
    for label, text in candidates.items():
        if len(text) > LCD_MAX_LEN:
            log.warning("Alamo LCD text %s is %d chars (max %d): %r", label, len(text), LCD_MAX_LEN, text)


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

        self.sequence = []
        self.progress = 0

        self.correct_code = None

        # Light sensor ("the camera"): last known reading + hysteresis timers.
        # Starts at max brightness (uncovered) - a vault that's never gotten a
        # real reading should read as armed, not already-dark, and the Pi only
        # sends on change so this is also what a fresh connection reads as
        # until the first real sample arrives.
        self.light_value = 1023
        self.is_covered = False
        self._below_since = None
        self._above_since = None

        # Display: "normal" | "event".
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
        """First entry (or admin reset): a fresh sequence and a fresh code."""
        self.sequence = [self._rng.choice(MOVES) for _ in range(SEQUENCE_LENGTH)]
        self.progress = 0
        self.correct_code = self._rng.choice(KEYWORDS)

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
            self.correct_code = self._rng.choice(KEYWORDS)
        self._enter_done(now)
        self._flush_scheduled(now)
        self._flush_lcd_rgb_led(now, force=True)
        return ["done"]

    @property
    def active(self):
        return self.status != "idle"

    # ------------------------------------------------------------------ #
    # Input from the Pi (joystick/light)
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
    # Code entry from the HACKER'S WEBSITE (not the Pi)
    # ------------------------------------------------------------------ #
    def submit_code(self, code, now):
        """Returns (events, correct). The server is the only validator."""
        if self.status != "code":
            return [], False
        code = str(code).strip()
        correct = str(code or "").strip().upper() == self.correct_code
        if correct:
            self._enter_done(now)
            self._flush_scheduled(now)
            self._flush_lcd_rgb_led(now)
            return ["done"], True
        self._trigger_event(*LCD_STATUS["wrong_code"], now, EVENT_MESSAGE_S, flash=False)
        self._flush_scheduled(now)
        self._flush_lcd_rgb_led(now)
        return ["wrong_code"], False

    def repeat_keyword(self):
        """Queue the current keyword for the Pi without revealing it to the browser."""
        if self.status != "code" or not self.correct_code:
            return False
        self._cmds.append({"type": "speak", "text": self.correct_code})
        return True

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
        # where is_covered just flipped), so a substage freshly re-entered
        # while already blind still transitions without waiting for a new
        # sensor change.
        if self.status == "cover" and self.is_covered:
            self._begin_show(now)
            return []
        return []

    # ------------------------------------------------------------------ #
    # The sequence
    # ------------------------------------------------------------------ #
    def _begin_show(self, now):
        """Starts (or resumes waiting for) the sequence, depending on whether
        the camera is blind right now."""
        if self.is_covered:
            self._enter_show(now)
        else:
            self._enter_cover(now)

    def _handle_move(self, move, now):
        if move == self.sequence[self.progress]:
            self.progress += 1
            self._queue_beep(BEEP_SHORT_MS, now)
            if self.progress >= len(self.sequence):
                self._enter_code(now)
                return ["sequence_complete"]
            return ["correct"]
        self.progress = 0
        self._queue_beep(BEEP_WRONG_MS, now)
        self._trigger_event(
            *LCD_STATUS["wrong_move"], now, WRONG_MOVE_PAUSE_S, flash=True,
            on_complete=self._begin_show,
        )
        return ["wrong"]

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
        for move in self.sequence:
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
        self._led_set(red=False, green=False)
        self._cmds.append({"type": "speak", "text": self.correct_code})
        self._reset_display(now)

    def _enter_done(self, now):
        self.status = "done"
        self._led_set(red=False, green=True)
        self._reset_display(now)
        self._queue_victory_beeps(now)
        if SERVO_OPEN_ON_DONE:
            self._cmds.append({"type": "servo", "state": "open"})

    # ------------------------------------------------------------------ #
    # Display: normal status, with event messages interrupting
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
            return l1, self._show_current_word(now) or ""
        if self.status == "input":
            l1, l2 = LCD_STATUS["input"]
            return l1, l2.format(progress=self.progress, total=len(self.sequence))
        if self.status == "code":
            return LCD_STATUS["code"]
        if self.status == "done":
            return LCD_STATUS["done"]
        return "", ""

    def _reset_display(self, now):
        self._display_mode = "normal"
        self._display_until = now
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
        """Clears an expired event message. No events of its own; callers
        already return the right event strings."""
        if self._display_mode == "event" and now >= self._display_until:
            on_complete = self._event_on_complete
            self._reset_display(now)
            if on_complete:
                on_complete(now)
        return []

    def _current_lcd_text(self, now):
        if self._display_mode == "event":
            return self._event_text
        return self._normal_text(now)

    def _current_rgb(self, now):
        for at, color in self._flash_schedule:
            if at <= now <= at + FLASH_STEP_S:
                return color
        if self._display_mode == "event" and self._event_color:
            return self._event_color
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
    # Snapshots pushed to clients. The sequence and the correct code are
    # NEVER included (admin reveal is a separate, DEV_MODE-gated call).
    # ------------------------------------------------------------------ #
    def snapshot(self, now, include_hacker=False):
        snap = {
            "substage": f"ALAMO_{self.status.upper()}" if self.active else "ALAMO_IDLE",
            "lightSensorCovered": self.is_covered,
            "lightValue": self.light_value,
            "progress": self.progress,
            "sequenceLength": len(self.sequence) if self.sequence else SEQUENCE_LENGTH,
            "currentLcdText": list(self._current_lcd_text(now)) if self.active else ["", ""],
        }
        if include_hacker:
            snap["briefing"] = BRIEFING
            snap["keywordLength"] = len(self.correct_code) if self.correct_code else 5
        return snap
