// Model registry: game names -> files plus normalisation. To swap a model, edit only this file.
// fit: scale uniformly so the bounding box size on `axis` equals `size` (world units = cells).
// Kenney castle/graveyard pieces are authored at 1 unit per cell, so they need no fit.

export const MODELS = {
  // Castle kit (rotation 0: straight wall runs north-south; corner connects south + west)
  wallStraight: { url: '/models/kenney/wall.glb' },
  wallCorner: { url: '/models/kenney/wall-corner.glb' },
  wallPillar: { url: '/models/kenney/wall-pillar.glb' },
  towerBase: { url: '/models/kenney/tower-square-base.glb' },
  towerMid: { url: '/models/kenney/tower-square-mid.glb' },
  towerTop: { url: '/models/kenney/tower-square-top.glb' },
  towerRoof: { url: '/models/kenney/tower-square-roof.glb' },
  gateDoor: { url: '/models/kenney/gate.glb' },
  flag: { url: '/models/kenney/flag-wide.glb' },
  rocksLarge: { url: '/models/kenney/rocks-large.glb' },
  rocksSmall: { url: '/models/kenney/rocks-small.glb' },

  // Graveyard kit (environment)
  pineCrooked: { url: '/models/graveyard/pine-crooked.glb' },
  pine: { url: '/models/graveyard/pine.glb' },
  rocks: { url: '/models/graveyard/rocks.glb' },
  rocksTall: { url: '/models/graveyard/rocks-tall.glb' },
  fireBasket: { url: '/models/graveyard/fire-basket.glb' },
  debris: { url: '/models/graveyard/debris.glb' },
  gravestone: { url: '/models/graveyard/gravestone-broken.glb' },
  trunk: { url: '/models/graveyard/trunk.glb' },

  // Characters (phase 2+)
  // Heroes. anims maps roles to clip names: idle, ready (has a target), attack, cast, walk.
  archer: {
    url: '/models/heroes/Ranger.gltf', fit: { axis: 'y', size: 0.9 },
    anims: { idle: 'Idle', ready: 'Idle_Attacking', attack: 'Bow_Shoot', cast: 'Bow_Draw', walk: 'Walk' },
  },
  mage: {
    url: '/models/heroes/Wizard.gltf', fit: { axis: 'y', size: 0.9 },
    anims: { idle: 'Idle', ready: 'Idle_Attacking', attack: 'Staff_Attack', cast: 'Spell1', walk: 'Walk' },
  },
  warrior: {
    url: '/models/heroes/Warrior.gltf', fit: { axis: 'y', size: 0.95 },
    anims: { idle: 'Idle', ready: 'Idle_Attacking', attack: 'Sword_Attack', cast: 'Sword_Attack2', walk: 'Walk' },
  },
  crossbowman: {
    url: '/models/heroes/Rogue.gltf', fit: { axis: 'y', size: 0.9 },
    anims: { idle: 'Idle', ready: 'Attacking_Idle', attack: 'Punch', cast: 'Dagger_Attack2', walk: 'Walk' },
  },
  paladin: {
    url: '/models/heroes/Cleric.gltf', fit: { axis: 'y', size: 0.95 },
    anims: { idle: 'Idle', ready: 'Idle_Weapon', attack: 'Staff_Attack', cast: 'Spell1', walk: 'Walk' },
  },
  alchemist: {
    url: '/models/heroes/Monk.gltf', fit: { axis: 'y', size: 0.9 },
    anims: { idle: 'Idle', ready: 'Idle_Attacking', attack: 'Attack', cast: 'Attack2', walk: 'Walk' },
  },
  walker: { url: '/models/zombies/Zombie_Basic.gltf', fit: { axis: 'y', size: 0.85 } },
};
