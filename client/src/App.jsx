import RiverwalkChallenge from './components/RiverwalkChallenge.jsx';

// Standalone harness for the Riverwalk challenge. In the full game, render
// <RiverwalkChallenge carId={car.id} ... /> when the car reaches the Riverwalk.
export default function App() {
  const carId = new URLSearchParams(window.location.search).get('car') || 'solo';
  return (
    <RiverwalkChallenge
      carId={carId}
      onComplete={(amount) => console.log('Riverwalk cleared, +$', amount)}
      onWantedLevelChange={(level) => console.log('Wanted level now', level)}
    />
  );
}
