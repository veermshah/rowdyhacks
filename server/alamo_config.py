"""Alamo vault challenge: every tunable in one place.

Minimal flow: cover the camera (a light sensor) -> repeat a 4-move joystick
sequence -> type the keyword the vault speaks. No rounds, no hints, no
heat/wanted-level penalty - just the three steps, kept deliberately simple.

Player-facing text calls the light sensor "the camera" (it's a story name -
there is no real camera). Code keeps the literal name (lightSensorCovered,
BLIND_BELOW, ...) so the hardware is never ambiguous to a future reader.
"""

# --- Light sensor ("the camera") hysteresis -----------------------------------
BLIND_BELOW = 150            # reading must stay below this...
BLIND_HOLD_S = 1.0           # ...continuously for this long to count as BLIND (covered)
SPOTTED_ABOVE = 200          # reading must stay above this...
SPOTTED_HOLD_S = 0.5         # ...continuously for this long to count as SPOTTED (uncovered)

# --- The joystick sequence ------------------------------------------------------
SEQUENCE_LENGTH = 4           # one fixed-length sequence, generated randomly per run
KEYWORDS = ("ALAMO", "BADGER", "CANYON", "DESERT", "FALCON", "MESA", "RANGER", "SUNSET")
MOVE_DISPLAY_S = 0.8          # how long each move word shows on the LCD
MOVE_GAP_S = 0.3              # blank gap between move words
BLIND_TRANSITION_S = 1.5      # "CAMERA BLIND / WATCH CLOSELY" message before the sequence plays
WRONG_MOVE_PAUSE_S = 1.5      # "WRONG MOVE" message before the sequence replays

# --- Beeps (ms) ---------------------------------------------------------------
BEEP_SHORT_MS = 80             # correct move, and each move as the sequence plays
BEEP_WRONG_MS = 400
BEEP_VICTORY_PATTERN_MS = [100, 100, 100, 100, 300]
BEEP_VICTORY_GAP_S = 0.08

# --- Display timing -----------------------------------------------------------
EVENT_MESSAGE_S = 2.0         # spotted / wrong code message hold
FLASH_COUNT = 2               # red flashes on wrong move / spotted
FLASH_STEP_S = 0.2            # duration of each flash phase (on, then off)

LCD_MAX_LEN = 16
LCD_MIN_SEND_INTERVAL_S = 0.25   # throttle: at most 4 LCD commands/sec
RGB_MIN_SEND_INTERVAL_S = 0.25   # throttle: at most 4 RGB commands/sec

# --- Backlight colors (r, g, b), 0-255 ---------------------------------------
COLOR_COVER = (255, 0, 0)       # waiting for the camera to be blinded
COLOR_PHASE1 = (0, 80, 255)     # camera blind: showing the sequence / player's turn
COLOR_DONE = (0, 255, 0)        # ALAMO_DONE
COLOR_CODE = (255, 140, 0)      # code revealed, waiting for entry
COLOR_FLASH_ON = (255, 0, 0)
COLOR_FLASH_OFF = (0, 0, 0)

# --- Joystick orientation ----------------------------------------------------
# The joystick may be mounted rotated or mirrored inside the vault. Fix it here
# instead of rewiring: swaps apply first, then rotation (clockwise, degrees).
JOYSTICK_ORIENTATION = {
    "swap_up_down": False,
    "swap_left_right": False,
    "rotate": 0,  # one of 0, 90, 180, 270
}

BRIEFING = (
    "A hidden vault in the Alamo is guarded by a security camera. Your "
    "safecracker has to keep it blinded while repeating the vault's unlock "
    "pattern on the joystick. Once it's cracked, the vault will show a "
    "spoken keyword - type it in to finish the job."
)

# --- Vault LCD status lines (never the sequence; {..} filled at runtime) ------
LCD_STATUS = {
    "cover": ("CAMERA ACTIVE", "THEY SEE YOU"),
    "just_blind": ("CAMERA BLIND", "WATCH CLOSELY"),
    "show": ("UNLOCK VAULT", "{move}"),
    "input": ("YOUR TURN", "MOVE {progress}/{total}"),
    "wrong_move": ("WRONG MOVE", "WATCH AGAIN"),
    "spotted": ("SPOTTED!", "COVER THE CAMERA"),
    "code": ("SAY KEYWORD", "TYPE ON SITE"),
    "wrong_code": ("ACCESS DENIED", "TRY AGAIN"),
    "done": ("ALAMO CLEARED", "VAULT UNLOCKED"),
}

# Set True to also pop the vault's physical lock on ALAMO_DONE.
SERVO_OPEN_ON_DONE = True
