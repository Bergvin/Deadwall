// Hand-made battlefields. Every map is 30 x 24 cells (x east, y south). The zombies walk
// along the roads (polylines in world units, cell centre = x + 0.5) from the map edge to
// the house; towers go on free ground beside the roads. Each map poses its own problem.
//
//   house      world centre of the 2x2 house (integers; its cells are x-1..x, z-1..z)
//   roads      { points: [[x, z], ...], from: first wave it is used, weight: share of spawns }
//   blocked    [x, y] cells (rocks, water) that are neither buildable nor walkable
//   water      [x0, y0, x1, y1] rectangles of blocked river cells (drawn as water)
//   mods       map modifiers: enemyHpMult, enemySpeedMult, startingGold, rangeAdd (towers)
//   unlock     { map, wave }: reaching `wave` on `map` unlocks this one

export const MAPS = [
  {
    id: 'oldroad',
    name: 'The Old Road',
    description: 'One long, winding road. Learn where a tower covers the most of it.',
    tip: 'Corners are gold: a tower inside a bend reaches the road twice.',
    house: { x: 15, z: 21 },
    roads: [
      { points: [[15, -0.5], [15, 4.5], [6.5, 4.5], [6.5, 10.5], [23.5, 10.5], [23.5, 16.5], [15, 16.5], [15, 19.6]], from: 1, weight: 1 },
    ],
    blocked: [[3, 8], [4, 8], [26, 6], [27, 6], [19, 13], [10, 18], [2, 15], [27, 19]],
    water: [],
    mods: {},
    unlock: null,
  },
  {
    id: 'crossroads',
    name: 'Crossroads',
    description: 'Two roads from the north-west and north-east meet before the house.',
    tip: 'The junction sees both roads, but leave something for each side.',
    house: { x: 15, z: 21 },
    roads: [
      { points: [[-0.5, 3.5], [8.5, 3.5], [8.5, 13.5], [15, 13.5], [15, 19.6]], from: 1, weight: 1 },
      { points: [[30.5, 6.5], [21.5, 6.5], [21.5, 13.5], [15, 13.5], [15, 19.6]], from: 1, weight: 1 },
    ],
    blocked: [[3, 9], [4, 9], [25, 11], [26, 11], [15, 7], [12, 18], [19, 18], [2, 19], [27, 18]],
    water: [],
    mods: { enemyHpMult: 1.05 },
    unlock: { map: 'oldroad', wave: 10 },
  },
  {
    id: 'riverbend',
    name: 'River Bend',
    description: 'A river cuts the land in two. Two bridges, little ground to build on.',
    tip: 'The bridges are choke points, but the river bank is narrow. Plan every spot.',
    house: { x: 15, z: 21 },
    roads: [
      { points: [[7.5, -0.5], [7.5, 10.5], [15, 10.5], [15, 19.6]], from: 1, weight: 1 },
      { points: [[23.5, -0.5], [23.5, 10.5], [15, 10.5], [15, 19.6]], from: 4, weight: 1 },
    ],
    blocked: [[3, 3], [26, 2], [11, 15], [19, 15], [12, 2], [17, 3]],
    water: [[0, 6, 6, 7], [9, 6, 22, 7], [25, 6, 29, 7], [0, 13, 13, 13], [17, 13, 29, 13]],
    mods: { enemyHpMult: 1.1 },
    unlock: { map: 'crossroads', wave: 10 },
  },
  {
    id: 'hollow',
    name: 'The Hollow',
    description: 'The house stands in the middle. The dead come from three sides.',
    tip: 'No single spot covers it all. Your runner will run a lot here.',
    house: { x: 15, z: 12 },
    roads: [
      { points: [[15, -0.5], [15, 4.5], [9.5, 4.5], [9.5, 8.5], [15, 8.5], [15, 10.6]], from: 1, weight: 1.2 },
      { points: [[-0.5, 18.5], [6.5, 18.5], [6.5, 12.5], [13.4, 12.5]], from: 3, weight: 1 },
      { points: [[30.5, 20.5], [22.5, 20.5], [22.5, 12.5], [16.6, 12.5]], from: 6, weight: 1 },
    ],
    blocked: [[3, 3], [26, 3], [27, 4], [11, 16], [19, 17], [3, 22], [26, 15], [20, 7]],
    water: [],
    mods: { enemyHpMult: 1.1, startingGold: 380 },
    unlock: { map: 'riverbend', wave: 10 },
  },
  {
    id: 'longmarch',
    name: 'The Long March',
    description: 'A serpent of a road. Fast, hungry dead and a long way to stop them.',
    tip: 'Time is on your side, ammo is not: the runner has far to go.',
    house: { x: 15, z: 21 },
    roads: [
      { points: [[25.5, -0.5], [25.5, 3.5], [4.5, 3.5], [4.5, 8.5], [25.5, 8.5], [25.5, 13.5], [4.5, 13.5], [4.5, 21], [13.4, 21]], from: 1, weight: 1 },
    ],
    blocked: [[15, 6], [16, 6], [15, 11], [14, 11], [28, 18], [20, 18], [1, 1]],
    water: [],
    mods: { enemyHpMult: 1.25, enemySpeedMult: 1.35 },
    unlock: { map: 'hollow', wave: 10 },
  },
];

/** Map by id (the first map when unknown). */
export function mapById(id) {
  return MAPS.find((m) => m.id === id) ?? MAPS[0];
}

/** Shared map dimensions and road layout rules. */
export const MAP_RULES = {
  width: 30,
  height: 24,
  /** Cells within this distance of a road's centre line are road (not buildable). */
  roadHalfWidth: 0.95,
  /** Zombies walk this far left/right of the centre line at most. */
  laneHalfWidth: 0.45,
  /** Each road's portal stands this far along the road; the dead step out of it. */
  portalS: 1.6,
  /** Size of the portal's glowing gate (world units). */
  portal: { width: 1.5, height: 2.1 },
};
