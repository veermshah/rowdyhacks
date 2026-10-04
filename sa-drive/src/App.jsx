import { useEffect, useRef, useState, useCallback } from 'react';
import { Canvas } from '@react-three/fiber';
import Car from './car/Car.jsx';
import { car, setRoadGrid, setBuildingGrid } from './car/state.js';
import CameraRig from './car/CameraRig.jsx';
import Ground from './world/Ground.jsx';
import RouteBranding from './world/Branding.jsx';
import Roads from './world/Roads.jsx';
import Buildings from './world/Buildings.jsx';
import River from './world/River.jsx';
import Trees from './world/Trees.jsx';
import Landmarks from './world/Landmarks.jsx';
import Hud from './ui/Hud.jsx';
import DebugPanel from './ui/DebugPanel.jsx';
import Calibrate from './ui/Calibrate.jsx';
import CamPreview from './ui/CamPreview.jsx';
import Minimap from './ui/Minimap.jsx';
import { initKeyboard, cleanupKeyboard } from './input/keyboard.js';
import { FOG_COLOR, toLocal } from './config/worldConfig.js';
import { roadWidth, isDrivable } from './config/roadConfig.js';
import { buildBuildingGrid, safeRoadSpawn } from './lib/collision.js';
import { landmarkObstacles, LANDMARK_OSM_REPLACEMENTS, LANDMARKS } from './config/landmarkConfig.js';
import Navigation from './ui/Navigation.jsx';
import StreetProps from './world/StreetProps.jsx';
import { buildRoadGraph } from './lib/roadGraph.js';
import { game,initializeGame } from './game/runtime.js';
import Gameplay from './game/Gameplay.jsx';
import PursuitHud from './ui/PursuitHud.jsx';
import { buildRiverNetwork, riverObstacles } from './lib/riverNetwork.js';
import { buildRoadGrid, queryNearestRoad } from './lib/grid.js';

export default function App() {
  const videoRef = useRef(null);
  const [started, setStarted] = useState(false);
  const [mapData, setMapData] = useState(null);
  const [mapError, setMapError] = useState(null);
  const [grids, setGrids] = useState(null);
  const gridRef = useRef(null);

  useEffect(() => {
    initKeyboard();
    return cleanupKeyboard;
  }, []);

  // Load OSM data
  useEffect(() => {
    let active = true;
    fetch('/data/downtown.json')
      .then(r => {
        if (!r.ok) throw new Error(`Failed to load map: ${r.status}`);
        return r.json();
      })
      .then(data => {
        if (!active) return;
        data.roads = data.roads.map(r => ({ ...r, width: roadWidth(r), drivable: isDrivable(r) }));
        data.buildings = data.buildings.filter(b=>!LANDMARK_OSM_REPLACEMENTS.has(b.id));
        const grid = buildRoadGrid(data.roads);
        data.river = buildRiverNetwork(data.water);
        data.collisionObstacles = [...data.buildings,...landmarkObstacles(),...riverObstacles(data.river,grid,queryNearestRoad)];
        const obstacles = buildBuildingGrid(data.collisionObstacles);
        setBuildingGrid(obstacles);
        data.roadGrid = grid;
        data.buildingGrid = obstacles;
        setMapData(data);
        setGrids({ road: grid, building: obstacles });

        gridRef.current = grid;
        setRoadGrid(grid);

        // Spawn car near the Alamo
        const alamoLocal = toLocal(LANDMARKS.alamo.lat, LANDMARKS.alamo.lon);
        const spawn = safeRoadSpawn(data.roads, obstacles, alamoLocal);
        if (!spawn) throw new Error('No clear road spawn found');
        car.safePosition = spawn;
        car.x = spawn.x;
        car.z = spawn.z;
        car.yaw = spawn.yaw;
        initializeGame(buildRoadGraph(data.roads,obstacles),obstacles,spawn);
      })
      .catch(err => {
        if (!active) return;
        console.error('Map load error:', err);
        setMapError(err.message);
      });
    return () => { active = false; };
  }, []);

  const handleReady = useCallback(() => {
    game.started=true;
    setStarted(true);
  }, []);

  // Compute tree bounds from map data
  const treeBounds = mapData ? {
    xMin: -900, xMax: 900,
    zMin: -900, zMax: 900,
  } : null;

  return (
    <>
      <video ref={videoRef} style={{ display: 'none' }} playsInline muted />

      <Canvas
        dpr={[1, 1.5]}
        gl={{ stencil: true }}
        shadows
        camera={{ fov: 60, near: 0.5, far: 700 }}
        style={{ width: '100vw', height: '100vh' }}
      >
        <color attach="background" args={[FOG_COLOR]} />
        <fog attach="fog" args={[FOG_COLOR, 90, 650]} />

        <ambientLight intensity={0.65} />
        <hemisphereLight args={['#719bd1', '#182c36', 0.9]} />
        <directionalLight
          position={[50, 80, 30]}
          color="#a4c8ff" intensity={1.5}
          castShadow
          shadow-mapSize-width={1024}
          shadow-mapSize-height={1024}
          shadow-camera-left={-60}
          shadow-camera-right={60}
          shadow-camera-top={60}
          shadow-camera-bottom={-60}
          shadow-camera-near={1}
          shadow-camera-far={200}
        />

        <Ground />

        {mapData && (
          <>
            <Roads roads={mapData.roads} river={mapData.river} />
            <Buildings buildings={mapData.buildings} />
            <RouteBranding buildings={mapData.buildings} />
            <River network={mapData.river} roads={mapData.roads} buildings={mapData.buildings} buildingGrid={grids?.building} roadGrid={grids?.road} />
            <Trees roadGrid={grids?.road} buildingGrid={grids?.building} bounds={treeBounds} />
            <StreetProps roads={mapData.roads} roadGrid={grids?.road} buildingGrid={grids?.building} />
          </>
        )}

        <Landmarks />
        <Car />
        {mapData && <Gameplay />}
        <CameraRig />
      </Canvas>

      {mapError && (
        <div style={{
          position: 'fixed', top: 8, left: '50%', transform: 'translateX(-50%)',
          background: '#c00', color: '#fff', padding: '8px 16px', borderRadius: 6,
          fontSize: 14, zIndex: 50,
        }}>
          Map error: {mapError}
        </div>
      )}

      <Calibrate videoRef={videoRef} onReady={handleReady} />
      {started && <CamPreview videoRef={videoRef} />}
      {mapData && <Minimap roads={mapData.roads} />}
      {mapData && <Navigation />}
      <Hud />
      {started && <PursuitHud />}
      <DebugPanel />
    </>
  );
}
