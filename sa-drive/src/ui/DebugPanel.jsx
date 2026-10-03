import { useEffect, useRef, useState } from 'react';
import { renderStats } from '../lib/renderStats.js';
import { car } from '../car/state.js';
import { input } from '../input/input.js';
import { toGeo } from '../config/worldConfig.js';

export default function DebugPanel() {
  const [visible, setVisible] = useState(false);
  const panelRef = useRef();
  const fpsFrames = useRef([]);

  useEffect(() => {
    function onKey(e) {
      if (e.code === 'F3') {
        e.preventDefault();
        setVisible(v => !v);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!visible) return;

    let raf;
    function update() {
      const now = performance.now();
      fpsFrames.current.push(now);
      // Keep last 60 frame timestamps
      while (fpsFrames.current.length > 60) fpsFrames.current.shift();
      const fps = fpsFrames.current.length > 1
        ? (1000 * (fpsFrames.current.length - 1) /
           (now - fpsFrames.current[0])).toFixed(0)
        : '—';

      const geo = toGeo(car.x, car.z);

      if (panelRef.current) {
        panelRef.current.textContent = [
          `Render FPS: ${fps}`,
          `Draw calls: ${renderStats.calls} / Triangles: ${renderStats.triangles}`,
          `Inference FPS: ${input.inferenceFps.toFixed(0)}`,
          `Inference ms: ${input.inferenceMs.toFixed(1)}`,
          ``,
          `Raw angle: ${input.rawAngle.toFixed(1)}\u00B0`,
          `Filtered angle: ${input.filteredAngle.toFixed(1)}\u00B0`,
          `Steer: ${input.steer.toFixed(3)}`,
          ``,
          `Speed: ${car.v.toFixed(1)} m/s (${(car.v * 2.237).toFixed(0)} mph)`,
          `Pos: ${car.x.toFixed(1)}, ${car.z.toFixed(1)}`,
          `Geo: ${geo.lat.toFixed(5)}, ${geo.lon.toFixed(5)}`,
          `Yaw: ${(car.yaw * 180 / Math.PI).toFixed(1)}\u00B0`,
          ``,
          `Road dist: ${(car.nearestRoadDist || 0).toFixed(1)}m ${car.offroad ? 'OFF-ROAD' : 'on road'}`,
          ``,
          `Mode: ${input.mode}`,
          `Hands visible: ${input.handsVisible}`,
          `Calibration: ${input.zeroAngle.toFixed(1)}\u00B0`,
        ].join('\n');
      }

      raf = requestAnimationFrame(update);
    }
    update();
    return () => cancelAnimationFrame(raf);
  }, [visible]);

  if (!visible) return null;

  return (
    <pre ref={panelRef} style={{
      position: 'fixed',
      top: 8,
      left: 8,
      background: 'rgba(0,0,0,0.7)',
      color: '#0f0',
      padding: '10px 14px',
      fontSize: '13px',
      fontFamily: 'monospace',
      borderRadius: 6,
      pointerEvents: 'none',
      zIndex: 20,
      whiteSpace: 'pre',
      lineHeight: 1.5,
    }} />
  );
}
