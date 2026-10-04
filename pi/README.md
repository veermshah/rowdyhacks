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
4. Open the Serial Monitor at 9600 baud to sanity check: you should see the
   same `X: ... Y: ... Light: ... Servo: ... Button: ...` line as before,
   and the servo should still follow the joystick - this sketch behaves
   exactly like the original wiring test until the Pi sends it a real
   `LCD:` or `SERVO:` command.

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

Run it directly to test:

```sh
python pi_client.py
```

You should see a `Connected to ... joining as Pi relay` log line, then
`Connected to Arduino on /dev/ttyACM0`. Move the joystick past center and
back - you should see no spam, just one move per gesture.

## Run on boot

```sh
sudo cp alamo-pi.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now alamo-pi
```

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
status LEDs, or buzzer wired on this shield):
```json
{"type": "lcd", "line1": "...", "line2": "..."}
{"type": "servo", "state": "open"}
```
