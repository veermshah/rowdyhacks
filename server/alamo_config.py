"""Alamo vault challenge: every tunable in one place.

Thresholds, timings, puzzle sets/facts, all LCD/hint text, backlight colors,
and the joystick orientation mapping. Change behavior here, not in
alamo_challenge.py.

Player-facing text calls the light sensor "the camera" (it's a story name -
there is no real camera). Code keeps the literal name (lightSensorCovered,
BLIND_BELOW, ...) so the hardware is never ambiguous to a future reader.
"""

# --- Light sensor ("the camera") hysteresis -----------------------------------
BLIND_BELOW = 100            # reading must stay below this...
BLIND_HOLD_S = 1.0           # ...continuously for this long to count as BLIND (covered)
SPOTTED_ABOVE = 150          # reading must stay above this...
SPOTTED_HOLD_S = 0.5         # ...continuously for this long to count as SPOTTED (uncovered)

# --- Phase 1: Simon-Says memory rounds ----------------------------------------
ROUND_LENGTHS = [3, 4, 5]    # one sequence length per round, in order
MOVE_DISPLAY_S = 0.8         # how long each move word shows on the LCD
MOVE_GAP_S = 0.3             # blank gap between move words
BLIND_TRANSITION_S = 1.5     # "CAMERA BLIND / WATCH CLOSELY" message before a sequence plays
WRONG_MOVE_PAUSE_S = 1.5     # "WRONG MOVE" message before the sequence replays

# --- Beeps (ms) ---------------------------------------------------------------
BEEP_SHORT_MS = 80            # correct move, and each move as the sequence plays
BEEP_WRONG_MS = 400
BEEP_VICTORY_PATTERN_MS = [100, 100, 100, 100, 300]
BEEP_VICTORY_GAP_S = 0.08

# --- Display timing -----------------------------------------------------------
EVENT_MESSAGE_S = 2.0         # spotted / wrong code / phase-1-complete message hold
FLASH_COUNT = 2               # red flashes on wrong move / spotted
FLASH_STEP_S = 0.2            # duration of each flash phase (on, then off)
LCD_NORMAL_CYCLE_S = 6.0      # normal status display time in the hint-cycling loop
LCD_HINT_CYCLE_S = 4.0        # hint display time in the hint-cycling loop

LCD_MAX_LEN = 16
LCD_MIN_SEND_INTERVAL_S = 0.25   # throttle: at most 4 LCD commands/sec
RGB_MIN_SEND_INTERVAL_S = 0.25   # throttle: at most 4 RGB commands/sec

# --- Backlight colors (r, g, b), 0-255 ---------------------------------------
COLOR_COVER = (255, 0, 0)       # waiting for the camera to be blinded
COLOR_PHASE1 = (0, 80, 255)     # camera blind: showing a sequence / player's turn
COLOR_DONE = (0, 255, 0)        # phase 1 complete + ALAMO_DONE
COLOR_CODE = (255, 140, 0)      # phase 2: code pieces shown
COLOR_HINT = (255, 140, 0)
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

# --- Heat costs ----------------------------------------------------------------
WRONG_MOVE_HEAT = 1
SPOTTED_HEAT = 1
WRONG_CODE_HEAT = 1
HINT_REQUEST_HEAT = 1

# --- Hint timers ----------------------------------------------------------------
# Camera hints: elapsed time since the challenge started (not reset by COVER
# re-entries after a spotted event), only shown while waiting to be blinded.
CAMERA_HINT_TIMERS_S = [20, 40, 60]
# Memory hints: NOT time-based - both unlock together once this many failed
# attempts (wrong move or spotted) have happened on the current round.
MEMORY_HINT_TRIGGER_MISTAKES = 2
# Code hints: elapsed time since Phase 2 (ALAMO_CODE) was entered.
CODE_HINT_TIMERS_S = [30, 60, 90]

# --- Hints: a screen version (hacker) and an optional LCD version (safecracker,
# never contains directions/answers) for each -----------------------------------
CAMERA_HINTS = [
    {"screen": "The vault's camera only works when it can see light.",
     "lcd": ("THE CAMERA NEEDS", "LIGHT TO SEE")},
    {"screen": "Look for the camera label on the vault.",
     "lcd": ("FIND THE CAMERA", "ON THE VAULT")},
    {"screen": "Cover the camera (light sensor) with one hand and keep it covered.",
     "lcd": ("COVER THE CAMERA", "WITH YOUR HAND")},
]
MEMORY_HINTS = [
    {"screen": "Keep the camera covered the whole time, even while the pattern plays.",
     "lcd": ("KEEP IT COVERED", "THE WHOLE TIME")},
    {"screen": "Tell your safecracker to say each move out loud as it appears.",
     "lcd": ("SAY IT OUT LOUD", "AS IT PLAYS")},
]
CODE_HINTS = [
    {"screen": "Each letter matches a highlighted name or event in the Archive.",
     "lcd": ("READ THE PIECES", "TO YOUR HACKER")},
    {"screen": "Put the pieces in order of when they happened, earliest first."},
    {"screen": "Highlight the dates in the Archive.", "highlightDates": True},
]

BRIEFING = (
    "A hidden vault in the Alamo is guarded by a security camera. Your "
    "safecracker must keep it blinded while repeating the vault's unlock "
    "pattern. Then the vault will reveal the code pieces, and only the "
    "Archive can tell you their order. Remember the Alamo."
)

# --- Vault LCD status lines (never the sequence/code; {..} filled at runtime) --
LCD_STATUS = {
    "cover": ("CAMERA ACTIVE", "THEY SEE YOU"),
    "just_blind": ("CAMERA BLIND", "WATCH CLOSELY"),
    "show": ("ROUND {round}/{total}", "{move}"),
    "input": ("YOUR TURN", "MOVE {progress}/{total}"),
    "wrong_move": ("WRONG MOVE", "WATCH AGAIN"),
    "spotted": ("SPOTTED!", "COVER THE CAMERA"),
    "phase1_done": ("PATTERN ACCEPTED", ""),
    "code": ("CODE PIECES:", "{pieces}"),
    "wrong_code": ("ACCESS DENIED", "TRY AGAIN"),
    "done": ("ALAMO CLEARED", "VAULT UNLOCKED"),
}

# --- Phase 2: order-the-code-pieces puzzle sets --------------------------------
# Tags are listed in correct chronological order - that list order IS the
# answer key, so the server never needs a separate "correct order" field.
PUZZLE_SETS = [
    {
        "key": "A",
        "title": "Who arrived first",
        "tags": [
            {"tag": "B", "text": "**Jim Bowie** rode into the Alamo on **January 19, 1836**, "
                                  "sent by Sam Houston to assess the fort."},
            {"tag": "T", "text": "**Lt. Col. William B. Travis** arrived on **February 3, 1836**, "
                                  "with about 30 men."},
            {"tag": "C", "text": "**Davy Crockett** and a group of Tennessee volunteers arrived "
                                  "around **February 8, 1836**."},
            {"tag": "S", "text": "**General Antonio Lopez de Santa Anna's** army reached San "
                                  "Antonio on **February 23, 1836**, and the siege began."},
        ],
    },
    {
        "key": "B",
        "title": "The building's story",
        "tags": [
            {"tag": "M", "text": "In **1718**, the Alamo was founded as the **Mission San "
                                  "Antonio de Valero**."},
            {"tag": "B", "text": "In **1836**, the Alamo was the site of a 13-day siege and "
                                  "battle, from February 23 to March 6."},
            {"tag": "H", "text": "In **1850**, the U.S. Army repaired the church and added the "
                                  "curved 'hump' to its famous facade."},
            {"tag": "D", "text": "In **1905**, the State of Texas placed the Alamo in the care "
                                  "of the **Daughters of the Republic of Texas**."},
        ],
    },
    {
        "key": "C",
        "title": "Thirteen days",
        "tags": [
            {"tag": "S", "text": "**February 23, 1836**: the siege of the Alamo begins."},
            {"tag": "L", "text": "**February 24, 1836**: Travis writes his famous letter 'To "
                                  "the People of Texas & All Americans in the World,' signed "
                                  "'Victory or Death.'"},
            {"tag": "G", "text": "**March 1, 1836**: about 32 men from Gonzales slip through "
                                  "enemy lines to join the defenders."},
            {"tag": "F", "text": "**March 6, 1836**: the Alamo falls in a final dawn assault."},
        ],
    },
]

# Shown with every set, untagged - not part of the puzzle, just flavor/misdirection.
DISTRACTOR_FACTS = [
    "'Alamo' is Spanish for cottonwood tree.",
    "'Remember the Alamo!' became a battle cry at San Jacinto on **April 21, 1836**.",
]

# Set True to also pop the vault's physical lock on ALAMO_DONE.
SERVO_OPEN_ON_DONE = False
