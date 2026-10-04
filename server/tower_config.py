"""Tower of the Americas challenge (Challenge 3 - "The Callback"): every tunable in one place.

The crew phones the bank's fraud line (an ElevenLabs voice agent, "Margaret"),
passes as account holder Jordan Mercer (or says the staff override phrase),
and Margaret "sends a one-time code to the device on file". The SERVER makes
that code and pushes it to the vault LCD for a few seconds; the crew reads it
off the screen and keys it in on the joystick before it expires.

The OTP is generated and checked only on the server. Margaret never sees it.
"""

# --- One-time code ------------------------------------------------------------
OTP_LENGTH = 4
OTP_TTL_S = 30               # code is valid this long after it is sent
OTP_DISPLAY_S = 8            # ...but is only on the vault LCD for this long
MAX_OTP_ATTEMPTS = 3         # wrong entries before the code is burned

# --- Suspicion / alarm --------------------------------------------------------
SUSPICION_ALARM_THRESHOLD = 100
SUSPICION_WRONG_ANSWER = 20      # a wrong account answer
SUSPICION_DENIED_OVERRIDE = 35   # a wrong staff override phrase
SUSPICION_BURNED_OTP = 40        # an OTP burned by too many wrong entries
MAX_SUSPICION_PER_CALL = 100     # cap on what a single raiseSuspicion call can add

# --- Payout -------------------------------------------------------------------
TOWER_REWARD = 12_000
TOWER_WANTED_ON_CLEAR = 2
TOWER_WANTED_ON_ALARM = 2
MAX_TRANSFER = 50_000            # approveTransfer is capped at this

# --- Identity (what Margaret checks; she is told the answers by her prompt, ----
# --- but the SERVER decides correct/wrong) ------------------------------------
HOLDER_NAME = "Jordan Mercer"
ACCOUNT_FACTS = {
    "dog name": "Biscuit",
    "hometown": "Dayton",
    "last four": "7742",
    "recent purchase": "concert tickets",
    "employer": "Delmont Logistics",
}
VERIFY_ANSWERS_REQUIRED = 2      # distinct correct answers to prove identity
SECRET_PHRASE = "silver armadillo"   # staff override phrase

# --- Beeps (ms) ---------------------------------------------------------------
BEEP_SHORT_MS = 80
BEEP_CODE_MS = 200               # a code was just sent to the vault
BEEP_WRONG_MS = 400
BEEP_ALARM_MS = 800
BEEP_VICTORY_PATTERN_MS = [100, 100, 100, 100, 300]
BEEP_VICTORY_GAP_S = 0.08

# --- Display timing -----------------------------------------------------------
EVENT_MESSAGE_S = 2.0         # wrong code / expired / burned message hold
FLASH_COUNT = 2
FLASH_STEP_S = 0.2

LCD_MAX_LEN = 16
LCD_MIN_SEND_INTERVAL_S = 0.25   # throttle: at most 4 LCD commands/sec
RGB_MIN_SEND_INTERVAL_S = 0.25   # throttle: at most 4 RGB commands/sec

# --- Backlight colors (r, g, b), 0-255 ---------------------------------------
COLOR_IDLE = (80, 80, 80)
COLOR_RINGING = (255, 0, 0)
COLOR_VERIFY = (0, 80, 255)
COLOR_CODE = (255, 140, 0)
COLOR_ENTERING = (255, 220, 0)
COLOR_DONE = (0, 255, 0)
COLOR_ALARM = (255, 0, 0)
COLOR_FLASH_ON = (255, 0, 0)
COLOR_FLASH_OFF = (0, 0, 0)

# --- Joystick orientation (same convention as alamo_config) ------------------
JOYSTICK_ORIENTATION = {
    "swap_up_down": False,
    "swap_left_right": False,
    "rotate": 0,  # one of 0, 90, 180, 270
}

# Set True to pop the vault's physical lock when the code is accepted.
SERVO_OPEN_ON_DONE = True

BRIEFING = (
    "The Tower of the Americas holds bearer bonds behind a bank-grade vault "
    "lock. Phone the bank's fraud line and talk Margaret into believing "
    "you're account holder Jordan Mercer - or find the staff override phrase. "
    "She'll send a one-time code to the device on file: the vault's screen. "
    "Read it off, then key it in on the joystick (up/down = digit, "
    "left/right = position, press = submit) before it expires."
)

# --- Vault LCD status lines (<=16 chars each; {..} filled at runtime) ---------
LCD_STATUS = {
    "idle": ("TOWER VAULT", "LOCKED"),
    "ringing": ("CALL THE BANK", "ASK FOR MARGARET"),
    "verify": ("VERIFYING...", "STAY ON LINE"),
    "code": ("CODE:", "{code}"),
    "entering": ("ENTER CODE {secs:>2}s", "{entry}"),
    "wrong_code": ("WRONG CODE", "{left} LEFT"),
    "expired": ("CODE EXPIRED", "ASK FOR NEW"),
    "burned": ("CODE BURNED", "CALL AGAIN"),
    "alarm": ("ALARM!", "POLICE COMING"),
    "done": ("TOWER CLEARED", "VAULT UNLOCKED"),
}
