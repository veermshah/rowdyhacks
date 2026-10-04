# Alamo vault Raspberry Pi relay

Runs on the Raspberry Pi wired to the Arduino Uno (base shield: light sensor,
joystick + button, servo, I2C LCD) over USB. Reads the Arduino's sensor
stream and relays it to the game server as Socket.IO `input` events, and
relays the server's `cmd` events (LCD text, vault-door servo) back down to
the Arduino over the same serial link. This is the fixed wire protocol
documented in `server/alamo_challenge.py`.

## Arduino side

1. Open `arduino/alamo_vault/alamo_vault.ino` in the Arduino IDE.
2. Install the `hd44780` library (Library Manager) if you haven't already.
3. Select the Uno's board/port and upload.
4. Open the Serial Monitor at 9600 baud to sanity check: you should see a
   `X: ... Y: ... Light: ... Servo: ... Button: ...` line every ~150ms. The
   LCD shows the same live X/Y/Light readout until the Pi sends a real `LCD:`
   command, at which point the Pi owns the screen. The servo sits at a fixed
   closed position (90°) and only moves when the Pi sends `SERVO:<angle>` -
   it no longer follows the joystick (that was a wiring-test-only behavior;
   the servo is the vault lock now, server-controlled only).

## Raspberry Pi side

```sh
cd pi
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

Find the Arduino's serial port (plug/unplug and diff the listing):

```sh
ls /dev/tty* > before.txt
# plug in the Arduino
ls /dev/tty* > after.txt
diff before.txt after.txt
```

Edit `.env`:
- `ALAMO_SERIAL_PORT` - the port you just found (commonly `/dev/ttyACM0`).
- `ALAMO_SERVER_URL` - the deployed game server's URL (Render), or
  `http://localhost:5000` while testing against a local `server/app.py`.
- `ALAMO_CAR_ID` - matches the car ID the browser joins with (default `solo`).
- `ALAMO_JOY_SWAP_AXES` - set `true` if physical X and Y are exchanged.
- `ALAMO_JOY_INVERT_X` / `ALAMO_JOY_INVERT_Y` - set `true` when that axis
  moves in the opposite direction from the expected direction.
- `ALAMO_TTS_COMMAND` - installed speech executable, normally `espeak-ng`.

Pair the Bluetooth speaker with the Pi and make it the default audio output.
Install the speech engine before testing the keyword step:

```sh
sudo apt install espeak-ng
espeak-ng "Alamo test"
```

Run it directly to test:

```sh
python pi_client.py
```

You should see a `Connected to ... joining as Pi relay` log line, then
`Connected to Arduino on /dev/ttyACM0`. The relay starts Socket.IO with HTTP
polling (and upgrades to WebSocket when available), which is more reliable
through Render's proxy. Move the joystick past center and back - you should
see no spam, just one move per gesture.
Each detected gesture is logged with its raw `x`/`y` values and mapped
direction. Move one physical direction, check the logged direction, then
enable `ALAMO_JOY_SWAP_AXES` or the appropriate `ALAMO_JOY_INVERT_*` setting
and restart the service. No Arduino reflash is needed for calibration.

The deployed backend for this repository is:
`https://lootrun-server-haht.onrender.com`. Put that value in
`ALAMO_SERVER_URL` in `pi/.env`; do not use the old Presage service URL.
Keep `ALAMO_SOCKETIO_TRANSPORT=polling` for Render. This avoids a failed
WebSocket upgrade on networks or proxies that only support the polling
transport.

## Run on boot

```sh
sudo cp alamo-pi.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now alamo-pi
```

The included unit is configured for this Pi user (`dhivyesh123`) and uses the
project's `.venv`, so the installed `python-socketio` package is available.
If the Linux username or repository path is different, edit those values in
`alamo-pi.service` before copying it into `/etc/systemd/system/`.

Check status / logs:

```sh
systemctl status alamo-pi
journalctl -u alamo-pi -f
```

The service restarts automatically (`Restart=always`) if it crashes, and
`pi_client.py` itself reconnects on its own if the Arduino is unplugged or
the server is unreachable - no manual restart needed in either case.

## Wire protocol reference

Arduino -> Pi (unchanged debug line, parsed with a regex):
```
X: 512  Y: 503  Light: 812  Servo: 90  Button: released
```

Pi -> Arduino (only the two actuators this shield actually has):
```
LCD:<line1>|<line2>
SERVO:<angle 0-180>
```

Pi -> server (Socket.IO `input` events):
```json
{"device": "joystick", "value": "up"}
{"device": "light", "value": 812}
```

Server -> Pi (Socket.IO `cmd` events, `lcd`/`servo` are relayed to the
Arduino; `rgb`/`led`/`beep` are logged and dropped since there's no RGB LED,
status LEDs, or buzzer wired on this shield; `speak` is played through the
Pi's configured audio output):
```json
{"type": "lcd", "line1": "...", "line2": "..."}
{"type": "servo", "state": "open"}
{"type": "speak", "text": "ALAMO"}
```
