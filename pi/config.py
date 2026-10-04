"""Environment-driven settings for the Alamo vault Raspberry Pi relay.

Everything lives here so the relay and the systemd unit can be tuned with a
single .env file instead of editing code.
"""
import os

from dotenv import load_dotenv

load_dotenv()


def _int(name, default):
    return int(os.getenv(name, str(default)))


def _bool(name, default=False):
    return os.getenv(name, str(default)).strip().lower() in ("1", "true", "yes", "on")


SERIAL_PORT = os.getenv("ALAMO_SERIAL_PORT", "/dev/ttyACM0")
BAUD_RATE = _int("ALAMO_BAUD_RATE", 9600)

SERVER_URL = os.getenv("ALAMO_SERVER_URL", "http://localhost:5000")
CAR_ID = os.getenv("ALAMO_CAR_ID", "solo")
# Render's free proxy reliably supports Socket.IO polling. Keep WebSocket as
# an opt-in because a failed upgrade can look like a failed initial connect.
SOCKETIO_TRANSPORT = os.getenv("ALAMO_SOCKETIO_TRANSPORT", "polling").strip().lower()
if SOCKETIO_TRANSPORT not in ("polling", "websocket"):
    raise ValueError("ALAMO_SOCKETIO_TRANSPORT must be 'polling' or 'websocket'")

# Matches the dead-zone the Arduino sketch already uses for its own
# joystick-follow servo logic (see alamo_vault.ino).
JOYSTICK_CENTER_LOW = _int("ALAMO_JOY_CENTER_LOW", 460)
JOYSTICK_CENTER_HIGH = _int("ALAMO_JOY_CENTER_HIGH", 565)
JOYSTICK_SWAP_AXES = _bool("ALAMO_JOY_SWAP_AXES")
JOYSTICK_INVERT_X = _bool("ALAMO_JOY_INVERT_X", True)
# This joystick's Y axis is electrically reversed: physical down reads as up.
JOYSTICK_INVERT_Y = _bool("ALAMO_JOY_INVERT_Y", True)
TTS_COMMAND = os.getenv("ALAMO_TTS_COMMAND", "espeak-ng").strip()
TTS_LEAD_IN_S = float(os.getenv("ALAMO_TTS_LEAD_IN_S", "0.6"))
TTS_AUDIO_SINK = os.getenv("ALAMO_TTS_AUDIO_SINK", "").strip()

# Only re-emit the light reading once it moves by at least this much, so a
# noisy ADC doesn't flood the socket every ~150ms.
LIGHT_MIN_SEND_DELTA = _int("ALAMO_LIGHT_DELTA", 4)

# Degrees the servo moves to when the server sends {"type": "servo", "state": "open"}.
SERVO_OPEN_ANGLE = _int("ALAMO_SERVO_OPEN_ANGLE", 170)
SERVO_CLOSED_ANGLE = _int("ALAMO_SERVO_CLOSED_ANGLE", 10)

RECONNECT_DELAY_S = 2.0
