import { useEffect, useRef } from 'react';
import { input } from '../input/input.js';

const W = 200;
const H = 150;

export default function CamPreview({ videoRef }) {
  const canvasRef = useRef();

  useEffect(() => {
    if (input.mode !== 'hands') return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let raf;

    function draw() {
      const video = videoRef.current;
      if (video && video.readyState >= 2) {
        // Draw mirrored video
        ctx.save();
        ctx.translate(W, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(video, 0, 0, W, H);
        ctx.restore();
      }

      // Draw palm overlay
      const lp = input.leftPalm;
      const rp = input.rightPalm;

      if (lp && rp && input.handsVisible) {
        const lx = lp.x * W;
        const ly = lp.y * H;
        const rx = rp.x * W;
        const ry = rp.y * H;

        // Line connecting palms
        ctx.strokeStyle = '#0f0';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(lx, ly);
        ctx.lineTo(rx, ry);
        ctx.stroke();

        // Palm dots
        ctx.fillStyle = '#0f0';
        for (const [px, py] of [[lx, ly], [rx, ry]]) {
          ctx.beginPath();
          ctx.arc(px, py, 5, 0, Math.PI * 2);
          ctx.fill();
        }

        // Angle text
        ctx.fillStyle = '#0f0';
        ctx.font = '12px monospace';
        ctx.fillText(`Wheel: ${input.filteredAngle.toFixed(0)}\u00B0`, 8, H - 24);
        ctx.fillText('Tracking: Good', 8, H - 8);
      } else {
        ctx.fillStyle = '#fa0';
        ctx.font = '12px monospace';
        ctx.fillText('Tracking: Lost', 8, H - 8);
      }

      raf = requestAnimationFrame(draw);
    }

    draw();
    return () => cancelAnimationFrame(raf);
  }, [videoRef]);

  if (input.mode !== 'hands') return null;

  return (
    <canvas
      ref={canvasRef}
      width={W}
      height={H}
      style={{
        position: 'fixed',
        top: 8,
        right: 8,
        borderRadius: 8,
        border: '2px solid rgba(255,255,255,0.3)',
        zIndex: 15,
      }}
    />
  );
}
