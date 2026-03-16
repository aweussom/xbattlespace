# XBattle — Level Design Plan

## Goal

Generate 300 level JSON files: 100 levels × 3 difficulty tiers.
Each level exists as three files sharing the same map layout but with
different AI parameters:
- `levels/easy/001.json` through `levels/easy/100.json`
- `levels/medium/001.json` through `levels/medium/100.json`
- `levels/hard/001.json` through `levels/hard/100.json`

---

## Level JSON Schema

```json
{
  "id": 1,
  "name": "First Contact",
  "difficulty": 1,
  "archetype": "expansion",
  "players": [
    { "id": 0, "color": "#00ffff", "name": "You" },
    { "id": 1, "color": "#ff00ff", "name": "Rival" }
  ],
  "ai": {
    "count": 1,
    "moveInterval": 5000,
    "attackRatio": 2.0,
    "forceThreshold": 15,
    "topPlanetsPerTick": 1
  },
  "planets": [
    { "id": 0, "x": 0.15, "y": 0.50, "radius": 24, "owner": 0, "forces": 30, "productionRate": 2 },
    { "id": 1, "x": 0.85, "y": 0.50, "radius": 24, "owner": 1, "forces": 30, "productionRate": 2 },
    { "id": 2, "x": 0.50, "y": 0.50, "radius": 20, "owner": null, "forces": 8,  "productionRate": 1 }
  ],
  "maxForceRange": 320
}
```

### Field Notes
- `x` and `y` are normalized 0.0–1.0, scaled to canvas at load time
- `radius` in pixels (pre-scale): range 14–32 for neutrals, 22–26 for starting planets
- `owner`: 0 = human, 1..N = AI players, null = neutral
- `forces`: starting garrison. Human and AI home planets always start at 30
- `productionRate`: 1 for small/weak neutrals, 2 for medium, 3 for large strategic planets
- `archetype`: flavor tag for the map layout (see below)
- `maxForceRange`: 320 for all levels (matches game constant)

---

## AI Parameter Ranges by Difficulty

These apply to the `ai` block. Same map layout, different parameters.

| Parameter        | Easy          | Medium        | Hard          |
|------------------|---------------|---------------|---------------|
| `count`          | 1             | 2             | 3             |
| `moveInterval`   | 5000–4500ms   | 4000–3000ms   | 2800–2000ms   |
| `attackRatio`    | 2.0–1.8       | 1.8–1.5       | 1.5–1.2       |
| `forceThreshold` | 15            | 12            | 8             |
| `topPlanetsPerTick` | 1          | 1–2           | 2–3           |

Within each tier, parameters should tighten gradually across the 100 levels.
Level 1 Easy uses the slowest/most passive values; Level 100 Easy uses the
fastest within the Easy range. Hard level 100 is the hardest possible.

---

## Difficulty Curve Across 100 Levels

Divide the 100 levels into bands. Each band introduces new tactical pressure:

### Band 1: Levels 1–10 — Tutorial / Orientation
- 1 AI opponent
- 6–10 total planets
- Symmetrical layout, player has clear positional advantage
- Wide open map, no chokepoints
- Neutrals are weak (forces 4–8, productionRate 1)
- AI starts with 1 planet, player starts with 2–3
- Goal: player learns routing, supply lines, basic timing

### Band 2: Levels 11–25 — Expansion Racing
- 1–2 AI opponents
- 10–16 total planets
- Still mostly symmetrical but neutrals are more spread out
- Some neutrals have productionRate 2 — contested objectives
- AI starts equal to player (1 planet each)
- Player must prioritize which neutrals to grab first
- Goal: teach expansion priority

### Band 3: Levels 26–40 — Chokepoints
- 1–2 AI opponents
- 12–18 total planets
- Maps have deliberate bottleneck planets — single connections between clusters
- Holding the chokepoint planet wins the game
- Some planets have high productionRate (2–3) but are deep in enemy territory
- Goal: teach positional play and route cancellation for defense

### Band 4: Levels 41–55 — Asymmetric Starts
- 2 AI opponents
- 15–22 total planets
- Player starts in a weaker position (fewer nearby planets, smaller cluster)
- Must compensate through better routing efficiency
- AI opponents may start with small force advantages
- Goal: teach playing from behind, Lanchester mass-force tactics

### Band 5: Levels 56–70 — Multi-Front Pressure
- 2–3 AI opponents
- 18–26 total planets
- Player is flanked — AI starts in corners adjacent to player's corner
- Must defend on one front while expanding on another
- Introduces "fortress" planets: radius 28–30, high forces (20–25), productionRate 3
- These are worth taking but expensive to crack
- Goal: teach route management across multiple simultaneous fronts

### Band 6: Levels 71–85 — Siege Maps
- 2–3 AI opponents
- 20–30 total planets
- One or more large neutral fortress planets dominate the centre
- Production taper under siege mechanic becomes important here
- AI opponents are well-positioned relative to the fortress
- Player must mass forces before committing to the fortress assault
- Goal: teach Lanchester — trickle attacks are punished, mass strikes rewarded

### Band 7: Levels 86–100 — Expert / Hostile
- 3 AI opponents
- 25–35 total planets
- Player starts in the most geometrically disadvantaged position
- AI starts with equal or slightly larger initial forces
- Dense planet clusters reward positional control
- Some maps are "island" designs — clusters connected by single long-range links
- Goal: test mastery of all systems simultaneously

---

## Map Archetypes

Tag each level with one of these archetypes to ensure variety:

| Archetype      | Description                                                        |
|----------------|--------------------------------------------------------------------|
| `expansion`    | Open map, race to neutrals, no chokepoints                        |
| `chokepoint`   | Single or double bottleneck planet between territories            |
| `fortress`     | One large high-value planet dominates the centre                  |
| `island`       | Two or more clusters connected by long-range single links         |
| `flanked`      | AI starts adjacent to player, no safe expansion direction         |
| `corridor`     | Map is elongated, forces travel long distances                    |
| `symmetric`    | Mirror layout, pure execution test                                |
| `asymmetric`   | Deliberately unequal positions, player disadvantaged              |
| `cluster`      | Dense groups of small planets, rapid back-and-forth combat        |
| `sparse`       | Few planets, wide spacing, every decision matters                 |

Distribute archetypes across the 100 levels. No archetype should repeat
more than 15 times. Consecutive levels should not share the same archetype.

---

## Planet Layout Guidelines

### Coordinate Constraints
- No planet center within 0.06 units of canvas edge (keep planets visible)
- Minimum distance between any two planet centers: 0.10 units (normalized)
- All planets must be reachable from at least one other planet within
  maxForceRange (320px at 1920×1080 ≈ 0.167 normalized units)
- Ideally every planet has 2+ neighbors within range (no dead ends)

### Starting Planet Placement
- Human always starts near (0.10–0.20, 0.75–0.90) — bottom-left region
- AI 1 always starts near (0.80–0.90, 0.10–0.25) — top-right region  
- AI 2 (if present) starts near (0.80–0.90, 0.75–0.90) — bottom-right
- AI 3 (if present) starts near (0.10–0.20, 0.10–0.25) — top-left
- Starting planets: radius 24, forces 30, productionRate 2

### Neutral Planet Design
- Weak neutrals (stepping stones): radius 14–18, forces 4–8, productionRate 1
- Medium neutrals (expansion targets): radius 18–22, forces 8–14, productionRate 1–2
- Strategic planets (contested objectives): radius 22–28, forces 14–22, productionRate 2–3
- Fortress planets (siege targets): radius 26–32, forces 20–30, productionRate 3

### Balance Check Per Level
Before finalising a level, verify:
- Total neutral production ≤ 3× any single player's starting production
- No neutral planet is unreachable from any starting position (path must exist)
- No single player's starting corner has more than 2 neutrals within immediate
  range (first-ring) that others can't also contest

---

## Level Naming Convention

Names should be evocative, short (2–4 words), space-themed.
Progress from calm to ominous across the 100 levels:

Early levels (1–25): calm/exploratory
- "First Contact", "Quiet Sector", "Frontier Post", "Twin Moons",
  "The Gap", "Scattered Rocks", "Outpost Run", "Drift Zone"

Mid levels (26–60): tactical/contested  
- "The Crossing", "Bone Corridor", "Siege Ring", "The Gauntlet",
  "Flanking Run", "Iron Gate", "Deadlock", "Pressure Point"

Late levels (61–100): hostile/desperate
- "Last Stand", "The Maw", "Hostile Core", "No Quarter",
  "Surrounded", "Final Approach", "Endgame", "The Reckoning"

---

## File Generation Instructions for Claude Code

1. Generate all 100 map layouts first (planet coordinates, neutral properties)
   Save as `levels/maps/001.json` through `levels/maps/100.json`
   These contain planets array + name + archetype but NO ai block

2. For each map, generate three difficulty variants by adding the ai block:
   - `levels/easy/NNN.json` — Easy AI parameters
   - `levels/medium/NNN.json` — Medium AI parameters  
   - `levels/hard/NNN.json` — Hard AI parameters

3. Validate each level file:
   - All planet x/y values in 0.0–1.0 range
   - No two planets closer than 0.10 normalized units
   - At least one neighbor within 0.167 normalized units for every planet
   - Human start near bottom-left, AI starts in correct corners
   - ai.count matches difficulty (1/2/3)

4. Output a `levels/index.json` manifest:
```json
{
  "totalLevels": 100,
  "difficulties": ["easy", "medium", "hard"],
  "levels": [
    { "id": 1, "name": "First Contact", "archetype": "expansion",
      "easy": "easy/001.json", "medium": "medium/001.json", "hard": "hard/001.json" }
  ]
}
```

---

## Game Code Changes Required

Before levels can be loaded, `game.js` needs:

### `loadLevel(levelData)`
Replaces `generatePlanets()` and `assignStartingPlanets()`:
```js
loadLevel(levelData) {
    this.planets = levelData.planets.map(p => ({
        ...p,
        x: p.x * this.canvas.width,
        y: p.y * this.canvas.height,
        capacity:   Math.floor(p.radius * this.CAPACITY_PER_RADIUS),
        maxForces:  Math.floor(p.radius * this.MAX_FORCES_PER_RADIUS),
        lastProduction: Date.now(),
        lastDecay:      Date.now()
    }));

    // Apply AI parameters from level
    const ai = levelData.ai;
    this.AI_MOVE_INTERVAL = ai.moveInterval;
    this.aiAttackRatio    = ai.attackRatio;
    this.ROUTE_THRESHOLD  = ai.forceThreshold;
    this.aiTopPlanets     = ai.topPlanetsPerTick;

    // Rebuild players array from level
    this.players = levelData.players.map(p => ({ ...p }));
    this.aiLastMove = new Array(this.players.length).fill(0);
}
```

### Level Progression UI
- Show current level number and name during play (top-left, small)
- On win: "Next Level" button advances to level N+1 same difficulty
- On loss: "Retry" button replays same level
- Main menu: difficulty selection + level select grid (unlocked levels only)
- Track highest unlocked level per difficulty in localStorage

### Level Select
- Grid of level buttons, locked/unlocked state
- Show archetype icon per level (optional but nice)
- Allow replaying any unlocked level

---

## Notes

- The random generation (`generatePlanets`, `assignStartingPlanets`) should be
  kept as a "Quick Play" / sandbox mode — don't delete it
- All 300 files should be valid JSON, minified is fine
- Total file size for 300 levels should be under 2MB
- Planet radius values are in logical pixels at 1920×1080;
  the loadLevel function scales x/y but NOT radius —
  radius stays fixed regardless of screen size
- If canvas is smaller than 1080p, small planets may look cramped —
  acceptable for now, fix in a later pass if needed

---

## Human Benchmarking (Required Before Level Generation)

### Why

The difficulty curve, AI parameters, and planet layouts are meaningless without
baseline data on how a real human plays. Without benchmarking:

- Win rate targets (60% Easy, 40% Hard) are pure speculation
- Expansion timing (when the player captures their first neutral) is unknown
- Route management patterns (chain depth, how many active routes) are assumed
- Reaction time to threats (how quickly routes are cancelled) has no data

### Protocol

Play **5 games per difficulty** (15 total) on random maps. The game now
auto-downloads a JSON benchmark log on win/loss. Each log contains:

1. **game_start** — difficulty, player count, planet count
2. **send** — every human force send: source, target, amount, target owner
3. **route_set** / **route_cancel** — every human routing decision
4. **box_select** / **box_cancel** — multi-planet selection events
5. **capture** — every planet ownership change (all players)
6. **snapshot** — board state every 5 seconds: per-player planets, forces, routes
7. **game_end** — result, final scores, total duration

### Key Metrics to Extract

From the benchmark logs, compute:

| Metric | Description | Used For |
|---|---|---|
| `firstCaptureTime` | Seconds until player captures first neutral | Band 1 planet count tuning |
| `expansionRate` | Planets captured per minute in first 60s | Neutral density per difficulty |
| `peakPlanets` | Maximum planets owned at any point | Map size validation |
| `avgActiveRoutes` | Average concurrent routes at snapshots | Route complexity expectations |
| `maxChainDepth` | Longest relay chain used | Smart routing level design |
| `routeCancelRate` | Route cancels per minute | Defense frequency |
| `avgSendSize` | Average force amount per send | Starting force calibration |
| `winTime` | Game duration on wins | Level pacing targets |
| `lossTime` | Game duration on losses | Detect snowball speed |
| `capturesPerMinute` | Total captures / minutes (all players) | Map activity level |

### Analysis Script

After collecting 15 benchmark files, run an analysis to extract the metrics above
and produce a `benchmarks/summary.json` with averages per difficulty:

```json
{
  "easy": {
    "games": 5, "wins": 3, "winRate": 0.6,
    "avgFirstCapture": 6.2,
    "avgExpansionRate": 3.1,
    "avgPeakPlanets": 12,
    "avgActiveRoutes": 2.8,
    "avgWinTime": 142,
    "avgLossTime": 95
  },
  "medium": { ... },
  "hard": { ... }
}
```

### How Benchmarks Feed Level Design

| Benchmark Finding | Level Design Action |
|---|---|
| First capture at ~6s → | Band 1 nearest neutral must be within 1-send range |
| Expansion rate 3/min → | ~10 neutrals for 3-minute Easy games, ~20 for Hard |
| Peak 12 planets → | Total planets = peak × 2.5 (room for AI and contested) |
| 2.8 avg routes → | Chokepoint maps need ≤3 key paths to manage |
| Win time ~140s → | Target level duration: 2–3 minutes Easy, 4–5 Hard |
| Route cancel rate → | If high: player is defensive, add more siege maps |

### Console Access

The game instance is exposed as `window.game`. Manual log download:
```js
game.downloadLog()       // download current session log
game.eventLog            // inspect events in console
game.eventLog.length     // quick event count check
```
