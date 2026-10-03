/**
 * One Euro Filter — adaptive low-pass filter.
 * Slow movement → strong smoothing (low jitter)
 * Fast movement → less smoothing (low latency)
 */
export class OneEuroFilter {
  constructor(freq, minCutoff = 1.0, beta = 0.007, dCutoff = 1.0) {
    this.freq = freq;
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;

    this.xPrev = null;
    this.dxPrev = 0;
    this.tPrev = null;
  }

  _alpha(cutoff) {
    const te = 1.0 / this.freq;
    const tau = 1.0 / (2 * Math.PI * cutoff);
    return 1.0 / (1.0 + tau / te);
  }

  filter(x, timestamp) {
    if (this.tPrev !== null && timestamp !== undefined) {
      const dt = (timestamp - this.tPrev) / 1000;
      if (dt > 0) this.freq = 1.0 / dt;
    }
    this.tPrev = timestamp;

    if (this.xPrev === null) {
      this.xPrev = x;
      this.dxPrev = 0;
      return x;
    }

    // Derivative
    const dx = (x - this.xPrev) * this.freq;
    const adAlpha = this._alpha(this.dCutoff);
    const dxHat = adAlpha * dx + (1 - adAlpha) * this.dxPrev;

    // Adaptive cutoff
    const cutoff = this.minCutoff + this.beta * Math.abs(dxHat);
    const alpha = this._alpha(cutoff);

    // Filtered value
    const xHat = alpha * x + (1 - alpha) * this.xPrev;

    this.xPrev = xHat;
    this.dxPrev = dxHat;

    return xHat;
  }

  reset() {
    this.xPrev = null;
    this.dxPrev = 0;
    this.tPrev = null;
  }
}
