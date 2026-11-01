// Model registry: game names -> files plus normalisation. To swap a model, edit only this file.
// fit: scale uniformly so the bounding box size on `axis` equals `size` (world units = cells).
// Kenney castle/graveyard pieces are authored at 1 unit per cell, so they need no fit.

export const MODELS = {
  // Castle kit
  wallPillar: { url: 'models/kenney/wall-pillar.glb' },
  towerBase: { url: 'models/kenney/tower-square-base.glb' },
  towerMid: { url: 'models/kenney/tower-square-mid.glb' },
  towerRoof: { url: 'models/kenney/tower-square-roof.glb' },
  towerHexBase: { url: 'models/kenney/tower-hexagon-base.glb' },
  towerHexMid: { url: 'models/kenney/tower-hexagon-mid.glb' },
  towerHexTop: { url: 'models/kenney/tower-hexagon-top.glb' },
  flag: { url: 'models/kenney/flag-wide.glb' },
  rocksLarge: { url: 'models/kenney/rocks-large.glb' },
  rocksSmall: { url: 'models/kenney/rocks-small.glb' },

  // Graveyard kit (environment)
  pineCrooked: { url: 'models/graveyard/pine-crooked.glb' },
  rocks: { url: 'models/graveyard/rocks.glb' },
  fireBasket: { url: 'models/graveyard/fire-basket.glb' },
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
  // Bestiary monsters (Quaternius) have no clips of their own: they share the humanoid rig of
  // the Universal Animation Library, cut down to the clips we use (tools/glb_tool.py).
  // Kenney graveyard character: rigid parts moved by node animation (baked like the rest).
  skeleton: {
    url: 'models/graveyard/character-skeleton.glb', fit: { axis: 'y', size: 0.8 },
    zanims: { move: 'sprint', attack: 'attack-melee-right', death: 'die' },
  },
  puglin: {
    url: 'models/enemies/Puglin.glb', fit: { axis: 'y', size: 0.85 }, clipsFrom: ['models/enemies/ual1-clips.glb', 'models/enemies/ual2-clips.glb'],
    zanims: { move: 'Zombie_Walk_Fwd_Loop', attack: 'Sword_Attack', death: 'Death01' },
  },
  // KayKit skeletons: clips from KayKit's Rig_Medium animation files.
  skeletonRogue: {
    url: 'models/enemies/Skeleton_Rogue.glb', fit: { axis: 'y', size: 0.85 }, clipsFrom: ['models/enemies/kaykit-move.glb', 'models/enemies/kaykit-general.glb'],
    zanims: { move: 'Running_A', attack: 'Throw', death: 'Death_A' },
  },
  skeletonMage: {
    url: 'models/enemies/Skeleton_Mage.glb', fit: { axis: 'y', size: 0.85 }, clipsFrom: ['models/enemies/kaykit-move.glb', 'models/enemies/kaykit-general.glb'],
    zanims: { move: 'Walking_C', attack: 'Interact', death: 'Death_B' },
  },
  skeletonWarrior: {
    url: 'models/enemies/Skeleton_Warrior.glb', fit: { axis: 'y', size: 0.85 }, clipsFrom: ['models/enemies/kaykit-move.glb', 'models/enemies/kaykit-general.glb'],
    zanims: { move: 'Walking_B', attack: 'Interact', death: 'Death_A' },
  },
  behemoth: { url: 'models/bosses/Yeti.gltf', fit: { axis: 'y', size: 1.9 }, zanims: { move: 'Walk', attack: 'Punch', death: 'Death' } },
  gravelord: { url: 'models/bosses/Demon.gltf', fit: { axis: 'y', size: 1.9 }, zanims: { move: 'Walk', attack: 'Weapon', death: 'Death' } },
};
