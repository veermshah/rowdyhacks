import { ROUTE_COLOR } from '../config/routeStyle.js';
import { guidance,game } from '../game/runtime.js';
import { useEffect, useRef } from 'react';
import { destinations, navigation } from '../config/navigation.js';
import { car } from '../car/state.js';

const SIZE = 160;
const SCALE = 0.12; // pixels per meter

export default function Minimap({ roads }) {
  const canvasRef = useRef();
  const roadCacheRef = useRef(null);

  // Pre-render road lines to an offscreen canvas
  useEffect(() => {
    if (!roads || roads.length === 0) return;

    const offscreen = document.createElement('canvas');
    offscreen.width = SIZE * 8;
    offscreen.height = SIZE * 8;
    const ctx = offscreen.getContext('2d');

    ctx.strokeStyle = '#638897';
    ctx.lineWidth = 1;
    const cx = offscreen.width / 2;
    const cy = offscreen.height / 2;
    const s = SCALE * 4;

    for (const road of roads) {
      const pts = road.points;
      if (pts.length < 2) continue;
      ctx.lineWidth = Math.max(1.5, road.width * s);
      ctx.beginPath();
      ctx.moveTo(cx + pts[0].x * s, cy + pts[0].z * s);
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(cx + pts[i].x * s, cy + pts[i].z * s);
      }
      ctx.stroke();
    }

    roadCacheRef.current = offscreen;
  }, [roads]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let raf;

    function draw() {
      ctx.clearRect(0, 0, SIZE, SIZE);

      // Background
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(0, 0, SIZE, SIZE);

      // Draw road cache centered on player
      if (roadCacheRef.current) {
        const src = roadCacheRef.current;
        const srcCx = src.width / 2 + car.x * SCALE * 4;
        const srcCz = src.height / 2 + car.z * SCALE * 4;

        ctx.drawImage(
          src,
          srcCx - SIZE * 2, srcCz - SIZE * 2,
          SIZE * 4, SIZE * 4,
          0, 0,
          SIZE, SIZE
        );
      }

      const points=guidance.route?.points||[];
      if(points.length){ctx.strokeStyle=ROUTE_COLOR;ctx.lineWidth=2;ctx.lineJoin='round';ctx.beginPath();points.forEach((p,i)=>{const x=SIZE/2+(p.x-car.x)*SCALE,y=SIZE/2+(p.z-car.z)*SCALE;if(i)ctx.lineTo(x,y);else ctx.moveTo(x,y);});ctx.stroke();}
      if(game.police){const x=SIZE/2+(game.police.x-car.x)*SCALE,y=SIZE/2+(game.police.z-car.z)*SCALE;ctx.fillStyle='#ff4e75';ctx.fillRect(x-4,y-3,4,6);ctx.fillStyle='#58aaff';ctx.fillRect(x,y-3,4,6);}
      const access=guidance.route?.endpoint;
      if(access){ctx.strokeStyle=ROUTE_COLOR;ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(SIZE/2+(access.x-car.x)*SCALE,SIZE/2+(access.z-car.z)*SCALE,4,0,Math.PI*2);ctx.stroke();}
      const destination=destinations[navigation.selected];
      const dx=(destination.x-car.x)*SCALE,dz=(destination.z-car.z)*SCALE;
      const factor=Math.min(1,(SIZE/2-12)/Math.max(Math.abs(dx),Math.abs(dz),1));
      ctx.fillStyle='#ffc773';ctx.strokeStyle='#ffc773';
      ctx.beginPath();ctx.arc(SIZE/2+dx*factor,SIZE/2+dz*factor,5,0,Math.PI*2);ctx.fill();
      ctx.fillStyle='#9dbccb';ctx.font='10px system-ui';ctx.fillText('N',8,14);
      // Player dot
      const px = SIZE / 2;
      const py = SIZE / 2;

      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(Math.PI-car.yaw);

      // Arrow shape
      ctx.fillStyle = '#8ffff3';
      ctx.shadowColor = '#49f8ed';ctx.shadowBlur=6;
      ctx.beginPath();
      ctx.moveTo(0, -6);
      ctx.lineTo(4, 4);
      ctx.lineTo(-4, 4);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      raf = requestAnimationFrame(draw);
    }

    draw();
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      width={SIZE}
      height={SIZE}
      style={{
        position: 'fixed',
        bottom: 50,
        left: 12,
        borderRadius: 8,
        border: '2px solid rgba(255,255,255,0.2)',
        zIndex: 15,
      }}
    />
  );
}
