"""Raspberry Pi hardware relay for the vault rig (Alamo + Tower challenges).

Runs on the Pi, reads the Arduino Uno over USB serial, and speaks the fixed
Pi wire protocol described in server/alamo_challenge.py:
  - emits Socket.IO `input` events: {"device": "joystick"|"light"|"button", "value": ...}
    (the joystick button is emitted once per press, for the Tower's code submit)
  - receives Socket.IO `cmd` events: {"type": "lcd"|"rgb"|"led"|"beep"|"servo", ...}
    and relays the ones we have hardware for (lcd, servo) to the Arduino
    over the same serial link. rgb/led/beep have no wired actuator on this
    shield, so they're logged and dropped rather than half-implemented.

Start on boot via the included systemd unit (alamo-pi.service) so the relay
is always running before anyone opens the game in a browser.
"""
import logging
import shutil
import subprocess
import threading
import time

import socketio

import config
from joystick import JoystickClassifier
from serial_link import SerialLink

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("alamo_pi")

sio = socketio.Client(reconnection=True, reconnection_delay=2, reconnection_delay_max=10)
link = SerialLink(config.SERIAL_PORT, config.BAUD_RATE, config.RECONNECT_DELAY_S)
joystick = JoystickClassifier(
    config.JOYSTICK_CENTER_LOW,
    config.JOYSTICK_CENTER_HIGH,
    config.JOYSTICK_SWAP_AXES,
    config.JOYSTICK_INVERT_X,
    config.JOYSTICK_INVERT_Y,
)

_last_sent_light = None
_last_button = False


def _speak(text):
    if not text:
        return
    executable = shutil.which(config.TTS_COMMAND)
    if executable is None:
        log.error(
            "Cannot speak keyword: %r is not installed. Install espeak-ng or set ALAMO_TTS_COMMAND.",
            config.TTS_COMMAND,
        )
        return
    log.info("Received speak command; playing keyword through %s", config.TTS_COMMAND)
    threading.Thread(
        target=subprocess.run,
        args=([executable, text],),
        kwargs={"check": False, "stdout": subprocess.DEVNULL, "stderr": subprocess.PIPE},
        daemon=True,
    ).start()


@sio.event
def connect():
    log.info("Connected to %s, joining as Pi relay for car %r", config.SERVER_URL, config.CAR_ID)
    sio.emit("join_car", {"carId": config.CAR_ID, "role": "pi"})


@sio.event
def disconnect():
    log.warning("Disconnected from server")


@sio.on("cmd")
def on_cmd(data):
    """Server -> Pi actuator command. Translated to one serial command line."""
    cmd_type = (data or {}).get("type")
    log.info("Received server command: %s", cmd_type or "unknown")
    if cmd_type == "lcd":
        line1 = (data.get("line1") or "")[:16]
        line2 = (data.get("line2") or "")[:16]
        link.send_command(f"LCD:{line1}|{line2}")
    elif cmd_type == "servo":
        angle = config.SERVO_OPEN_ANGLE if data.get("state") == "open" else config.SERVO_CLOSED_ANGLE
        link.send_command(f"SERVO:{angle}")
    elif cmd_type == "speak":
        _speak(str(data.get("text") or "").strip())
    elif cmd_type in ("rgb", "led", "beep"):
        log.debug("Dropping %r cmd - no %s hardware wired on this shield", cmd_type, cmd_type)
    else:
        log.warning("Unknown cmd type %r", cmd_type)


def _serial_loop():
    """Runs forever on a background thread: blocks on serial reads, converts
    readings to the Pi wire protocol, and emits them over Socket.IO.
    """
    global _last_sent_light, _last_button
    while True:
        reading = link.read_reading()
        if reading is None:
            continue

        move = joystick.classify(reading["x"], reading["y"])
        log.info(
            "Sensors: X=%d Y=%d Light=%d Servo=%d Button=%s%s",
            reading["x"],
            reading["y"],
            reading["light"],
            reading["servo"],
            "pressed" if reading["button"] else "released",
            f" Move={move}" if move is not None else "",
        )
        if move is not None:
            log.info("Joystick x=%d y=%d -> %s", reading["x"], reading["y"], move)
            if sio.connected:
                sio.emit("input", {"device": "joystick", "value": move})

        # Press edge only (not every ~150ms reading while held): one submit per press.
        pressed = reading["button"]
        if pressed and not _last_button and sio.connected:
            sio.emit("input", {"device": "button", "value": True})
        _last_button = pressed

        light = reading["light"]
        if sio.connected and (
            _last_sent_light is None or abs(light - _last_sent_light) >= config.LIGHT_MIN_SEND_DELTA
        ):
            sio.emit("input", {"device": "light", "value": light})
            _last_sent_light = light


def main():
    threading.Thread(target=_serial_loop, daemon=True).start()
    while True:
        try:
            # Polling is the reliable transport through Render's free proxy.
            # WebSocket remains available as an explicit opt-in.
            sio.connect(
                config.SERVER_URL,
                transports=[config.SOCKETIO_TRANSPORT],
                wait_timeout=10,
            )
            sio.wait()
        except Exception as exc:  # python-socketio raises a plain Exception on connect failure
            log.warning(
                "Connect to %s using %s failed (%r), retrying in %.0fs",
                config.SERVER_URL,
                config.SOCKETIO_TRANSPORT,
                exc,
                config.RECONNECT_DELAY_S,
            )
            time.sleep(config.RECONNECT_DELAY_S)


if __name__ == "__main__":
    main()
