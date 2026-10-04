"""Analog joystick -> one discrete move per gesture.

The servers' handle_input() (server/alamo_challenge.py, server/tower_challenge.py) expect an already-
discrete "up"/"down"/"left"/"right" string per move, not raw analog values.
Physical up/down/left/right here is just a consistent convention - if it
doesn't match the real wiring, fix it server-side with JOYSTICK_ORIENTATION
in server/alamo_config.py rather than here.
"""


class JoystickClassifier:
    def __init__(self, center_low, center_high):
        self.center_low = center_low
        self.center_high = center_high
        self._active_move = None

    def _axis_direction(self, value, low_name, high_name):
        if value < self.center_low:
            return low_name
        if value > self.center_high:
            return high_name
        return None

    def classify(self, x, y):
        """Returns a new move string the instant the stick leaves center past
        one axis, or None otherwise. Requires the stick to return to center
        before the next move can fire, so holding it over doesn't spam moves.
        """
        x_move = self._axis_direction(x, "left", "right")
        y_move = self._axis_direction(y, "up", "down")

        if x_move is None and y_move is None:
            self._active_move = None
            return None

        if self._active_move is not None:
            return None  # still holding the same gesture

        center = (self.center_low + self.center_high) // 2
        x_dev = abs(x - center) if x_move else 0
        y_dev = abs(y - center) if y_move else 0
        move = x_move if x_dev >= y_dev else y_move

        self._active_move = move
        return move
