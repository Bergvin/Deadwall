// Phase 0 spike: verifies Three.js + model loading + animated horde performance.
// Query params: ?n=200 (zombie count), ?shadows=0, ?yaw=45 (camera yaw in degrees).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

const params = new URLSearchParams(location.search);
const MAP_W = 30;
const MAP_H = 24;
const WALL_ROW = 17; // z of the defensive line (north is -z)
let zombieCount = Number(params.get('n') ?? 200);
let yawDeg = Number(params.get('yaw') ?? 0);
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
scene.fog = new THREE.Fog(0x15161a, 30, 60);

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
  // Classic isometric pitch (35.264 deg) at the chosen yaw, looking toward north (-z).
  const yaw = THREE.MathUtils.degToRad(yawDeg);
  const pitch = Math.atan(1 / Math.SQRT2);
  const dist = 50;
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
  if (e.key === 'v') { yawDeg = yawDeg === 45 ? 0 : 45; updateCamera(); }
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
const zombieClips = {
  walk: THREE.AnimationClip.findByName(zombieGltf.animations, 'Walk'),
  punch: THREE.AnimationClip.findByName(zombieGltf.animations, 'Punch'),
};
const zombieProto = zombieGltf.scene;
const rawZombie = fitTo(zombieProto, 'y', 0.85);
enableShadows(zombieProto);
// ?lite=1: cheaper zombies for the perf comparison (Lambert shading, no separate eyelid mesh).
if (params.get('lite') === '1') {
  zombieProto.traverse((o) => {
    if (!o.isMesh) return;
    if (o.name === 'Eyelid') o.visible = false;
    o.material = new THREE.MeshLambertMaterial({ map: o.material.map, color: o.material.color });
  });
}

const zombies = [];
function spawnZombie() {
  const mesh = SkeletonUtils.clone(zombieProto);
  const mixer = new THREE.AnimationMixer(mesh);
  const walk = mixer.clipAction(zombieClips.walk);
  const punch = mixer.clipAction(zombieClips.punch);
  walk.time = Math.random() * zombieClips.walk.duration;
  walk.play();
  const z = { mesh, mixer, walk, punch, speed: 0.6 + Math.random() * 0.5, attacking: false };
  resetZombie(z);
  scene.add(mesh);
  zombies.push(z);
}
function resetZombie(z) {
  z.mesh.position.set(0.5 + Math.random() * (MAP_W - 1), 0, Math.random() * 3);
  z.mesh.rotation.y = 0; // face south (+z)
  z.attackTimer = 0;
  if (z.attacking) { z.punch.stop(); z.walk.play(); z.attacking = false; }
}
function setZombieCount(n) {
  while (zombies.length < n) spawnZombie();
  while (zombies.length > n) {
    const z = zombies.pop();
    scene.remove(z.mesh);
    z.mixer.stopAllAction();
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

// ?anim=N updates each zombie's skeleton only every Nth frame (staggered across the horde).
const animEvery = Math.max(1, Number(params.get('anim') ?? 1));
let frameNo = 0;

function update(dt) {
  rangerMixer.update(dt);
  frameNo++;
  for (let i = 0; i < zombies.length; i++) {
    const z = zombies[i];
    if (!z.attacking) {
      z.mesh.position.z += z.speed * dt;
      if (z.mesh.position.z >= WALL_ROW - 0.35) {
        z.attacking = true;
        z.walk.stop();
        z.punch.play();
      }
    } else if ((z.attackTimer += dt) > 6) {
      resetZombie(z); // loop the horde so the test runs indefinitely
    }
    z.animDt = (z.animDt ?? 0) + dt;
    const animate = (frameNo + i) % animEvery === 0;
    if (animate) { z.mixer.update(z.animDt); z.animDt = 0; }
    // Skipped frames also skip the subtree's bone matrix updates, where most of the cost is.
    // The zombie's on-screen position lags by at most animEvery-1 frames, which is not visible.
    z.mesh.matrixWorldAutoUpdate = animate;
  }
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
      shadows: useShadows, yaw: yawDeg, ...timings,
    };
    statsEl.textContent =
      `FPS ${lastStats.fps}  (avg ${lastStats.avgMs} ms, worst ${lastStats.worstMs} ms)\n` +
      `zombies ${lastStats.zombies}   draw calls ${info.calls}   tris ${info.triangles}\n` +
      `shadows ${useShadows ? 'on' : 'off'}   load ${timings.loadMs} ms\n` +
      `wheel: zoom   V: toggle yaw 45/0`;
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
