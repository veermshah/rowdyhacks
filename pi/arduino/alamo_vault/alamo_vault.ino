#include <Wire.h>
#include <Servo.h>
#include <hd44780.h>
#include <hd44780ioClass/hd44780_I2Cexp.h>

hd44780_I2Cexp lcd;
Servo servo;

const int LIGHT_PIN = A0;
const int JOY_X_PIN = A1;
const int JOY_Y_PIN = A2;
const int JOY_BUTTON_PIN = 2;
const int SERVO_PIN = 9;

bool lcdWorking = false;
int servoAngle = 90;
unsigned long lastUpdate = 0;

// Set once the Raspberry Pi sends a real LCD/SERVO command, so this sketch
// still behaves exactly like the original wiring test until then.
bool lcdOverrideActive = false;
bool servoLocked = false;

// --- Incoming commands from the Raspberry Pi, over the same Serial link ---
// Newline-terminated, tag-prefixed lines:
//   LCD:<line1>|<line2>
//   SERVO:<angle 0-180>
// Any other tag (e.g. RGB:/LED:/BEEP:, for hardware this shield doesn't
// have) is ignored - the Pi already drops those before sending.
String cmdBuffer;

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
      lcd.setCursor(0, 0);
      lcd.print("                ");
      lcd.setCursor(0, 0);
      lcd.print(line1);
      lcd.setCursor(0, 1);
      lcd.print("                ");
      lcd.setCursor(0, 1);
      lcd.print(line2);
    }
  } else if (tag == "SERVO") {
    int angle = payload.toInt();
    servoAngle = constrain(angle, 0, 180);
    servo.write(servoAngle);
    servoLocked = true;
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
  pinMode(LED_BUILTIN, OUTPUT);

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

  servo.attach(SERVO_PIN);
  servo.write(90);

  Serial.println("Move joystick X to move servo.");
  Serial.println("Press joystick to light built-in LED.");
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

  // Once the Pi has sent an explicit SERVO command (vault door open/close),
  // that wins and the joystick stops nudging the servo.
  if (!servoLocked) {
    // Use 10-170 degrees to avoid forcing the servo's end stops.
    int targetAngle = map(x, 0, 1023, 10, 170);

    // Hold the servo at center when the joystick is near center.
    if (x > 460 && x < 565) {
      targetAngle = 90;
    }

    // Ignore tiny changes to reduce jitter.
    if (abs(targetAngle - servoAngle) >= 3) {
      servoAngle = targetAngle;
      servo.write(servoAngle);
    }
  }

  digitalWrite(LED_BUILTIN, pressed ? HIGH : LOW);

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
    lcd.setCursor(0, 0);
    lcd.print("                ");
    lcd.setCursor(0, 0);
    lcd.print("X:");
    lcd.print(x);
    lcd.print(" Y:");
    lcd.print(y);

    lcd.setCursor(0, 1);
    lcd.print("                ");
    lcd.setCursor(0, 1);
    lcd.print("L:");
    lcd.print(light);
    lcd.print(" S:");
    lcd.print(servoAngle);
    if (pressed) {
      lcd.print(" BTN");
    }
  }
}
