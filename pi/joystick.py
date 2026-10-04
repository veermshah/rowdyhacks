"""Analog joystick -> one discrete move per gesture.

The server's handle_input() (server/alamo_challenge.py) expects an already-
discrete "up"/"down"/"left"/"right" string per move, not raw analog values.
The axis and polarity options are configurable so the physical mounting can
be corrected without reflashing the Arduino.
"""


class JoystickClassifier:
    def __init__(self, center_low, center_high, swap_axes=False, invert_x=False, invert_y=False):
        self.center_low = center_low
        self.center_high = center_high
        self._active_move = None
        self.swap_axes = swap_axes
        self.invert_x = invert_x
        self.invert_y = invert_y

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
        if self.swap_axes:
            x, y = y, x
        center = (self.center_low + self.center_high) // 2
        if self.invert_x:
            x = center - (x - center)
        if self.invert_y:
            y = center - (y - center)

        x_move = self._axis_direction(x, "left", "right")
        y_move = self._axis_direction(y, "up", "down")

        if x_move is None and y_move is None:
            self._active_move = None
            return None

        if self._active_move is not None:
            return None  # still holding the same gesture

        x_dev = abs(x - center) if x_move else 0
        y_dev = abs(y - center) if y_move else 0
        move = x_move if x_dev >= y_dev else y_move

        self._active_move = move
        return move
