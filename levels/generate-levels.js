const fs = require('fs');
const path = require('path');

// ── Constants ──────────────────────────────────────────────────────────────────

const PLAYER_COLORS = [
  { id: 0, color: '#00ffff', name: 'You' },
  { id: 1, color: '#ff00ff', name: 'Rival' },
  { id: 2, color: '#00ff00', name: 'Player 3' },
  { id: 3, color: '#ffaa00', name: 'Player 4' },
];

const AI_PARAMS = {
  easy: {
    '1-3':  { moveInterval: 5000, attackRatio: 2.0, forceThreshold: 15, topPlanetsPerTick: 1 },
    '4-6':  { moveInterval: 4800, attackRatio: 1.95, forceThreshold: 15, topPlanetsPerTick: 1 },
    '7-10': { moveInterval: 4600, attackRatio: 1.9, forceThreshold: 15, topPlanetsPerTick: 1 },
  },
  medium: {
    '1-3':  { moveInterval: 4000, attackRatio: 1.8, forceThreshold: 12, topPlanetsPerTick: 1 },
    '4-6':  { moveInterval: 3700, attackRatio: 1.7, forceThreshold: 12, topPlanetsPerTick: 1 },
    '7-10': { moveInterval: 3400, attackRatio: 1.6, forceThreshold: 12, topPlanetsPerTick: 2 },
  },
  hard: {
    '1-3':  { moveInterval: 2800, attackRatio: 1.5, forceThreshold: 8, topPlanetsPerTick: 2 },
    '4-6':  { moveInterval: 2500, attackRatio: 1.4, forceThreshold: 8, topPlanetsPerTick: 2 },
    '7-10': { moveInterval: 2200, attackRatio: 1.3, forceThreshold: 8, topPlanetsPerTick: 3 },
  },
};

function getAiTier(id) { return id <= 3 ? '1-3' : id <= 6 ? '4-6' : '7-10'; }
function getAiCount(d) { return d === 'easy' ? 1 : d === 'medium' ? 2 : 3; }
function getPlayers(d) { return PLAYER_COLORS.slice(0, getAiCount(d) + 1); }

// ── Planet builder ─────────────────────────────────────────────────────────────

function mkPlanet(id, x, y, radius, owner, forces, prod) {
  return { id, x, y, radius, owner, forces, productionRate: prod };
}

// ── Level definitions ──────────────────────────────────────────────────────────
// Each level is an array of [x, y, radius, owner, forces, productionRate].
// Ids are assigned sequentially (index).
//
// VERIFIED KEY DISTANCES (all in normalized 0-1 coords):
//   start(0.15,0.85) to step(0.24,0.76): d=0.127
//   step(0.24,0.76) to bridge(0.35,0.67): d=0.141
//   bridge(0.35,0.67) to inner(0.46,0.58): d=0.141
//   chain along x or y with delta 0.13: d=0.130
//   chain along x or y with delta 0.12: d=0.120
//   diagonal delta(+0.11,+0.11): d=0.156
//   diagonal delta(+0.10,+0.10): d=0.141
//   diagonal delta(+0.09,+0.09): d=0.127
//
// Standard corner starts (in valid zones):
//   Human BL: (0.15, 0.85)    AI1 TR: (0.85, 0.15)
//   AI2 BR:   (0.85, 0.85)    AI3 TL: (0.15, 0.15)
//
// Standard stepping stones (d=0.127 from start):
//   stepH:  (0.24, 0.76)    stepA1: (0.76, 0.24)
//   stepA2: (0.76, 0.76)    stepA3: (0.24, 0.24)

function defineLevels() {
  const levels = [];

  // Shared start + step arrays
  const starts = [
    [0.15, 0.85, 24, 0, 30, 2],   // Human BL
    [0.85, 0.15, 24, 1, 30, 2],   // AI1 TR
    [0.85, 0.85, 24, 2, 30, 2],   // AI2 BR
    [0.15, 0.15, 24, 3, 30, 2],   // AI3 TL
  ];
  const steps = [
    [0.24, 0.76, 16, null, 6, 1],  // stepH
    [0.76, 0.24, 16, null, 6, 1],  // stepA1
    [0.76, 0.76, 16, null, 6, 1],  // stepA2
    [0.24, 0.24, 16, null, 6, 1],  // stepA3
  ];

  // ─── Level 1: "First Contact" — symmetric, 8 planets ───
  // Tutorial. 4 starts + 4 stepping-stone neutrals. Mirror layout.
  levels.push({
    id: 1, name: 'First Contact', archetype: 'symmetric',
    raw: [...starts, ...steps],
  });

  // ─── Level 2: "Quiet Sector" — expansion, 12 planets ───
  // Open map. 4 starts + 4 steps + 4 bridge neutrals toward center.
  levels.push({
    id: 2, name: 'Quiet Sector', archetype: 'expansion',
    raw: [
      ...starts, ...steps,
      [0.35, 0.67, 18, null, 8, 1],  // near stepH d=0.141
      [0.65, 0.33, 18, null, 8, 1],  // near stepA1 d=0.141
      [0.65, 0.67, 15, null, 5, 1],  // near stepA2 d=0.141
      [0.35, 0.33, 15, null, 5, 1],  // near stepA3 d=0.141
    ],
  });

  // ─── Level 3: "Frontier Post" — sparse, 11 planets ───
  // Few planets, wide spacing. Bridge chains toward center strategic planet.
  levels.push({
    id: 3, name: 'Frontier Post', archetype: 'sparse',
    raw: [
      ...starts, ...steps,
      [0.35, 0.67, 18, null, 8, 1],   // near stepH d=0.141
      [0.46, 0.58, 22, null, 12, 2],  // center strategic, near prev d=0.141
      [0.65, 0.33, 18, null, 8, 1],   // near stepA1 d=0.141
    ],
  });

  // ─── Level 4: "Scattered Rocks" — corridor, 12 planets ───
  // Diagonal corridor BL to TR through center.
  levels.push({
    id: 4, name: 'Scattered Rocks', archetype: 'corridor',
    raw: [
      ...starts, ...steps,
      // Corridor: stepH -> chain -> stepA1
      [0.35, 0.67, 16, null, 6, 1],   // near stepH d=0.141
      [0.46, 0.56, 18, null, 10, 1],  // near prev d=0.156
      [0.57, 0.43, 18, null, 10, 1],  // near prev d=0.166 (sqrt(0.0121+0.0169))
      [0.65, 0.33, 16, null, 6, 1],   // near prev d=sqrt(0.0064+0.01)=0.128, near stepA1 d=0.141
    ],
  });

  // ─── Level 5: "The Gap" — expansion, 14 planets ───
  // Race to grab neutrals. All four directions have expansion targets.
  levels.push({
    id: 5, name: 'The Gap', archetype: 'expansion',
    raw: [
      ...starts, ...steps,
      // Bridges from steps toward center
      [0.35, 0.67, 18, null, 8, 2],   // near stepH d=0.141
      [0.65, 0.33, 18, null, 8, 2],   // near stepA1 d=0.141
      [0.65, 0.67, 15, null, 5, 1],   // near stepA2 d=0.141
      [0.35, 0.33, 15, null, 5, 1],   // near stepA3 d=0.141
      // Center pair
      [0.46, 0.58, 20, null, 12, 2],  // near bridge8 d=0.141
      [0.54, 0.42, 20, null, 12, 2],  // near bridge9 d=0.141
    ],
  });

  // ─── Level 6: "Twin Moons" — symmetric, 16 planets ───
  // Mirror with 2 strategic contested "moons" in center.
  levels.push({
    id: 6, name: 'Twin Moons', archetype: 'symmetric',
    raw: [
      ...starts, ...steps,
      // Inner ring bridges
      [0.35, 0.67, 16, null, 6, 1],   // near stepH d=0.141
      [0.65, 0.33, 16, null, 6, 1],   // near stepA1 d=0.141
      [0.65, 0.67, 16, null, 6, 1],   // near stepA2 d=0.141
      [0.35, 0.33, 16, null, 6, 1],   // near stepA3 d=0.141
      // Twin strategic center moons
      [0.44, 0.56, 24, null, 18, 2],  // near bridge8 d=sqrt(0.0081+0.0121)=0.142
      [0.56, 0.44, 24, null, 18, 2],  // near bridge9 d=0.142
      // Cross connectors
      [0.44, 0.44, 14, null, 4, 1],   // near moon13 d=0.12, near bridge11 d=0.141
      [0.56, 0.56, 14, null, 4, 1],   // near moon12 d=0.12, near bridge10 d=0.141
    ],
  });

  // ─── Level 7: "Outpost Run" — cluster, 18 planets ───
  // Dense clusters near starts + center cluster.
  levels.push({
    id: 7, name: 'Outpost Run', archetype: 'cluster',
    raw: [
      ...starts, ...steps,
      // Extra cluster planets near starts (d=0.114-0.122 from start/step)
      [0.12, 0.74, 14, null, 4, 1],  // near startH d=0.114, near stepH d=0.122
      [0.88, 0.26, 14, null, 4, 1],  // near startA1 d=0.114, near stepA1 d=0.122
      [0.88, 0.74, 14, null, 4, 1],  // near startA2 d=0.114, near stepA2 d=0.122
      [0.12, 0.26, 14, null, 4, 1],  // near startA3 d=0.114, near stepA3 d=0.122
      // Center cluster (wider diamond)
      [0.40, 0.50, 16, null, 6, 1],  // center-left
      [0.60, 0.50, 16, null, 6, 1],  // center-right
      [0.50, 0.40, 16, null, 6, 1],  // center-top, near c-left d=0.141, near c-right d=0.141
      [0.50, 0.60, 16, null, 6, 1],  // center-bottom, near c-left d=0.141, near c-right d=0.141
      // Bridges: step to center cluster
      [0.34, 0.64, 14, null, 5, 1],  // near stepH(0.24,0.76) d=0.164, near c-bot(0.50,0.60) d=0.163
      [0.66, 0.36, 14, null, 5, 1],  // near stepA1(0.76,0.24) d=0.164, near c-top(0.50,0.40) d=0.163
    ],
  });

  // ─── Level 8: "The Crossing" — chokepoint, 16 planets ───
  // Single bottleneck planet between territories.
  levels.push({
    id: 8, name: 'The Crossing', archetype: 'chokepoint',
    raw: [
      ...starts, ...steps,
      // Left territory chain (along x=0.24 column from stepH)
      [0.24, 0.63, 16, null, 6, 1],   // near stepH(0.24,0.76) d=0.13
      [0.24, 0.50, 18, null, 8, 1],   // near prev d=0.13
      // Right territory chain (along x=0.76 column from stepA1)
      [0.76, 0.37, 16, null, 6, 1],   // near stepA1(0.76,0.24) d=0.13
      [0.76, 0.50, 18, null, 8, 1],   // near prev d=0.13
      // Chokepoint center
      [0.50, 0.50, 26, null, 20, 3],  // the bottleneck
      // Connectors to chokepoint
      [0.36, 0.50, 14, null, 5, 1],   // near N9(0.24,0.50) d=0.12, near center d=0.14
      [0.64, 0.50, 14, null, 5, 1],   // near N11(0.76,0.50) d=0.12, near center d=0.14
      // Extra connector top
      [0.50, 0.37, 15, null, 6, 1],   // near center(0.50,0.50) d=0.13
    ],
  });

  // ─── Level 9: "Iron Gate" — chokepoint, 18 planets ───
  // Double chokepoint with fortress in center.
  levels.push({
    id: 9, name: 'Iron Gate', archetype: 'chokepoint',
    raw: [
      ...starts, ...steps,
      // Fortress center
      [0.50, 0.50, 30, null, 28, 3],
      // Chokepoint flanks
      [0.38, 0.50, 16, null, 8, 1],   // near fortress d=0.12
      [0.62, 0.50, 16, null, 8, 1],   // near fortress d=0.12
      // Left territory chain
      [0.26, 0.50, 18, null, 10, 2],  // near N9(0.38,0.50) d=0.12
      [0.24, 0.63, 15, null, 6, 1],   // near stepH(0.24,0.76) d=0.13, near N11(0.26,0.50) d=0.133
      [0.24, 0.37, 15, null, 6, 1],   // near stepA3(0.24,0.24) d=0.13, near N11(0.26,0.50) d=0.133
      // Right territory chain
      [0.74, 0.50, 18, null, 10, 2],  // near N10(0.62,0.50) d=0.12
      [0.76, 0.63, 15, null, 6, 1],   // near stepA2(0.76,0.76) d=0.13, near N14(0.74,0.50) d=0.133
      [0.76, 0.37, 15, null, 6, 1],   // near stepA1(0.76,0.24) d=0.13, near N14(0.74,0.50) d=0.133
    ],
  });

  // ─── Level 10: "Pressure Point" — flanked, 20 planets ───
  // Dense layout with AI starting adjacent to player.
  levels.push({
    id: 10, name: 'Pressure Point', archetype: 'flanked',
    raw: [
      ...starts, ...steps,
      // Bridges from steps (d=0.141 from step)
      [0.35, 0.67, 16, null, 6, 1],   // near stepH
      [0.65, 0.33, 16, null, 6, 1],   // near stepA1
      [0.65, 0.67, 16, null, 6, 1],   // near stepA2
      [0.35, 0.33, 16, null, 6, 1],   // near stepA3
      // Inner ring (+/-0.08 from center) - each near its bridge (d=0.114)
      [0.42, 0.58, 18, null, 10, 2],  // near bridge8(0.35,0.67) d=sqrt(0.0049+0.0081)=0.114
      [0.58, 0.42, 18, null, 10, 2],  // near bridge9(0.65,0.33) d=0.114
      [0.58, 0.58, 15, null, 6, 1],   // near bridge10(0.65,0.67) d=0.114
      [0.42, 0.42, 15, null, 6, 1],   // near bridge11(0.35,0.33) d=0.114
      // Center planet
      [0.50, 0.50, 22, null, 14, 2],  // near each inner ring planet d=0.113
      // Flanking planets near starts
      [0.12, 0.74, 14, null, 4, 1],   // near startH d=0.114, near stepH d=0.122
      [0.88, 0.26, 14, null, 4, 1],   // near startA1 d=0.114, near stepA1 d=0.122
    ],
  });

  // Convert raw arrays to planet objects
  return levels.map(level => ({
    id: level.id,
    name: level.name,
    archetype: level.archetype,
    planets: level.raw.map((r, i) => mkPlanet(i, r[0], r[1], r[2], r[3], r[4], r[5])),
  }));
}

// ── Difficulty application ─────────────────────────────────────────────────────

function applyDifficulty(levelDef, difficulty) {
  const aiCount = getAiCount(difficulty);
  const tier = getAiTier(levelDef.id);
  const aiParams = AI_PARAMS[difficulty][tier];

  const planets = levelDef.planets.map(p => {
    const clone = { ...p };
    if (clone.id === 2 && aiCount < 2) clone.owner = null;
    if (clone.id === 3 && aiCount < 3) clone.owner = null;
    return clone;
  });

  return {
    id: levelDef.id,
    name: levelDef.name,
    difficulty,
    archetype: levelDef.archetype,
    players: getPlayers(difficulty),
    ai: { count: aiCount, ...aiParams },
    planets,
    maxForceRange: 320,
  };
}

// ── Validation ─────────────────────────────────────────────────────────────────

function distP(a, b) { return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2); }

function validate(levelJson, filename) {
  const errors = [];
  const planets = levelJson.planets;

  // 1. Bounds check
  for (const p of planets) {
    if (p.x < 0.06 || p.x > 0.94 || p.y < 0.06 || p.y > 0.94) {
      errors.push(`  Planet ${p.id}: out of bounds (${p.x}, ${p.y})`);
    }
  }

  // 2. Min distance (strictly greater than 0.10)
  for (let i = 0; i < planets.length; i++) {
    for (let j = i + 1; j < planets.length; j++) {
      const d = distP(planets[i], planets[j]);
      if (d < 0.10) {
        errors.push(`  Planets ${planets[i].id} & ${planets[j].id}: too close (${d.toFixed(4)})`);
      }
    }
  }

  // 3. Connectivity: every planet needs at least one neighbor within 0.167
  for (const p of planets) {
    const hasNeighbor = planets.some(q => q.id !== p.id && distP(p, q) <= 0.167);
    if (!hasNeighbor) {
      errors.push(`  Planet ${p.id}: no neighbor within 0.167`);
    }
  }

  // 4. Starting position zones (check on hard mode where all are owned)
  const human = planets.find(p => p.id === 0);
  if (human && (human.x < 0.10 || human.x > 0.20 || human.y < 0.75 || human.y > 0.90)) {
    errors.push(`  Human start (${human.x}, ${human.y}) outside bottom-left zone`);
  }

  if (levelJson.difficulty === 'hard') {
    const checks = [
      { id: 1, name: 'AI1', xMin: 0.80, xMax: 0.90, yMin: 0.10, yMax: 0.25 },
      { id: 2, name: 'AI2', xMin: 0.80, xMax: 0.90, yMin: 0.75, yMax: 0.90 },
      { id: 3, name: 'AI3', xMin: 0.10, xMax: 0.20, yMin: 0.10, yMax: 0.25 },
    ];
    for (const c of checks) {
      const p = planets.find(pl => pl.id === c.id);
      if (p && (p.x < c.xMin || p.x > c.xMax || p.y < c.yMin || p.y > c.yMax)) {
        errors.push(`  ${c.name} start (${p.x}, ${p.y}) outside zone`);
      }
    }
  }

  return errors;
}

// ── Main ───────────────────────────────────────────────────────────────────────

const BASE = __dirname;
const DIFFICULTIES = ['easy', 'medium', 'hard'];

for (const diff of DIFFICULTIES) {
  const dir = path.join(BASE, diff);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

const levelDefs = defineLevels();
let totalErrors = 0;
let totalFiles = 0;

for (const levelDef of levelDefs) {
  for (const diff of DIFFICULTIES) {
    const json = applyDifficulty(levelDef, diff);
    const filename = `${String(levelDef.id).padStart(3, '0')}.json`;
    const filepath = path.join(BASE, diff, filename);
    fs.writeFileSync(filepath, JSON.stringify(json, null, 2) + '\n');
    totalFiles++;

    const errors = validate(json, `${diff}/${filename}`);
    if (errors.length > 0) {
      console.log(`FAIL ${diff}/${filename}:`);
      errors.forEach(e => console.log(e));
      totalErrors += errors.length;
    } else {
      console.log(`OK   ${diff}/${filename}`);
    }
  }
}

console.log(`\n=== Generated ${totalFiles} files, ${totalErrors} validation errors ===`);
if (totalErrors > 0) process.exit(1);
