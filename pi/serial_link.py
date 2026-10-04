"""Owns the USB-serial connection to the Arduino Uno.

Reconnects on its own if the Pi boots before the Arduino enumerates, or the
USB cable gets bumped mid-game, so the systemd unit never needs to restart
the whole process just to recover a dropped link.
"""
import logging
import re
import time

import serial

log = logging.getLogger(__name__)

LINE_RE = re.compile(
    r"X:\s*(\d+)\s+Y:\s*(\d+)\s+Light:\s*(\d+)\s+Servo:\s*(\d+)\s+Button:\s*(PRESSED|released)"
)


class SerialLink:
    def __init__(self, port, baud_rate, reconnect_delay_s=2.0):
        self.port = port
        self.baud_rate = baud_rate
        self.reconnect_delay_s = reconnect_delay_s
        self._ser = None

    def _ensure_open(self):
        while self._ser is None:
            try:
                self._ser = serial.Serial(self.port, self.baud_rate, timeout=1)
                time.sleep(2)  # let the Uno finish its post-upload/post-open reset
                log.info("Connected to Arduino on %s", self.port)
            except serial.SerialException as exc:
                log.warning("Serial open failed (%s), retrying in %.0fs", exc, self.reconnect_delay_s)
                self._ser = None
                time.sleep(self.reconnect_delay_s)

    def read_reading(self):
        """Blocks until the next parsed sensor reading, reconnecting as needed.

        Returns a dict {x, y, light, servo, button} or None if the line
        couldn't be parsed (partial read, noise, etc) - callers should just
        loop and call again.
        """
        self._ensure_open()
        try:
            raw = self._ser.readline()
        except serial.SerialException as exc:
            log.warning("Serial read failed (%s), reconnecting", exc)
            self._close()
            return None

        if not raw:
            return None
        line = raw.decode("utf-8", errors="ignore").strip()
        if not line:
            return None

        m = LINE_RE.search(line)
        if not m:
            return None
        x, y, light, servo, button = m.groups()
        return {
            "x": int(x),
            "y": int(y),
            "light": int(light),
            "servo": int(servo),
            "button": button == "PRESSED",
        }

    def send_command(self, line):
        """Writes one newline-terminated command line to the Arduino.

        Best-effort: drops the command rather than raising if the link is
        currently down, since a missed LCD/servo update isn't worth crashing
        the relay over.
        """
        self._ensure_open()
        try:
            self._ser.write((line.strip() + "\n").encode("ascii"))
        except serial.SerialException as exc:
            log.warning("Serial write failed (%s): dropped %r", exc, line)
            self._close()

    def _close(self):
        if self._ser is not None:
            try:
                self._ser.close()
            except serial.SerialException:
                pass
        self._ser = None
