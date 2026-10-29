// Model registry: game names -> files plus normalisation. To swap a model, edit only this file.
// fit: scale uniformly so the bounding box size on `axis` equals `size` (world units = cells).
// Kenney castle/graveyard pieces are authored at 1 unit per cell, so they need no fit.

export const MODELS = {
  // Castle kit (rotation 0: straight wall runs north-south; corner connects south + west)
  wallStraight: { url: 'models/kenney/wall.glb' },
  wallCorner: { url: 'models/kenney/wall-corner.glb' },
  wallPillar: { url: 'models/kenney/wall-pillar.glb' },
  towerBase: { url: 'models/kenney/tower-square-base.glb' },
  towerMid: { url: 'models/kenney/tower-square-mid.glb' },
  towerTop: { url: 'models/kenney/tower-square-top.glb' },
  towerRoof: { url: 'models/kenney/tower-square-roof.glb' },
  towerHexBase: { url: 'models/kenney/tower-hexagon-base.glb' },
  towerHexMid: { url: 'models/kenney/tower-hexagon-mid.glb' },
  towerHexTop: { url: 'models/kenney/tower-hexagon-top.glb' },
  gateDoor: { url: 'models/kenney/gate.glb' },
  flag: { url: 'models/kenney/flag-wide.glb' },
  rocksLarge: { url: 'models/kenney/rocks-large.glb' },
  rocksSmall: { url: 'models/kenney/rocks-small.glb' },

  // Graveyard kit (environment)
  pineCrooked: { url: 'models/graveyard/pine-crooked.glb' },
  pine: { url: 'models/graveyard/pine.glb' },
  rocks: { url: 'models/graveyard/rocks.glb' },
  rocksTall: { url: 'models/graveyard/rocks-tall.glb' },
  fireBasket: { url: 'models/graveyard/fire-basket.glb' },
  debris: { url: 'models/graveyard/debris.glb' },
  gravestone: { url: 'models/graveyard/gravestone-broken.glb' },
  trunk: { url: 'models/graveyard/trunk.glb' },

  // The runner: the Monk, made silly in render/runnerView.js (huge head, crates on his back).
  // anims maps roles to clip names.
  quartermaster: {
    url: 'models/heroes/Monk.gltf', fit: { axis: 'y', size: 0.9 },
    anims: { idle: 'Idle', run: 'Run', work: 'PickUp', bonked: 'RecieveHit', cast: 'Attack2', cheer: 'Idle_Attacking' },
  },
  // Zombies and bosses (baked hordes). zanims maps roles to clips: move, attack, death.
  walker: { url: 'models/zombies/Zombie_Basic.gltf', fit: { axis: 'y', size: 0.85 }, zanims: { move: 'Walk', attack: 'Punch', death: 'Death' } },
  runner: { url: 'models/zombies/Zombie_Arm.gltf', fit: { axis: 'y', size: 0.85 }, zanims: { move: 'Run', attack: 'Punch', death: 'Death' } },
  brute: { url: 'models/zombies/Zombie_Chubby.gltf', fit: { axis: 'y', size: 0.85 }, zanims: { move: 'Walk', attack: 'Punch', death: 'Death' } },
  plague: { url: 'models/zombies/Zombie_Ribcage.gltf', fit: { axis: 'y', size: 0.85 }, zanims: { move: 'Walk', attack: 'HitReact', death: 'Death' } },
  behemoth: { url: 'models/bosses/Yeti.gltf', fit: { axis: 'y', size: 1.9 }, zanims: { move: 'Walk', attack: 'Punch', death: 'Death' } },
  gravelord: { url: 'models/bosses/Demon.gltf', fit: { axis: 'y', size: 1.9 }, zanims: { move: 'Walk', attack: 'Weapon', death: 'Death' } },
};
