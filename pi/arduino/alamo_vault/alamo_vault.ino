#include <Wire.h>
#include <Servo.h>
#include <hd44780.h>
#include <hd44780ioClass/hd44780_I2Cexp.h>

hd44780_I2Cexp lcd;
Servo servo;

const int LIGHT_PIN = A0;
const int JOY_X_PIN = A1;
const int JOY_Y_PIN = A2;
const int JOY_BUTTON_PIN = 2;  // the joystick button: reported on the serial line, and the Tower challenge uses it to submit the code
const int SERVO_PIN = 9;

const int SERVO_CLOSED_ANGLE = 10;

bool lcdWorking = false;
int servoAngle = SERVO_CLOSED_ANGLE;
unsigned long lastUpdate = 0;

// Set once the Raspberry Pi sends a real LCD command, so the screen shows
// the live sensor readout (handy for a standalone wiring check) until then.
bool lcdOverrideActive = false;

// --- Incoming commands from the Raspberry Pi, over the same Serial link ---
// Newline-terminated, tag-prefixed lines:
//   LCD:<line1>|<line2>
//   SERVO:<angle 0-180>
// Any other tag (e.g. RGB:/LED:/BEEP:, for hardware this shield doesn't
// have) is ignored - the Pi already drops those before sending.
String cmdBuffer;

void writeLcdLine(uint8_t row, String text) {
  if (text.length() > 16) text.remove(16);
  lcd.setCursor(0, row);
  for (uint8_t i = 0; i < 16; i++) {
    lcd.write(i < text.length() ? text[i] : ' ');
  }
}

void applyCommand(const String &line) {
  int sep = line.indexOf(':');
  if (sep < 0) return;
  String tag = line.substring(0, sep);
  String payload = line.substring(sep + 1);

  if (tag == "LCD") {
    int bar = payload.indexOf('|');
    String line1 = bar >= 0 ? payload.substring(0, bar) : payload;
    String line2 = bar >= 0 ? payload.substring(bar + 1) : "";
    lcdOverrideActive = true;
    if (lcdWorking) {
      writeLcdLine(0, line1);
      writeLcdLine(1, line2);
    }
  } else if (tag == "SERVO") {
    servoAngle = constrain(payload.toInt(), 0, 180);
    servo.write(servoAngle);
  }
  // else: unrecognized tag, ignored.
}

void pollCommands() {
  while (Serial.available() > 0) {
    char c = (char)Serial.read();
    if (c == '\n') {
      cmdBuffer.trim();
      if (cmdBuffer.length() > 0) applyCommand(cmdBuffer);
      cmdBuffer = "";
    } else if (c != '\r') {
      cmdBuffer += c;
      if (cmdBuffer.length() > 64) cmdBuffer = ""; // guard against a stuck/garbled line
    }
  }
}

void setup() {
  Serial.begin(9600);

  pinMode(JOY_BUTTON_PIN, INPUT_PULLUP);

  int lcdStatus = lcd.begin(16, 2);
  lcdWorking = (lcdStatus == 0);

  if (lcdWorking) {
    lcd.backlight();
    lcd.clear();
    lcd.print("Starting...");
  } else {
    Serial.print("LCD error: ");
    Serial.println(lcdStatus);
  }

  // The vault stays closed until the server sends SERVO:<angle> on ALAMO_DONE.
  servo.attach(SERVO_PIN);
  servo.write(servoAngle);

  Serial.println("Alamo vault ready. Waiting for the Pi relay...");
}

void loop() {
  pollCommands();

  if (millis() - lastUpdate < 150) {
    return;
  }
  lastUpdate = millis();

  int x = analogRead(JOY_X_PIN);
  int y = analogRead(JOY_Y_PIN);
  int light = analogRead(LIGHT_PIN);
  bool pressed = digitalRead(JOY_BUTTON_PIN) == LOW;

  Serial.print("X: ");
  Serial.print(x);
  Serial.print("  Y: ");
  Serial.print(y);
  Serial.print("  Light: ");
  Serial.print(light);
  Serial.print("  Servo: ");
  Serial.print(servoAngle);
  Serial.print("  Button: ");
  Serial.println(pressed ? "PRESSED" : "released");

  // Once the Pi has sent a real LCD command, it owns the screen; until then
  // keep showing the live sensor readout (handy for standalone wiring tests).
  if (lcdWorking && !lcdOverrideActive) {
    writeLcdLine(0, String("X:") + x + " Y:" + y);
    writeLcdLine(1, String("Light:") + light);
  }
}
