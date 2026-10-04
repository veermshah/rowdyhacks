import { useEffect, useRef } from 'react';

const DROP_COUNT = 90;
const STYLE = {
  position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 10, overflow: 'hidden',
};

function makeDrop() {
  return {
    x: Math.random() * 100,
    y: -Math.random() * 20,
    speed: 1.8 + Math.random() * 2.5,
    length: 12 + Math.random() * 20,
    opacity: 0.08 + Math.random() * 0.18,
    width: 1 + Math.random() * 1.5,
    drift: (Math.random() - 0.5) * 0.3,
  };
}

export default function ScreenRain() {
  const canvasRef = useRef(null);
  const drops = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    let raf;
    if (!drops.current) drops.current = Array.from({ length: DROP_COUNT }, makeDrop);

    function resize() {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const w = canvas.width, h = canvas.height;

      for (const d of drops.current) {
        d.y += d.speed;
        d.x += d.drift;
        if (d.y > 100 + 5) Object.assign(d, makeDrop(), { y: -Math.random() * 10 });

        const px = (d.x / 100) * w;
        const py = (d.y / 100) * h;
        const len = (d.length / 100) * h;

        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px + d.drift * 8, py + len);
        ctx.strokeStyle = `rgba(180, 210, 230, ${d.opacity})`;
        ctx.lineWidth = d.width;
        ctx.lineCap = 'round';
        ctx.stroke();
      }

      // Subtle wet vignette
      const grad = ctx.createRadialGradient(w / 2, h / 2, h * 0.3, w / 2, h / 2, h * 0.8);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, 'rgba(10,20,30,0.15)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      raf = requestAnimationFrame(draw);
    }
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return <canvas ref={canvasRef} style={STYLE} />;
}
