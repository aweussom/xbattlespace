# Plan: Curated Increasing-Difficulty Level System

## Problem
The game currently generates a random map each session. We want 100 curated levels with a smooth difficulty curve, replacing random generation entirely.

## Bug Assessment (Claude.ai review vs current code)

Claude.ai identified 5 bugs — most are **already fixed** in the current codebase:

| Bug | Status | Notes |
|-----|--------|-------|
| Frame-rate dependent force speed | ✅ Already fixed | `ForceStream.update(dt)` uses `speed * dt / 1000`; gameLoop passes delta time |
| AI fires from one planet | ✅ Already fixed | `makeAIMove` fires from top 2 surplus planets per tick (`.slice(0, 2)`) |
| hexToRgba duplicated | ✅ Already fixed | Module-level function (line 1-7); class method delegates to it |
| Background gradient recreated | ✅ Already fixed | Cached in `cacheBackground()`, reused via `this.bgGradient` |
| Dynamic AI difficulty | ✅ Already exists | `getAIInterval()` scales interval 0.4×–1.4× based on territory ratio |
| Routes human-only | ⚠️ Design choice | `processRoutes` gates on `owner !== 0` — AI uses its own targeting logic instead |

**Remaining consideration:** whether AI should also use persistent routes is a game balance decision for the level system, not a bug.

## Approach — Three Phases

### Phase 1: Instrumentation & Observation
Instrument `game.js` to emit structured event logs so that Copilot (via Playwright MCP) can observe the user playing 10 games and build a human-player behavioral model.

**Events to log:**
```js
this.log = (event, data) => console.log(JSON.stringify({ event, ts: Date.now(), ...data }));
```
- `game:start` — planet layout, player positions
- `force:send` — owner, fromId, toId, amount
- `planet:capture` / `planet:lost` — who, which planet
- `game:end` — win/loss, elapsed ms, final planet counts

**Metrics to derive:**
- Average time to first expansion
- Expansion rate (planets/minute)
- Force management efficiency (% of forces that result in captures vs wasted)
- Reaction time to threats (time between losing a planet and counter-attacking)
- Typical force-send cadence
- Strategic preferences (neutral expansion vs direct attack)

### Phase 2: Level Format & Loader
Define a JSON level format and replace `generatePlanets()`/`assignStartingPlanets()` with a level loader.

**Level JSON schema** (files in `levels/`):
```json
{
  "id": 1,
  "name": "First Contact",
  "difficulty": 1,
  "players": [
    { "id": 0, "color": "#00ffff", "name": "You" },
    { "id": 1, "color": "#ff00ff", "name": "AI 1" }
  ],
  "ai": {
    "moveInterval": 5000,
    "forceThreshold": 15,
    "topPlanetsPerTick": 1,
    "attackRatio": 2.0
  },
  "planets": [
    { "id": 0, "x": 0.2, "y": 0.4, "radius": 24, "owner": 0, "forces": 50, "productionRate": 2 },
    { "id": 1, "x": 0.8, "y": 0.4, "radius": 24, "owner": 1, "forces": 50, "productionRate": 2 },
    { "id": 2, "x": 0.5, "y": 0.4, "radius": 20, "owner": null, "forces": 10, "productionRate": 1 }
  ],
  "maxForceRange": 400
}
```

**Difficulty levers** (early → late levels):
| Lever | Easy (Lv 1–20) | Medium (Lv 21–50) | Hard (Lv 51–80) | Expert (Lv 81–100) |
|---|---|---|---|---|
| AI count | 1 | 1–2 | 2–3 | 3 |
| AI moveInterval | 5000–4000ms | 4000–3000ms | 3000–2500ms | 2500–2000ms |
| AI forceThreshold | 15 | 12 | 10 | 8 |
| AI topPlanetsPerTick | 1 | 1–2 | 2 | 2–3 |
| AI attackRatio | 2.0 | 1.8 | 1.5 | 1.2 |
| Total planets | 8–15 | 15–25 | 20–30 | 25–40 |
| Player start forces | 50 | 50 | 40 | 30 |
| Map layout | Symmetrical, favorable | Mixed | Asymmetrical, disadvantaged | Hostile |

**Game code changes:**
- `loadLevel(id)` replaces `generatePlanets()` + `assignStartingPlanets()`
- AI constants become per-level instead of global
- Add level progression UI (level select or sequential advance)
- Add programmatic play-test API: `game.sendForcesById(fromId, toId)` + `game.getState()`

### Phase 3: Generate & Play-Test 100 Levels

1. User plays 10 games → Copilot observes via Playwright + console logs
   - If variance across sessions is high, Copilot flags it and requests more games before committing the model
2. Copilot builds human-player model from metrics → parameterizes the JS human-bot
3. Copilot generates level JSON files using the difficulty curve
4. **Per-level play-test loop** (1 level at a time, incremental with QA gates):
   a. JS human-bot plays the level autonomously, handling tick-level execution
   b. Bot queries **qwen3:4b via Ollama** every ~180 ticks (~3 game-seconds) for strategic priorities
   c. Run 50 simulations → collect win-rate stats
   d. Copilot reviews aggregate stats and flags balance issues
   e. **User does manual QA** on the level before proceeding to the next
   f. Iterate on the level if needed, then move to next
5. Target win-rate band: ~40–70% scaled to difficulty tier
6. Repeat until 100 balanced levels exist

## LLM Strategic Advisor — Ollama (local)

**Model:** `qwen3:4b` via Ollama on RTX 3090 24GB
- ~2.5GB VRAM — leaves ~20GB free
- Fast inference for short advisory responses
- No API costs, no rate limits, fully local

**Full spec and implementation:** see `instructions/` directory:

| File | Purpose |
|------|---------|
| `01-advisor-spec.md` | System prompt, action types, priorities, defense logic, fallback behavior |
| `01-snapshot-schema.json` | Game state snapshot schema with examples |
| `02-response-schema.json` | LLM response schema with action validation rules |
| `03-validation.js` | JS validation — reject invalid decisions before applying |
| `04-api-client.js` | Ollama API client with markdown-stripping and error handling |
| `05-snapshot-builder.js` | Builds compact snapshot from game state for the LLM |

**Advisory interval:** every ~180 ticks (≈3 game-seconds at 60fps), not wall-clock time.

**5 action types** (not just attack/expand):
1. `cancel_route` — stop draining a planet so it can build defenses (highest priority when threatened)
2. `attack` — send forces to enemy planet with clear force advantage
3. `expand` — send forces to neutral planet
4. `consolidate` — merge forces from weak planet to strong planet
5. `set_route` — establish persistent auto-send (only when surplus is high and safe)

**Defense logic:** The advisor handles defense through threat-aware prioritization:
- Incoming threats → cancel routes on threatened planets first
- Weak planet under attack → consolidate forces toward it from nearby
- Lost cause → consolidate *away* from doomed planet instead
- `incomingThreats` array provides targetId, amount, owner, etaTicks for decision-making

## Headless Simulation

**Critical:** mock `Date.now()` with a tick counter for deterministic production.
The production system uses real timestamps — headless sim must substitute a fake clock.

```js
// In headless mode, replace Date.now with a tick-driven fake clock
this.now = () => this.simulationTick * (1000 / 60); // simulate 60fps time
```

**Simulation loop:**
```
runSimulation(levelId, n=50):
  for each of n runs:
    loadLevel(levelId)
    while gameState === 'playing' and ticks < 50000:
      if tick % 180 === 0: advisorDecision = queryOllama(getState())
      applyDecision(advisorDecision)
      update(16.67)  // simulate one 60fps frame
      ticks++
  return { winRate, avgTicks, stdDev }
```

## Human Behavioral Model

Copilot (Playwright MCP) observes 10 human sessions via console event log.
Sonnet analyzes logs → outputs behavioral parameter profile:

```json
{
  "sendRatio": 0.55,
  "routeThreshold": 8,
  "targetPriority": "neutral_over_enemy",
  "expansionBias": 0.7,
  "aggressionTrigger": 1.2,
  "reactionTimeMs": 4200
}
```

If variance across sessions is high, Copilot flags it and requests more games
before committing the profile.

These parameters configure the JS bot's heuristics — the LLM overrides them
only at advisory tick intervals for strategic pivots.

## Play-Test Architecture

```
┌──────────────────────────────────────────┐
│  Simulation Harness (Node.js headless)   │
│                                          │
│  ┌─────────────┐    ┌─────────────────┐  │
│  │  JS Human   │◄──►│  qwen3:4b       │  │
│  │  Bot        │    │  (Ollama local, │  │
│  │  (tick-by-  │    │   every ~180    │  │
│  │   tick play)│    │   ticks)        │  │
│  └──────┬──────┘    └─────────────────┘  │
│         │                                │
│  ┌──────▼──────┐                         │
│  │  Game Engine │  ← headless, fake clock│
│  │  (game.js)   │                        │
│  └─────────────┘                         │
├──────────────────────────────────────────┤
│  runSimulation(levelId, n=50)            │
│  → { winRate, avgTicks, stdDev }         │
├──────────────────────────────────────────┤
│  Copilot reviews stats → User QA gate    │
│  → next level                            │
└──────────────────────────────────────────┘
```

## Todos (execution order)

1. `instrument-logging` — Add structured JSON event logging to game.js
2. `playtest-api` — Add `sendForcesById()`, `getState()`, headless simulation with fake clock
3. `level-format` — JSON level schema, `loadLevel()` replacing random generation
4. `level-ui` — Level selection/progression UI
5. `observe-human` — User plays 10 games; Copilot observes via Playwright MCP (flags high variance)
6. `build-model` — Analyze observation logs → behavioral parameter JSON for JS bot
7. `human-bot` — JS human-bot: tick-level executor parameterized from model, queries qwen3:4b via Ollama every ~180 ticks
8. `generate-levels` — Generate 100 level JSONs using difficulty curve
9. `playtest-levels` — Per-level: 50 sims with Ollama-advised bot → win-rate stats → user QA gate → next level
10. `finalize` — Final polish and validation

## Notes
- Planet coordinates in level files use normalized 0–1 values, scaled to canvas at load time (handles different screen sizes)
- The human model doesn't need to be perfect — it's a heuristic for "can a decent player beat this in 2–5 minutes"
- Levels will live in `levels/001.json` through `levels/100.json`
- Random generation will be removed entirely
- Ollama must be running with `qwen3:4b` pulled before play-testing begins
- **See `LEVELS.md`** for full level design doc: space phenomena (nebulae, black holes, Oort clouds, comets, wandering planets), force types, mechanic interaction matrix, and implementation order
- **See `instructions/`** for LLM strategic advisor spec, schemas, validation, and API client
