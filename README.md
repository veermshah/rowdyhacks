# San Antonio Night Drive

A browser arcade driving game built with React, React Three Fiber, Three.js,
MediaPipe hand tracking, and OpenStreetMap data for downtown San Antonio.

## Run locally

```sh
cd sa-drive
npm ci
npm run dev
```

Use WASD or arrow keys to drive, hold X to reverse, and press 1-3 to select a
destination. With hand tracking, rotate your hands like a steering wheel;
open both hands to reverse and curl your fingers to drive forward.
Press R to restart and F3 for performance diagnostics.

Follow the glowing road route and stay ahead of the police. Navigation and
pursuit share an A* road graph, and buildings remain solid obstacles.

## Validate

```sh
cd sa-drive
npm run lint
npm run build
node scripts/validate-driving.mjs
node scripts/validate-gameplay.mjs
```

See [game documentation](sa-drive/README.md) for implementation notes and
validation limitations, and [credits](sa-drive/CREDITS.md) for data attribution.
