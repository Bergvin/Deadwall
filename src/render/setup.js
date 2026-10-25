// Renderer, scene, lighting and ground for the battlefield.
import * as THREE from 'three';

export const PALETTE = {
  background: 0x15161a,
  ground: 0x2e2c25,
  groundSpawn: 0x3a1c1a,
  groundCastle: 0x34322d,
  torch: 0xff8a3c,
};

/** @param {HTMLElement} container @param {{width:number,height:number}} map */
export function createStage(container, map, cameraDistance) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PALETTE.background);
  // The camera sits cameraDistance from the map center: fog only dims the far north side.
  scene.fog = new THREE.Fog(PALETTE.background, cameraDistance + 4, cameraDistance + 30);

  const center = new THREE.Vector3(map.width / 2, 0, map.height / 2);
  scene.add(new THREE.HemisphereLight(0x9aa8c8, 0x302418, 2.2));
  const moon = new THREE.DirectionalLight(0xc0ccff, 2.2);
  moon.position.set(center.x - 12, 25, center.z - 8);
  moon.target.position.copy(center);
  moon.castShadow = true;
  moon.shadow.mapSize.set(2048, 2048);
  const r = Math.max(map.width, map.height) * 0.8;
  Object.assign(moon.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 1, far: 90 });
  scene.add(moon, moon.target);

  // Ground extends past the map so panning never shows the void.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(map.width + 40, map.height + 40),
    new THREE.MeshStandardMaterial({ color: PALETTE.ground, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.copy(center);
  ground.receiveShadow = true;
  scene.add(ground);

  return { renderer, scene, center };
}
