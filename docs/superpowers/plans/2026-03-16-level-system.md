# Level System Implementation Plan (10 Levels × 3 Difficulties)

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a level system with 10 hand-designed maps × 3 difficulty variants (30 JSON files), level select UI, progression tracking, and a `loadLevel()` function that replaces random generation when playing campaign mode.

**Architecture:** Level JSON files live in `levels/{easy,medium,hard}/NNN.json` with an `levels/index.json` manifest. A new `level-loader.js` handles fetching and validation. The existing `game.js` gets a `loadLevel(data)` method and the menu gets a "Campaign" vs "Quick Play" fork. Progression is tracked in `localStorage`.

**Tech Stack:** Vanilla JS, HTML5 Canvas, `fetch()` for JSON loading, `localStorage` for progression.

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `levels/index.json` | Create | Manifest of all 10 levels with paths |
| `levels/easy/001.json` – `010.json` | Create | Easy difficulty level data |
| `levels/medium/001.json` – `010.json` | Create | Medium difficulty level data |
| `levels/hard/001.json` – `010.json` | Create | Hard difficulty level data |
| `level-loader.js` | Create | Fetch levels, validate, manage progression in localStorage |
| `game.js` | Modify | Add `loadLevel()`, modify menu flow, add level HUD, win/loss level progression |
| `index.html` | Modify | Add `<script src="level-loader.js">` |

---

## Chunk 1: Level Data (10 Maps × 3 Difficulties)

### Level Design Summary

10 levels, compressed curve across Bands 1-4 from AI-LEVELS.md:

| Lvl | Name | Archetype | Band | Planets | AI Count (E/M/H) | Notes |
|-----|------|-----------|------|---------|-------------------|-------|
| 1 | First Contact | symmetric | 1 | 6 | 1/2/3 | Tutorial: mirror layout, player advantage |
| 2 | Quiet Sector | expansion | 1 | 8 | 1/2/3 | Open map, weak neutrals, learn routing |
| 3 | Frontier Post | sparse | 1 | 9 | 1/2/3 | Few planets, learn to prioritize |
| 4 | Scattered Rocks | corridor | 1-2 | 8 | 1/2/3 | Elongated map, long travel distances |
| 5 | The Gap | expansion | 2 | 10 | 1/2/3 | Race to grab neutrals, contested objectives |
| 6 | Twin Moons | symmetric | 2 | 12 | 1/2/3 | Mirror layout, contested middle objectives |
| 7 | Outpost Run | cluster | 2 | 14 | 1/2/3 | Dense groups of small planets |
| 8 | The Crossing | chokepoint | 3 | 14 | 1/2/3 | Single bottleneck planet between territories |
| 9 | Iron Gate | chokepoint | 3 | 16 | 1/2/3 | Double chokepoint, fortress planet in center |
| 10 | Pressure Point | flanked | 3-4 | 18 | 1/2/3 | AI starts adjacent, no safe expansion direction |

No two consecutive levels share the same archetype.

### AI Parameters by Difficulty (from AI-LEVELS.md ranges, scaled for 10 levels)

**Easy** (1 AI opponent):
| Level | moveInterval | attackRatio | forceThreshold | topPlanetsPerTick |
|-------|-------------|-------------|----------------|-------------------|
| 1-3   | 5000        | 2.0         | 15             | 1                 |
| 4-6   | 4800        | 1.95        | 15             | 1                 |
| 7-10  | 4600        | 1.9         | 15             | 1                 |

**Medium** (2 AI opponents):
| Level | moveInterval | attackRatio | forceThreshold | topPlanetsPerTick |
|-------|-------------|-------------|----------------|-------------------|
| 1-3   | 4000        | 1.8         | 12             | 1                 |
| 4-6   | 3700        | 1.7         | 12             | 1                 |
| 7-10  | 3400        | 1.6         | 12             | 2                 |

**Hard** (3 AI opponents):
| Level | moveInterval | attackRatio | forceThreshold | topPlanetsPerTick |
|-------|-------------|-------------|----------------|-------------------|
| 1-3   | 2800        | 1.5         | 8              | 2                 |
| 4-6   | 2500        | 1.4         | 8              | 2                 |
| 7-10  | 2200        | 1.3         | 8              | 3                 |

### Planet Placement Constraints (from AI-LEVELS.md)

- Coordinates normalized 0.0–1.0
- No planet within 0.06 of canvas edge
- Minimum distance between planets: 0.10
- Every planet reachable within 0.167 (≈320px at 1920×1080)
- Human starts near (0.10-0.20, 0.75-0.90) — bottom-left
- AI 1 near (0.80-0.90, 0.10-0.25) — top-right
- AI 2 near (0.80-0.90, 0.75-0.90) — bottom-right
- AI 3 near (0.10-0.20, 0.10-0.25) — top-left
- Starting planets: radius 24, forces 30, productionRate 2

### Task 1: Create level manifest and all 30 level JSON files

**Files:**
- Create: `levels/index.json`
- Create: `levels/easy/001.json` through `levels/easy/010.json`
- Create: `levels/medium/001.json` through `levels/medium/010.json`
- Create: `levels/hard/001.json` through `levels/hard/010.json`

Each level JSON follows this schema (from AI-LEVELS.md). The `difficulty` field is the difficulty tier name ("easy"/"medium"/"hard"), not the level number:
```json
{
  "id": 1,
  "name": "First Contact",
  "difficulty": "easy",
  "archetype": "symmetric",
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
    { "id": 0, "x": 0.15, "y": 0.85, "radius": 24, "owner": 0, "forces": 30, "productionRate": 2 },
    { "id": 1, "x": 0.85, "y": 0.15, "radius": 24, "owner": 1, "forces": 30, "productionRate": 2 }
  ],
  "maxForceRange": 320
}
```

- [ ] **Step 1: Create directory structure**

```bash
mkdir -p levels/easy levels/medium levels/hard
```

- [ ] **Step 2: Create levels/index.json manifest**

```json
{
  "totalLevels": 10,
  "difficulties": ["easy", "medium", "hard"],
  "levels": [
    { "id": 1, "name": "First Contact", "archetype": "symmetric", "easy": "easy/001.json", "medium": "medium/001.json", "hard": "hard/001.json" },
    { "id": 2, "name": "Quiet Sector", "archetype": "expansion", "easy": "easy/002.json", "medium": "medium/002.json", "hard": "hard/002.json" },
    { "id": 3, "name": "Frontier Post", "archetype": "sparse", "easy": "easy/003.json", "medium": "medium/003.json", "hard": "hard/003.json" },
    { "id": 4, "name": "Scattered Rocks", "archetype": "corridor", "easy": "easy/004.json", "medium": "medium/004.json", "hard": "hard/004.json" },
    { "id": 5, "name": "The Gap", "archetype": "expansion", "easy": "easy/005.json", "medium": "medium/005.json", "hard": "hard/005.json" },
    { "id": 6, "name": "Twin Moons", "archetype": "symmetric", "easy": "easy/006.json", "medium": "medium/006.json", "hard": "hard/006.json" },
    { "id": 7, "name": "Outpost Run", "archetype": "cluster", "easy": "easy/007.json", "medium": "medium/007.json", "hard": "hard/007.json" },
    { "id": 8, "name": "The Crossing", "archetype": "chokepoint", "easy": "easy/008.json", "medium": "medium/008.json", "hard": "hard/008.json" },
    { "id": 9, "name": "Iron Gate", "archetype": "chokepoint", "easy": "easy/009.json", "medium": "medium/009.json", "hard": "hard/009.json" },
    { "id": 10, "name": "Pressure Point", "archetype": "flanked", "easy": "easy/010.json", "medium": "medium/010.json", "hard": "hard/010.json" }
  ]
}
```

- [ ] **Step 3: Design and create all 10 map layouts with 3 difficulty variants each**

**All maps include 4 starting planet positions** (one per corner). The planet array is identical across easy/medium/hard. In easy mode (1 AI), the AI 2 and AI 3 starting planets have `owner: null` (they become neutrals). In medium mode (2 AI), only the AI 3 position is `owner: null`. In hard mode, all 4 starting positions are owned. Only the `players` array, `ai` block, and starting planet `owner` fields differ across difficulties.

**Critical validation per level:**
- All x/y in [0.06, 0.94]
- No two planets closer than 0.10
- Every planet has at least one neighbor within 0.167
- Human start in bottom-left region
- AI starts in correct corners
- Starting planets: radius 24, forces 30, productionRate 2

Write all 30 JSON files. See the level design table above for planet counts, archetypes, and AI parameters per level/difficulty.

- [ ] **Step 4: Validate all level files**

Write a quick Node.js validation script `levels/validate.js`:
```js
// Run: node levels/validate.js
// Checks: coordinate bounds, minimum spacing, connectivity, starting positions, AI params
const fs = require('fs');
const index = JSON.parse(fs.readFileSync('levels/index.json'));
let errors = 0;
for (const level of index.levels) {
    for (const diff of ['easy', 'medium', 'hard']) {
        const path = `levels/${level[diff]}`;
        const data = JSON.parse(fs.readFileSync(path));
        // ... validate constraints
    }
}
```

Run: `node levels/validate.js`
Expected: All 30 files pass validation with 0 errors.

- [ ] **Step 5: Commit level data**

```bash
git add levels/
git commit -m "feat: add 10 campaign levels × 3 difficulties (30 JSON files)"
```

---

## Chunk 2: Level Loader Module

### Task 2: Create level-loader.js

**Files:**
- Create: `level-loader.js`

This module handles:
1. Fetching level index and individual level JSONs
2. localStorage progression tracking (highest unlocked level per difficulty)
3. Providing level data to the game

- [ ] **Step 1: Create level-loader.js with LevelLoader class**

```js
class LevelLoader {
    constructor() {
        this.index = null;       // loaded from index.json
        this.currentLevel = null; // currently loaded level data
        this.currentLevelId = 1;
        this.currentDifficulty = 'easy';
    }

    async loadIndex() {
        const res = await fetch('levels/index.json');
        this.index = await res.json();
        return this.index;
    }

    async loadLevel(levelId, difficulty) {
        if (!this.index) await this.loadIndex();
        const entry = this.index.levels.find(l => l.id === levelId);
        if (!entry) throw new Error(`Level ${levelId} not found`);
        const path = `levels/${entry[difficulty]}`;
        const res = await fetch(path);
        this.currentLevel = await res.json();
        this.currentLevelId = levelId;
        this.currentDifficulty = difficulty;
        return this.currentLevel;
    }

    getUnlockedLevel(difficulty) {
        return parseInt(localStorage.getItem(`xbattle_unlocked_${difficulty}`) || '1');
    }

    unlockNextLevel(difficulty, currentLevel) {
        const current = this.getUnlockedLevel(difficulty);
        if (currentLevel >= current) {
            localStorage.setItem(`xbattle_unlocked_${difficulty}`, String(currentLevel + 1));
        }
    }

    isLevelUnlocked(levelId, difficulty) {
        return levelId <= this.getUnlockedLevel(difficulty);
    }

    hasNextLevel() {
        return this.index && this.currentLevelId < this.index.totalLevels;
    }

    getNextLevelId() {
        return this.currentLevelId + 1;
    }

    getLevelInfo(levelId) {
        if (!this.index) return null;
        return this.index.levels.find(l => l.id === levelId) || null;
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add level-loader.js
git commit -m "feat: add LevelLoader class for campaign level management"
```

---

## Chunk 3: Game Engine Integration

### Task 3: Add loadLevel() to game.js

**Files:**
- Modify: `game.js:169-172` (initGame method)
- Modify: `game.js:176-190` (startGame method)
- Modify: `game.js:20-35` (constructor — add level state)

- [ ] **Step 1: Add level state to constructor**

Add after line ~34 (`this.AI_MOVE_INTERVAL = 4000;`):
```js
// Level system state
this.levelLoader = new LevelLoader();
this.gameMode = 'quickplay';  // 'quickplay' or 'campaign'
this.currentLevelName = null;
```

- [ ] **Step 2: Add loadLevel() method**

Add after `assignStartingPlanets()` (after line ~358):
```js
/**
 * Loads a pre-designed level from JSON data, replacing random generation.
 * Scales normalized coordinates to canvas size. Applies AI parameters from level data.
 * @param {Object} levelData - Parsed level JSON
 */
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
    // IMPORTANT: aiForceThreshold is separate from ROUTE_THRESHOLD.
    // ROUTE_THRESHOLD controls human+AI route auto-sending (always 10).
    // aiForceThreshold controls the AI's minimum force to consider moving.
    const ai = levelData.ai;
    this.AI_MOVE_INTERVAL  = ai.moveInterval;
    this.aiAttackRatio     = ai.attackRatio;
    this.aiForceThreshold  = ai.forceThreshold;
    this.aiTopPlanets      = ai.topPlanetsPerTick;

    // Rebuild players array from level
    this.players = levelData.players.map(p => ({ ...p }));
    // Always size aiLastMove to 4 to avoid undefined index access
    this.aiLastMove = [0, 0, 0, 0];

    this.currentLevelName = levelData.name;
}
```

- [ ] **Step 3: Wire loadLevel into initGame/startGame**

Modify `initGame()` to support both modes:
```js
initGame() {
    if (this.gameMode === 'campaign' && this._pendingLevelData) {
        this.loadLevel(this._pendingLevelData);
        this._pendingLevelData = null;
    } else {
        this.setupPlayers();
        this.generatePlanets();
        this.assignStartingPlanets();
    }
}
```

Add a new method for starting campaign levels (with error handling):
```js
async startCampaignLevel(levelId, difficulty) {
    try {
        const data = await this.levelLoader.loadLevel(levelId, difficulty);
        this.gameMode = 'campaign';
        this._pendingLevelData = data;
        this.difficulty = ['easy', 'medium', 'hard'].indexOf(difficulty) + 1;
        this.startGame();
    } catch (err) {
        console.error('Failed to load level:', err);
        this.gameMode = 'quickplay';
        this.gameState = 'menu';
        this.menuScreen = 'main';
    }
}
```

- [ ] **Step 4: Wire AI parameters into makeAIMove**

Three changes needed:

**4a. Wire `aiForceThreshold` into the AI planet filter (line ~1695).**

The hardcoded `p.forces > 10` controls the minimum force for AI to consider a planet. Change to use `aiForceThreshold`:

Change:
```js
.filter(p => p.owner === playerId && p.forces > 10)
```
To:
```js
.filter(p => p.owner === playerId && p.forces > (this.aiForceThreshold || 10))
```

**4b. Wire `aiAttackRatio` into selectBestTargetPlanet (line ~1740).**

Change:
```js
} else if (sourcePlanet.forces >= planet.forces * 1.2) {
```
To:
```js
} else if (sourcePlanet.forces >= planet.forces * (this.aiAttackRatio || 1.2)) {
```

**4c. Wire `aiTopPlanets` as a cap on active planets per tick (line ~1697).**

`topPlanetsPerTick` is the maximum planets that act per AI tick, not a floor. Use `Math.min` to cap the existing formula:

Change:
```js
const maxActive = Math.max(2, Math.ceil(aiPlanets.length * 0.4));
```
To:
```js
const baseActive = Math.max(2, Math.ceil(aiPlanets.length * 0.4));
const maxActive = this.aiTopPlanets
    ? Math.min(baseActive, this.aiTopPlanets)
    : baseActive;
```

- [ ] **Step 5: Commit**

```bash
git add game.js
git commit -m "feat: add loadLevel() and campaign mode to game engine"
```

---

## Chunk 4: Menu UI — Campaign vs Quick Play + Level Select

### Task 4: Modify menu to support Campaign and Quick Play modes

**Files:**
- Modify: `game.js:988-1062` (renderMenu, handleMenuClick)
- Modify: `index.html` (add script tag)

The menu flow becomes:
1. **Main menu**: "Campaign" | "Quick Play"
2. **Campaign → Difficulty select**: Easy | Medium | Hard
3. **Campaign → Level select grid**: 10 level buttons (locked/unlocked)
4. **Quick Play → Difficulty select** (existing flow, unchanged)

- [ ] **Step 1: Add menu state tracking to constructor**

```js
this.menuScreen = 'main';        // 'main', 'campaign-difficulty', 'level-select', 'quickplay-difficulty'
this.campaignDifficulty = 'easy'; // selected difficulty for campaign
```

- [ ] **Step 2: Rewrite renderMenu to dispatch to sub-screens**

Replace `renderMenu()` with a dispatcher that calls:
- `renderMainMenu()` — two big buttons: Campaign, Quick Play
- `renderCampaignDifficultyMenu()` — Easy/Medium/Hard for campaign
- `renderLevelSelectMenu()` — Grid of 10 level buttons
- `renderQuickPlayMenu()` — existing difficulty select (rename current renderMenu)

Each screen has a "Back" button in top-left.

- [ ] **Step 3: Implement renderMainMenu()**

Two centered buttons:
- "Campaign" → sets `this.menuScreen = 'campaign-difficulty'`
- "Quick Play" → sets `this.menuScreen = 'quickplay-difficulty'`

Style matches existing menu aesthetic (dark overlay, cyan accents, rounded buttons).

- [ ] **Step 4: Implement renderCampaignDifficultyMenu()**

Three difficulty buttons (Easy/Medium/Hard) with descriptions:
- Easy: "1 AI opponent, relaxed pace"
- Medium: "2 AI opponents, balanced"
- Hard: "3 AI opponents, aggressive"

Selection sets `this.campaignDifficulty` and transitions to `'level-select'`.

- [ ] **Step 5: Implement renderLevelSelectMenu()**

Grid layout: 2 rows × 5 columns of level buttons.
Each button shows:
- Level number
- Level name
- Lock icon if not unlocked
- Archetype label (small text)

Unlocked levels are clickable → calls `this.startCampaignLevel(id, difficulty)`.
Locked levels are dimmed, not clickable.

Show current difficulty at top, with ability to go back.

- [ ] **Step 6: Rewrite handleMenuClick to dispatch to sub-screen handlers**

Route clicks based on `this.menuScreen`:
- `'main'` → check Campaign/Quick Play buttons
- `'campaign-difficulty'` → check difficulty buttons + back
- `'level-select'` → check level grid buttons + back
- `'quickplay-difficulty'` → existing difficulty button logic + back. **Must set `this.gameMode = 'quickplay'`** before calling `startGame()`

- [ ] **Step 7: Update keyboard handler for new menu screens**

The existing key handler (lines 128-138) handles '1'/'2'/'3' for difficulty. Update to:
- On 'main' screen: no number keys
- On difficulty screens: '1'/'2'/'3' works as before
- On level-select: number keys 1-9, 0 for level 10
- Escape goes back one screen

- [ ] **Step 8: Add level-loader.js to index.html**

Add before game.js:
```html
<script src="level-loader.js"></script>
```

- [ ] **Step 9: Commit**

```bash
git add game.js index.html
git commit -m "feat: add campaign menu, level select grid, and Quick Play mode"
```

---

## Chunk 5: In-Game HUD and Level Progression

### Task 5: Add level name HUD and win/loss progression

**Files:**
- Modify: `game.js` (render method, win/loss overlay)

- [ ] **Step 1: Add level name HUD during gameplay**

In the render method, when `gameMode === 'campaign'`, draw in top-left corner:
```
Level 3: Frontier Post
```
Small, semi-transparent text. Below the existing UI overlay.

- [ ] **Step 2: Modify win screen for campaign mode**

When `gameMode === 'campaign'` and player wins:
- Call `this.levelLoader.unlockNextLevel(difficulty, currentLevelId)`
- Show "Next Level" button (if not last level) → loads next level
- Show "Level Select" button → returns to level select
- Show "Menu" button → returns to main menu

- [ ] **Step 3: Modify loss screen for campaign mode**

When `gameMode === 'campaign'` and player loses:
- Show "Retry" button → replays same level
- Show "Level Select" button → returns to level select
- Show "Menu" button → returns to main menu

- [ ] **Step 4: Implement button click handlers for win/loss overlays**

Replace the existing "Click anywhere to play again" with the new buttons.
Store button rects like existing `_menuButtons` pattern.
Route clicks based on game mode.

- [ ] **Step 5: Handle Quick Play win/loss unchanged**

When `gameMode === 'quickplay'`, keep existing behavior (click anywhere → back to menu).

- [ ] **Step 6: Commit**

```bash
git add game.js
git commit -m "feat: add level HUD, campaign win/loss screens with progression"
```

---

## Chunk 6: Initialize LevelLoader on Startup

### Task 6: Wire everything together on page load

**Files:**
- Modify: `game.js` (constructor or end of file where game is instantiated)

- [ ] **Step 1: Preload level index on game construction**

At the end of the constructor (or in a new `async init()` method), load the level index:
```js
this.levelLoader.loadIndex().catch(err => {
    console.warn('Could not load level index — campaign mode unavailable:', err);
});
```

This is fire-and-forget. If it fails (e.g., opened as file://), campaign mode gracefully shows "Campaign unavailable" in the menu.

- [ ] **Step 2: Add campaign availability check**

In `renderMainMenu()`, if `this.levelLoader.index` is null, dim the Campaign button and show "Requires HTTP server" tooltip.

- [ ] **Step 3: Verify end-to-end flow**

Manual testing checklist:
1. Start HTTP server: `npx http-server -p 8080`
2. Open http://localhost:8080
3. Main menu shows Campaign + Quick Play
4. Quick Play works exactly as before
5. Campaign → Easy → Level 1 loads correct map
6. Win level 1 → "Next Level" button works → Level 2 loads
7. Level 2 is locked until level 1 is won
8. Level select shows correct lock/unlock state
9. Browser refresh preserves unlock progress (localStorage)
10. Hard difficulty shows 4 players on the map

- [ ] **Step 4: Final commit**

```bash
git add game.js
git commit -m "feat: wire level loader initialization, campaign availability check"
```
