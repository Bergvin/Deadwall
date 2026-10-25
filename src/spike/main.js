// Phase 0 spike: verifies Three.js + model loading + animated horde performance.
// Query params: ?n=200 (zombie count), ?shadows=0, ?yaw=0, ?pitch=55 (camera angles in degrees),
// ?horde=skinned (one SkinnedMesh per zombie instead of the baked instanced horde).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { createBakedHorde } from './bakedHorde.js';

const params = new URLSearchParams(location.search);
const MAP_W = 30;
const MAP_H = 24;
const WALL_ROW = 17; // z of the defensive line (north is -z)
let zombieCount = Number(params.get('n') ?? 200);
let yawDeg = Number(params.get('yaw') ?? 0);
let pitchDeg = Number(params.get('pitch') ?? 55);
const useShadows = params.get('shadows') !== '0';

// --- renderer / scene ---------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = useShadows;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x15161a);
// Camera sits CAMERA_DIST from the map center, so fog starts just past the center and only
// dims the far (north) side of the map.
const CAMERA_DIST = 50;
scene.fog = new THREE.Fog(0x15161a, CAMERA_DIST + 4, CAMERA_DIST + 30);

const center = new THREE.Vector3(MAP_W / 2, 0, MAP_H / 2);
const camera = new THREE.OrthographicCamera();
let viewSize = 26;

function updateCamera() {
  const aspect = innerWidth / innerHeight;
  camera.left = (-viewSize * aspect) / 2;
  camera.right = (viewSize * aspect) / 2;
  camera.top = viewSize / 2;
  camera.bottom = -viewSize / 2;
  camera.near = 0.1;
  camera.far = 200;
  // Pitch is the angle above the ground (35.26 = classic isometric, 90 = top-down).
  const yaw = THREE.MathUtils.degToRad(yawDeg);
  const pitch = THREE.MathUtils.degToRad(Math.min(pitchDeg, 89.9));
  const dist = CAMERA_DIST;
  camera.position.set(
    center.x + dist * Math.cos(pitch) * Math.sin(yaw),
    dist * Math.sin(pitch),
    center.z + dist * Math.cos(pitch) * Math.cos(yaw),
  );
  camera.lookAt(center);
  camera.updateProjectionMatrix();
}
updateCamera();

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  updateCamera();
});
addEventListener('wheel', (e) => {
  viewSize = THREE.MathUtils.clamp(viewSize * (e.deltaY > 0 ? 1.1 : 0.9), 8, 40);
  updateCamera();
});
addEventListener('keydown', (e) => {
  if (e.key === 'v') yawDeg = yawDeg === 45 ? 0 : 45;
  else if (e.key === '[') pitchDeg = Math.max(30, pitchDeg - 5);
  else if (e.key === ']') pitchDeg = Math.min(90, pitchDeg + 5);
  else if (e.key === 't') pitchDeg = pitchDeg >= 90 ? 55 : 90;
  else return;
  updateCamera();
});

// --- lighting: dim moonlight + warm torches ------------------------------
scene.add(new THREE.HemisphereLight(0x9aa8c8, 0x302418, 2.2));
const moon = new THREE.DirectionalLight(0xc0ccff, 2.2);
moon.position.set(center.x - 12, 25, center.z - 8);
moon.target.position.copy(center);
moon.castShadow = useShadows;
moon.shadow.mapSize.set(2048, 2048);
Object.assign(moon.shadow.camera, { left: -22, right: 22, top: 22, bottom: -22, near: 1, far: 80 });
scene.add(moon, moon.target);

for (let x = 4; x < MAP_W; x += 7) {
  const torch = new THREE.PointLight(0xff8a3c, 6, 7, 1.6);
  torch.position.set(x, 1.6, WALL_ROW + 0.8);
  scene.add(torch);
}

// --- ground + grid ------------------------------------------------------
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(MAP_W + 20, MAP_H + 20),
  new THREE.MeshStandardMaterial({ color: 0x2b2a24, roughness: 1 }),
);
ground.rotation.x = -Math.PI / 2;
ground.position.copy(center);
ground.receiveShadow = true;
scene.add(ground);

const grid = new THREE.GridHelper(MAP_W, MAP_W, 0x4a463c, 0x37342d);
grid.scale.z = MAP_H / MAP_W;
grid.position.set(center.x, 0.01, center.z);
scene.add(grid);

const spawnZone = new THREE.Mesh(
  new THREE.PlaneGeometry(MAP_W, 3),
  new THREE.MeshBasicMaterial({ color: 0x7a1d1d, transparent: true, opacity: 0.35 }),
);
spawnZone.rotation.x = -Math.PI / 2;
spawnZone.position.set(center.x, 0.02, 1.5);
scene.add(spawnZone);

// --- model loading ------------------------------------------------------
const loader = new GLTFLoader();
const load = (url) => loader.loadAsync(url);

/** Uniformly scales an object so its bounding-box size along `axis` equals `target`. */
function fitTo(obj, axis, target) {
  const size = new THREE.Box3().setFromObject(obj).getSize(new THREE.Vector3());
  obj.scale.multiplyScalar(target / size[axis]);
  return size;
}

function enableShadows(obj) {
  obj.traverse((o) => {
    if (o.isMesh) { o.castShadow = useShadows; o.receiveShadow = useShadows; }
  });
}

const timings = {};
const t0 = performance.now();
const [wallGltf, gateGltf, towerGltf, rangerGltf, zombieGltf] = await Promise.all([
  load('/models/kenney/wall.glb'),
  load('/models/kenney/wall-doorway.glb'),
  load('/models/kenney/tower-square.glb'),
  load('/models/heroes/Ranger.gltf'),
  load('/models/zombies/Zombie_Basic.gltf'),
]);
timings.loadMs = Math.round(performance.now() - t0);

// Defensive line: walls across the map, gate in the middle, towers at the ends.
// Kenney kit pieces share one scale, so derive it from the wall and apply it to all of them.
const wallProto = wallGltf.scene;
const rawWall = fitTo(wallProto, 'x', 1);
const kitScale = wallProto.scale.x;
for (const g of [wallGltf, gateGltf, towerGltf]) {
  g.scene.scale.setScalar(kitScale);
  enableShadows(g.scene);
}
const rawGate = new THREE.Box3().setFromObject(gateGltf.scene).getSize(new THREE.Vector3());
const gateX = Math.floor(MAP_W / 2);
for (let x = 0; x < MAP_W; x++) {
  const isGate = x === gateX;
  const isTower = x === 0 || x === MAP_W - 1;
  const src = isGate ? gateGltf.scene : isTower ? towerGltf.scene : wallProto;
  const piece = src.clone();
  piece.position.set(x + 0.5, 0, WALL_ROW + 0.5);
  scene.add(piece);
}

// Hero on the wall next to the gate, facing north.
const ranger = rangerGltf.scene;
const rawRanger = fitTo(ranger, 'y', 0.9);
enableShadows(ranger);
const wallTop = new THREE.Box3().setFromObject(wallProto).max.y;
ranger.position.set(gateX - 1.5, wallTop, WALL_ROW + 0.5);
ranger.rotation.y = Math.PI; // models face +z; enemies come from -z
scene.add(ranger);
const rangerMixer = new THREE.AnimationMixer(ranger);
rangerMixer.clipAction(THREE.AnimationClip.findByName(rangerGltf.animations, 'Bow_Shoot')).play();

// --- zombie horde -------------------------------------------------------
// Simulation state is the same for both renderers; ?horde=skinned uses one SkinnedMesh
// clone per zombie, the default 'baked' mode draws all zombies in one instanced call.
const hordeMode = params.get('horde') ?? 'baked';
const MAX_ZOMBIES = 2000;
const zombieProto = zombieGltf.scene;
const rawZombie = fitTo(zombieProto, 'y', 0.85);
enableShadows(zombieProto);
const clipByName = (n) => THREE.AnimationClip.findByName(zombieGltf.animations, n);

let baked = null;
if (hordeMode === 'baked') {
  const tb = performance.now();
  baked = createBakedHorde(zombieProto, ['Walk', 'Punch', 'Death', 'Run'].map(clipByName), MAX_ZOMBIES, {
    castShadow: useShadows, meshName: 'Zombie',
  });
  timings.bakeMs = Math.round(performance.now() - tb);
  scene.add(baked.mesh);
}

const zombies = [];
function spawnZombie() {
  const z = { x: 0, z: 0, speed: 0.6 + Math.random() * 0.5, attacking: false, t: Math.random() * 2 };
  if (!baked) {
    z.mesh = SkeletonUtils.clone(zombieProto);
    z.mixer = new THREE.AnimationMixer(z.mesh);
    z.walk = z.mixer.clipAction(clipByName('Walk'));
    z.punch = z.mixer.clipAction(clipByName('Punch'));
    z.walk.time = z.t;
    z.walk.play();
    scene.add(z.mesh);
  }
  resetZombie(z);
  zombies.push(z);
}
function resetZombie(z) {
  z.x = 0.5 + Math.random() * (MAP_W - 1);
  z.z = Math.random() * 3;
  z.attackTimer = 0;
  if (z.attacking && z.mesh) { z.punch.stop(); z.walk.play(); }
  z.attacking = false;
}
function setZombieCount(n) {
  n = Math.min(n, MAX_ZOMBIES);
  while (zombies.length < n) spawnZombie();
  while (zombies.length > n) {
    const z = zombies.pop();
    if (z.mesh) { scene.remove(z.mesh); z.mixer.stopAllAction(); }
  }
  zombieCount = n;
}
setZombieCount(zombieCount);

// --- loop + stats -------------------------------------------------------
const statsEl = document.getElementById('stats');
const clock = new THREE.Clock();
const frameTimes = [];
let statsTimer = 0;
let lastStats = {};

function update(dt) {
  rangerMixer.update(dt);
  for (let i = 0; i < zombies.length; i++) {
    const z = zombies[i];
    z.t += dt;
    if (!z.attacking) {
      z.z += z.speed * dt;
      if (z.z >= WALL_ROW - 0.35) {
        z.attacking = true;
        z.t = 0;
        if (z.mesh) { z.walk.stop(); z.punch.play(); }
      }
    } else if ((z.attackTimer += dt) > 6) {
      resetZombie(z); // loop the horde so the test runs indefinitely
    }
    if (baked) {
      // Models face +z, which is south; zombies walk south, so no extra rotation.
      baked.set(i, z.x, 0, z.z, 0, z.attacking ? 'Punch' : 'Walk', z.t * (z.attacking ? 1 : z.speed * 1.4));
    } else {
      z.mesh.position.set(z.x, 0, z.z);
      z.mixer.update(dt);
    }
  }
  if (baked) baked.commit(zombies.length);
}

function frame() {
  const dt = Math.min(clock.getDelta(), 0.1);
  update(dt);
  renderer.render(scene, camera);

  frameTimes.push(dt * 1000);
  if (frameTimes.length > 120) frameTimes.shift();
  if ((statsTimer += dt) > 0.5) {
    statsTimer = 0;
    const avg = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;
    const worst = Math.max(...frameTimes);
    const info = renderer.info.render;
    lastStats = {
      fps: Math.round(1000 / avg), avgMs: +avg.toFixed(1), worstMs: +worst.toFixed(1),
      zombies: zombies.length, drawCalls: info.calls, triangles: info.triangles,
      shadows: useShadows, yaw: yawDeg, pitch: pitchDeg, horde: hordeMode, ...timings,
    };
    statsEl.textContent =
      `FPS ${lastStats.fps}  (avg ${lastStats.avgMs} ms, worst ${lastStats.worstMs} ms)\n` +
      `zombies ${lastStats.zombies}   draw calls ${info.calls}   tris ${info.triangles}\n` +
      `shadows ${useShadows ? 'on' : 'off'}   load ${timings.loadMs} ms   bake ${timings.bakeMs ?? '-'} ms\n` +
      `horde ${hordeMode}   pitch ${pitchDeg}°   yaw ${yawDeg}°\n` +
      `wheel: zoom   [ ]: pitch   T: top-down   V: yaw 45/0`;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Debug hooks for automated checks (see CLAUDE.md: test with code, not screenshots).
/**
 * Renders `frames` frames synchronously and returns the average cost per frame.
 * A 1-pixel readPixels forces the GPU to finish, so the number includes GPU time
 * and is valid even when the tab is hidden or rAF is throttled.
 */
function bench(frames = 120) {
  const gl = renderer.getContext();
  const px = new Uint8Array(4);
  const dt = 1 / 60;
  let updateMs = 0;
  const start = performance.now();
  for (let i = 0; i < frames; i++) {
    const u0 = performance.now();
    update(dt);
    updateMs += performance.now() - u0;
    renderer.render(scene, camera);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  }
  const frameMs = (performance.now() - start) / frames;
  return {
    zombies: zombies.length, shadows: useShadows,
    frameMs: +frameMs.toFixed(2), updateMs: +(updateMs / frames).toFixed(2),
    estFps: Math.round(1000 / frameMs), triangles: renderer.info.render.triangles,
  };
}

window.debug = {
  stats: () => lastStats,
  setZombieCount,
  bench,
  scene,
  zombies,
  rawSizes: { wall: rawWall, gate: rawGate, ranger: rawRanger, zombie: rawZombie },
};
