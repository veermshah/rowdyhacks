"""Tower vault challenge: the state machine behind Challenge 3 ("The Callback").

    TOWER_RINGING  (waiting for the crew to phone the bank's fraud line)
    -> TOWER_VERIFY   (Margaret, the voice agent, is checking who's calling)
    -> TOWER_CODE     (server made a one-time code and pushed it to the vault LCD)
    -> TOWER_ENTERING (code left the screen; crew keys it in on the joystick)
    -> TOWER_DONE     (code accepted in time: vault pops, bearer bonds paid out)
    or TOWER_ALARM    (too suspicious / alarm triggered)

SECURITY: the one-time code is generated and verified ONLY here. Margaret (an
ElevenLabs agent) reaches this class through webhook tools (the agent_*
methods) and never receives the code - `agent_send_otp` returns "code sent"
and nothing else - so she can't be talked into reading it out or skipping the
check. `agent_approve_transfer` refuses unless the code was entered correctly
on the joystick. The code is also never in a snapshot (the vault LCD preview
is masked while the code is showing); it goes only to the Pi's LCD cmd.

Hardware is the same shared vault rig as the Alamo, over the same fixed Pi
protocol: `input` events ({"device": "joystick"|"button", "value": ...}) in,
`cmd` events ({"type": "lcd"|"rgb"|"led"|"beep"|"servo", ...}) out. Joystick:
up/down change the current digit (0-9, wrapping), left/right move the cursor,
the joystick BUTTON submits.

TowerChallenge is a plain class driven by explicit `now` timestamps (no
threads, no sockets), so it's fully unit-testable. Methods that advance the
run return event name strings ("done", "alarm", "wrong_code", "expired",
"burned", "code_sent") for the socket layer to apply side effects with;
`pop_cmds()` drains the Pi commands queued by that call.
"""
import hmac
import logging
import math
import random
import re

from alamo_challenge import MOVES, ChangeThrottle
from tower_config import (
    ACCOUNT_FACTS, BEEP_ALARM_MS, BEEP_CODE_MS, BEEP_SHORT_MS,
    BEEP_VICTORY_GAP_S, BEEP_VICTORY_PATTERN_MS, BEEP_WRONG_MS, BRIEFING,
    COLOR_ALARM, COLOR_CODE, COLOR_DONE, COLOR_ENTERING, COLOR_FLASH_OFF,
    COLOR_FLASH_ON, COLOR_IDLE, COLOR_RINGING, COLOR_VERIFY, EVENT_MESSAGE_S,
    FLASH_COUNT, FLASH_STEP_S, JOYSTICK_ORIENTATION, LCD_MAX_LEN,
    LCD_MIN_SEND_INTERVAL_S, LCD_STATUS, MAX_OTP_ATTEMPTS, MAX_SUSPICION_PER_CALL,
    MAX_TRANSFER, OTP_DISPLAY_S, OTP_LENGTH, OTP_TTL_S, RGB_MIN_SEND_INTERVAL_S,
    SECRET_PHRASE, SERVO_OPEN_ON_DONE, SUSPICION_ALARM_THRESHOLD,
    SUSPICION_BURNED_OTP, SUSPICION_DENIED_OVERRIDE, SUSPICION_WRONG_ANSWER,
    VERIFY_ANSWERS_REQUIRED,
)

log = logging.getLogger(__name__)

LOCKED = "locked"


# --------------------------------------------------------------------------- #
# Startup validation: log a warning if any configured LCD line is too long
# --------------------------------------------------------------------------- #
def _validate_lcd_text():
    entry_worst = "[9] 9  9  9 "
    fills = {
        "code": {"code": "9" * OTP_LENGTH},
        "entering": {"secs": OTP_TTL_S, "entry": entry_worst},
        "wrong_code": {"left": MAX_OTP_ATTEMPTS},
    }
    for state, lines in LCD_STATUS.items():
        for i, line in enumerate(lines):
            text = line.format(**fills.get(state, {}))
            if len(text) > LCD_MAX_LEN:
                log.warning("Tower LCD text LCD_STATUS.%s[%d] is %d chars (max %d): %r",
                            state, i, len(text), LCD_MAX_LEN, text)


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


def _words(text):
    """Lowercase alphanumeric words, with possessives folded ("dog's" -> "dog")."""
    text = re.sub(r"['’]s\b", "", str(text or "").lower())
    return re.findall(r"[a-z0-9]+", text)


def _lookup_fact(question):
    """The ACCOUNT_FACTS key whose words all appear in the question, or None."""
    asked = set(_words(question))
    for key in ACCOUNT_FACTS:
        if set(_words(key)) <= asked:
            return key
    return None


class TowerChallenge:
    """status: idle | ringing | verify | code | entering | done | alarm."""

    def __init__(self, rng=None):
        # SystemRandom: the OTP must not be predictable from earlier codes.
        self._rng = rng or random.SystemRandom()
        self._reset_state()

        self._display_mode = "normal"   # "normal" | "event"
        self._display_until = 0.0
        self._event_text = None
        self._flash_schedule = []   # [(at, (r,g,b))]
        self._beep_schedule = []    # [(at, ms)]

        self._cmds = []
        self._lcd_throttle = ChangeThrottle(LCD_MIN_SEND_INTERVAL_S)
        self._rgb_throttle = ChangeThrottle(RGB_MIN_SEND_INTERVAL_S)
        self._led_red = None
        self._led_green = None

    def _reset_state(self):
        self.status = "idle"
        self.identity_verified = False
        self.answered = frozenset()       # ACCOUNT_FACTS keys answered correctly
        self.suspicion = 0
        self.alarm_reason = None

        self.otp = None                   # server-side only; never in a snapshot
        self.otp_status = "none"          # none | sent | verified | expired | burned
        self.otp_expires_at = 0.0
        self.code_shown_until = 0.0
        self.attempts_left = MAX_OTP_ATTEMPTS
        self.entry = (0,) * OTP_LENGTH
        self.cursor = 0
        self.verified_code = None         # the spent code, kept once the vault opens

    # ------------------------------------------------------------------ #
    # Admin / lifecycle
    # ------------------------------------------------------------------ #
    def start(self, now):
        """First entry (or admin reset): a fresh call, waiting for the phone."""
        self._reset_state()
        self._enter_ringing(now)
        self._flush(now, force=True)
        return []

    def reset(self, now):
        """Admin: restart the whole run from scratch."""
        return self.start(now)

    def skip(self, now):
        """Admin: jump straight to TOWER_DONE."""
        self.identity_verified = True
        self.verified_code = self.verified_code or self.otp or self._new_code()
        self._enter_done(now)
        self._flush(now, force=True)
        return ["done"]

    @property
    def active(self):
        return self.status != "idle"

    @property
    def verified(self):
        """True only once the code was correctly entered on the vault joystick."""
        return self.otp_status == "verified"

    # ------------------------------------------------------------------ #
    # Input from the Pi (joystick / button)
    # ------------------------------------------------------------------ #
    def handle_input(self, device, value, now):
        events = []
        if self.status != "entering":
            return events
        if device == "joystick":
            move = normalize_joystick(value)
            if move in MOVES:
                self._edit_entry(move)
        elif device == "button" and value:
            events += self._submit(now)
        events += self._advance_display(now)
        self._flush(now)
        return events

    def _edit_entry(self, move):
        if move in ("up", "down"):
            step = 1 if move == "up" else -1
            digit = (self.entry[self.cursor] + step) % 10
            self.entry = self.entry[:self.cursor] + (digit,) + self.entry[self.cursor + 1:]
        elif move == "left":
            self.cursor = max(0, self.cursor - 1)
        elif move == "right":
            self.cursor = min(OTP_LENGTH - 1, self.cursor + 1)

    def _submit(self, now):
        if now >= self.otp_expires_at:
            return self._expire(now)
        guess = "".join(str(d) for d in self.entry)
        if hmac.compare_digest(guess, self.otp):
            self.otp_status = "verified"
            self.verified_code = self.otp
            self._enter_done(now)
            return ["done"]

        self.attempts_left -= 1
        self._queue_beep(BEEP_WRONG_MS, now)
        if self.attempts_left <= 0:
            return ["wrong_code", "burned"] + self._burn(now)
        self._trigger_event(*self._lcd_pair("wrong_code", left=self.attempts_left), now, flash=True)
        return ["wrong_code"]

    def _burn(self, now):
        """Too many wrong entries: the code is dead and the bank gets twitchy."""
        self.otp, self.otp_status = None, "burned"
        self._enter_verify(now)
        self._trigger_event(*LCD_STATUS["burned"], now, flash=True)
        return self._add_suspicion(SUSPICION_BURNED_OTP, "one-time code burned", now)

    def _expire(self, now):
        self.otp, self.otp_status = None, "expired"
        self._enter_verify(now)
        self._trigger_event(*LCD_STATUS["expired"], now, flash=True)
        return ["expired"]

    def tick(self, now):
        """Call every ~100ms: takes the code off the screen, expires the OTP and
        advances event messages even when no new `input` event has arrived."""
        if not self.active:
            return []
        events = []
        if self.status == "code" and now >= self.code_shown_until:
            self._enter_entering(now)
        if self.status in ("code", "entering") and self.otp_status == "sent" and now >= self.otp_expires_at:
            events += self._expire(now)
        events += self._advance_display(now)
        self._flush(now)
        return events

    # ------------------------------------------------------------------ #
    # Margaret's webhook tools (ElevenLabs agent). Each returns a short string
    # she can speak, plus the events for the socket layer. NONE of them ever
    # returns the code.
    # ------------------------------------------------------------------ #
    def _begin_call(self, now):
        """A call came in. Returns True if the vault is closed to further calls
        (already open, or the alarm is on)."""
        if self.status == "idle":
            self.start(now)
        if self.status == "ringing":
            self._enter_verify(now)
            self._flush(now)
        return self.status in ("done", "alarm")

    def agent_verify(self, question, answer, now):
        """Checks one account-security answer. Returns ("correct"|"wrong", events)."""
        if self._begin_call(now):
            return LOCKED, []
        key = _lookup_fact(question)
        given = " ".join(_words(answer))
        if key is not None and given and " ".join(_words(ACCOUNT_FACTS[key])) in given:
            self.answered = self.answered | {key}
            if len(self.answered) >= VERIFY_ANSWERS_REQUIRED:
                self.identity_verified = True
            return "correct", []
        return "wrong", self._add_suspicion(SUSPICION_WRONG_ANSWER, "wrong account answer", now)

    def agent_override(self, phrase, now):
        """Checks the staff override phrase. Returns ("OVERRIDE ACCEPTED"|"OVERRIDE DENIED", events)."""
        if self._begin_call(now):
            return LOCKED, []
        if " ".join(_words(SECRET_PHRASE)) in " ".join(_words(phrase)):
            self.identity_verified = True
            return "OVERRIDE ACCEPTED", []
        return "OVERRIDE DENIED", self._add_suspicion(SUSPICION_DENIED_OVERRIDE, "bad override phrase", now)

    def agent_send_otp(self, now):
        """Generates the code and pushes it to the vault LCD. Returns
        ("code sent", events) - the code itself goes ONLY to the Pi."""
        if self._begin_call(now):
            return LOCKED, []
        if not self.identity_verified:
            return "identity not verified", []
        if self.otp_status == "sent":
            return "code already sent", []
        self.otp = self._new_code()
        self.otp_status = "sent"
        self.otp_expires_at = now + OTP_TTL_S
        self.code_shown_until = now + OTP_DISPLAY_S
        self.attempts_left = MAX_OTP_ATTEMPTS
        self.entry, self.cursor = (0,) * OTP_LENGTH, 0
        self._enter_code(now)
        self._flush(now, force=True)
        return "code sent", ["code_sent"]

    def agent_raise_suspicion(self, amount, reason, now):
        """Margaret's own hunch that something's off. Returns (message, events);
        events contains "alarm" once the threshold is crossed."""
        if self._begin_call(now):
            return LOCKED, []
        try:
            amount = int(amount)
        except (TypeError, ValueError):
            amount = 0
        events = self._add_suspicion(max(0, min(amount, MAX_SUSPICION_PER_CALL)), reason or "agent suspicion", now)
        self._flush(now)
        return ("alarm triggered" if "alarm" in events else "noted"), events

    def agent_approve_transfer(self, amount, now):
        """Returns (ok, message, amount). Refused unless the code was already
        entered correctly on the vault - Margaret can't skip the check."""
        if not self.verified:
            return False, "not verified", 0
        try:
            amount = int(amount)
        except (TypeError, ValueError):
            amount = 0
        amount = max(0, min(amount, MAX_TRANSFER))
        return True, f"approved {amount}", amount

    def agent_trigger_alarm(self, reason, now):
        """Returns (message, events)."""
        if self.status == "done":
            return LOCKED, []
        if self.status == "idle":
            self.start(now)
        events = self._enter_alarm(now, reason or "alarm triggered by the bank")
        self._flush(now)
        return "alarm triggered", events

    def _new_code(self):
        return "".join(str(self._rng.randrange(10)) for _ in range(OTP_LENGTH))

    def _add_suspicion(self, amount, reason, now):
        if self.status in ("done", "alarm"):
            return []
        self.suspicion += amount
        if self.suspicion >= SUSPICION_ALARM_THRESHOLD:
            return self._enter_alarm(now, reason)
        return []

    # ------------------------------------------------------------------ #
    # Substage transitions
    # ------------------------------------------------------------------ #
    def _enter_ringing(self, now):
        self.status = "ringing"
        self._led_set(red=True, green=False)
        self._reset_display(now)

    def _enter_verify(self, now):
        self.status = "verify"
        self._led_set(red=False, green=False)
        self._reset_display(now)

    def _enter_code(self, now):
        self.status = "code"
        self._led_set(red=False, green=False)
        self._reset_display(now)
        self._queue_beep(BEEP_CODE_MS, now)

    def _enter_entering(self, now):
        self.status = "entering"
        self._reset_display(now)

    def _enter_done(self, now):
        self.status = "done"
        self.otp_status = "verified"
        self.otp = None
        self._led_set(red=False, green=True)
        self._reset_display(now)
        self._queue_victory_beeps(now)
        if SERVO_OPEN_ON_DONE:
            self._cmds.append({"type": "servo", "state": "open"})

    def _enter_alarm(self, now, reason):
        self.status = "alarm"
        self.alarm_reason = reason
        self.otp, self.otp_status = None, "none"
        self._led_set(red=True, green=False)
        self._reset_display(now)
        self._queue_beep(BEEP_ALARM_MS, now)
        return ["alarm"]

    # ------------------------------------------------------------------ #
    # Display: normal status, with event messages interrupting
    # ------------------------------------------------------------------ #
    @staticmethod
    def _lcd_pair(state, **fill):
        return tuple(line.format(**fill) for line in LCD_STATUS[state])

    def _entry_text(self):
        return "".join(f"[{d}]" if i == self.cursor else f" {d} " for i, d in enumerate(self.entry))

    def _normal_text(self, now):
        if self.status == "code":
            return self._lcd_pair("code", code=self.otp)
        if self.status == "entering":
            secs = max(0, math.ceil(self.otp_expires_at - now))
            return self._lcd_pair("entering", secs=secs, entry=self._entry_text())
        return self._lcd_pair(self.status if self.active else "idle")

    def _reset_display(self, now):
        self._display_mode = "normal"
        self._display_until = now
        self._event_text = None
        self._flash_schedule = []

    def _trigger_event(self, line1, line2, now, duration=EVENT_MESSAGE_S, flash=False):
        self._display_mode = "event"
        self._event_text = (line1, line2)
        self._display_until = now + duration
        self._flash_schedule = []
        if flash:
            for i in range(FLASH_COUNT):
                self._flash_schedule.append((now + 2 * i * FLASH_STEP_S, COLOR_FLASH_ON))
                self._flash_schedule.append((now + (2 * i + 1) * FLASH_STEP_S, COLOR_FLASH_OFF))

    def _advance_display(self, now):
        """Clears an expired event message."""
        if self._display_mode == "event" and now >= self._display_until:
            self._reset_display(now)
        return []

    def _current_lcd_text(self, now):
        if self._display_mode == "event":
            return self._event_text
        return self._normal_text(now)

    def _current_rgb(self, now):
        for at, color in self._flash_schedule:
            if at <= now <= at + FLASH_STEP_S:
                return color
        return {
            "idle": COLOR_IDLE, "ringing": COLOR_RINGING, "verify": COLOR_VERIFY,
            "code": COLOR_CODE, "entering": COLOR_ENTERING, "done": COLOR_DONE,
            "alarm": COLOR_ALARM,
        }.get(self.status, COLOR_IDLE)

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

    def _flush(self, now, force=False):
        due, pending = [], []
        for at, ms in self._beep_schedule:
            (due if at <= now else pending).append((at, ms))
        self._beep_schedule = pending
        for _, ms in due:
            self._cmds.append({"type": "beep", "ms": ms})

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
    # Snapshots pushed to clients. The code is NEVER included: while it is on
    # the vault screen the LCD preview is masked.
    # ------------------------------------------------------------------ #
    def _public_lcd_text(self, now):
        line1, line2 = self._current_lcd_text(now)
        if self.status == "code" and self._display_mode == "normal":
            line2 = "*" * OTP_LENGTH
        return [line1, line2]

    def snapshot(self, now, include_hacker=False):
        remaining = None
        if self.otp_status == "sent":
            remaining = max(0, math.ceil(self.otp_expires_at - now))
        snap = {
            "substage": f"TOWER_{self.status.upper()}" if self.active else "TOWER_IDLE",
            "otpStatus": self.otp_status,
            "otpRemainingS": remaining,
            "attemptsLeft": self.attempts_left,
            "suspicion": self.suspicion,
            "identityVerified": self.identity_verified,
            "entry": list(self.entry) if self.status == "entering" else None,
            "cursor": self.cursor if self.status == "entering" else None,
            "currentLcdText": self._public_lcd_text(now) if self.active else ["", ""],
        }
        if include_hacker:
            snap["briefing"] = BRIEFING
            snap["otpLength"] = OTP_LENGTH
        return snap
