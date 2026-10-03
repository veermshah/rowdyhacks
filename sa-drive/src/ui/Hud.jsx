import { useEffect, useRef } from 'react';
import { car } from '../car/state.js';
import { game } from '../game/runtime.js';
import { input } from '../input/input.js';

export default function Hud() {
  const speedRef = useRef();
  const distRef = useRef();
  const modeRef = useRef();


  useEffect(() => {
    let raf;
    function update() {
      const mph = (Math.abs(car.v) * 2.237).toFixed(0);
      const miles = (game.distance / 1609.344).toFixed(2);

      if (speedRef.current) speedRef.current.textContent = `${mph} mph`;
      if (distRef.current) distRef.current.textContent = `${miles} mi`;
      if (modeRef.current) {
        const modeText = input.mode === 'hands'
          ? (input.handsVisible ? 'HANDS \u25CF' : 'HANDS \u25CB')
          : 'KEYBOARD';
        modeRef.current.textContent = modeText;
      }

      raf = requestAnimationFrame(update);
    }
    update();
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div style={{
      position: 'fixed',
      bottom: 0,
      left: 0,
      right: 0,
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'flex-end',
      padding: '16px 24px',
      pointerEvents: 'none',
      fontFamily: 'system-ui, sans-serif',
      color: '#fff',
      textShadow: '0 1px 4px rgba(0,0,0,0.6)',
      fontSize: '18px',
      zIndex: 10,
    }}>
      <span ref={distRef}>0.00 mi</span>
      <span ref={modeRef}>KEYBOARD</span>
      <span ref={speedRef}>0 mph</span>
    </div>
  );
}
