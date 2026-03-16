# XBattle — Galcon Fusion

A real-time strategy game inspired by [Galcon](https://en.wikipedia.org/wiki/Galcon) and the classic Unix [XBattle](https://en.wikipedia.org/wiki/XBattle), built as a single-page HTML5 canvas application with zero dependencies.

Capture planets, establish supply lines, and outmaneuver AI opponents in a space-themed RTS.

## Quick Start

```bash
# Option 1: Open directly
open index.html

# Option 2: Local server
python -m http.server 8000
# or
npx http-server
```

No build tools, no `npm install`, no bundler. Just a browser.

## Controls

| Input | Action |
|---|---|
| **Drag from own planet → target** | Send 50% forces and establish supply route |
| **Click own planet** | Cancel its supply route |
| **Drag from empty space** | Box-select your planets |
| **Click target after box-select** | Send all selected planets toward target (smart routing) |
| **Shift + drag from empty space** | Box-select then cancel routes on selected planets |
| **Space** | Pause / unpause |
| **Escape** | Cancel box selection |
| **1 / 2 / 3** | Select difficulty from menu |

Touch-screen: a "CANCEL MODE" button in the bottom-left corner replaces Shift.

## Difficulty

| Level | AI Opponents | Human Starting Planets | AI Starting Planets |
|---|---|---|---|
| Easy (1) | 1 | 3 | 1 |
| Medium (2) | 2 | 2 | 1 each |
| Hard (3) | 3 | 1 | 1 each |

All starting planets are identical: radius 24, 30 forces, production rate 2.

---

## Game Mechanics

### Planet Economy

Each planet has three force thresholds tied to its radius:

```
capacity    = radius × 3    (production stops here — "food runs out")
maxForces   = radius × 5    (forces above this decay over time)
```

- **Production**: every 1150ms, owned planets generate forces up to capacity
- **Decay**: forces above `maxForces` decay logarithmically (`log₂(excess+1)` per second)
- Small surplus barely bleeds; massive hoards lose more — but slowly enough to push onward
- **Territory overstretch**: owning >6 planets adds +15% decay per extra planet above 6

### Production Under Siege

When hostile forces are inbound toward a planet, production is suppressed proportionally:

```
threatRatio = incomingForces / defenderForces
production × max(0, 1 - threatRatio)
```

The capacity arc ring dims when production is suppressed — the player can see sieges working.

### Desperation Bonus

Any player with ≤2 planets gets 2× production. Losing players always have a fighting chance.

### Combat Resolution

**Lanchester's Law** — overwhelming force has an advantage:

```
bonus = √(attacker / defender)   when attacker > defender
effectiveAttack = attacker × bonus
```

**Concerted Attack Bonus** — multiple waves arriving within 800ms coordinate:

| Waves | Multiplier |
|---|---|
| 1 (solo) | 0.85× (penalty) |
| 2 | 1.12× |
| 3 | 1.24× |
| 4 | 1.36× |

Trickling forces one at a time is punished. Pincer attacks from multiple planets are rewarded.

### Routes (Supply Lines)

- Dragging from a planet to a target establishes a persistent auto-send route
- Routes send 50% of source forces every 1150ms when forces ≥ 10
- Routes are visible as dashed lines with marching-ant animation and arrowheads
- AI players use the same route system — all supply lines are visible
- Routes are cleared when a planet is captured by the enemy
- Click a planet to cancel its route manually

### Smart Routing (Box-Select)

When box-selecting planets and clicking a target beyond direct range, BFS pathfinding finds a relay chain through owned planets. Each selected planet routes to the first hop toward the target. Forces naturally cascade through the chain via routes.

### Force Streams

- Travel at 85 pixels/second
- Rendered as gradient trails with a bright head dot
- Trail width scales logarithmically with force count (1→1.5px, 50→6px, 100→7px)
- Hostile arrivals produce an expanding glow ring impact effect

---

## AI Behavior

### Decision Cycle

AI fires decisions at a dynamic interval (base 4000ms):

- **Losing** (fewer planets than human): panic mode, interval down to 0.4× (1600ms)
- **Even**: normal interval
- **Winning**: only mildly relaxed, cap at 1.1× (4400ms) — presses advantage

### Target Selection

On each decision tick, AI activates its top 40% of planets (min 2) sorted by force count:

1. **Skip own planets** — AI never sends to its own planets
2. **Neutrals**: scored by `productionRate × 3 - distance × 0.01`
3. **Enemies** (if forces ≥ enemy × 1.2): scored by `productionRate × 4 - distance × 0.01 + advantage × 0.1`
4. **Territorial bias**: 1.5× score multiplier for attacking the nearest rival
5. **Capacity pressure**: +3 score when source planet is ≥80% capacity (must spend)

AI sets routes identical to human players — visible, persistent, and cleared on capture.

---

## Visual Architecture

### Parallax Background

Three layers rotate around screen center at different speeds:

| Layer | Count | Speed (rad/s) | Notes |
|---|---|---|---|
| Deep stars | 300 | 0.0008 | Tiny, dim, barely move |
| Dust/nebula | 18 | 0.002 | Soft gradient blobs |
| Close stars | 120 | 0.004 | Bright, sinusoidal twinkle |

Additionally, 2–4 distant galaxy clouds (Magellanic-type) made of overlapping gradient blobs rotate at deep-star speed.

All star layers are placed in an oversized circle (diagonal × 0.55) so rotation never reveals canvas edges.

### Planet Rendering

- Owner-colored radial gradient fill with glow
- Capacity arc ring: green (producing), yellow (≥85% capacity), red (decaying above maxForces)
- Arc background dims when production is siege-suppressed
- Force count in Orbitron font, scaled to planet radius (9–15px)

### UI Elements

- **Scoreboard** (top-right): all players ranked by planet count with force totals
- **Hint text**: "You are Cyan — drag from your planets" — auto-hides after first send
- **Status bar** (bottom): control reference
- **Virtual shift button** (bottom-left, touch only): toggles cancel-routes mode

---

## File Structure

```
├── index.html              # HTML shell, canvas, UI overlays, Orbitron font link
├── game.js                 # Complete game engine (~1580 lines)
│   ├── hexToRgba()         # Module-level color utility
│   ├── XBattleGame         # Main game class
│   │   ├── Constructor     # Tuning constants, state init, game loop start
│   │   ├── Setup           # Canvas, players, planet generation, starting positions
│   │   ├── Game Loop       # update() → production, decay, forces, routes, AI, win check
│   │   ├── Rendering       # 10 render passes: bg, stars, routes, planets, forces, etc.
│   │   ├── Input           # Mouse, touch, keyboard handlers + box-select
│   │   ├── Pathfinding     # BFS relay chain for smart routing
│   │   ├── Combat          # Lanchester + concerted attack resolution
│   │   └── AI              # Dynamic interval, target scoring, route management
│   └── ForceStream         # Moving force: position, progress, gradient trail rendering
├── CLAUDE.md               # AI assistant context file
├── LEVELS.md               # Level design document (future: phenomena, 100 levels)
├── plan.md                 # Implementation roadmap
├── instructions/           # LLM strategic advisor specs
│   ├── 01-advisor-spec.md  # System prompt and behavioral spec
│   ├── 01-snapshot-schema.json
│   ├── 02-response-schema.json
│   ├── 03-validation.js    # Decision validation before applying
│   ├── 04-api-client.js    # Ollama API client (qwen3:4b)
│   └── 05-snapshot-builder.js
└── .github/
    └── copilot-instructions.md
```

## Tuning Constants

All gameplay tuning is in the `XBattleGame` constructor, lines 11–53:

| Constant | Default | Effect |
|---|---|---|
| `AI_MOVE_INTERVAL` | 4000ms | Base AI decision rate |
| `MAX_FORCE_RANGE` | 320px | Maximum send/route distance |
| `CAPACITY_PER_RADIUS` | 3 | Production cap = radius × this |
| `MAX_FORCES_PER_RADIUS` | 5 | Decay threshold = radius × this |
| `DECAY_INTERVAL` | 1000ms | How often decay is checked |
| `TERRITORY_DECAY_THRESHOLD` | 6 | No overstretch penalty below this |
| `TERRITORY_DECAY_SCALE` | 0.04 | +4% decay per planet above threshold |
| `DESPERATION_PLANET_THRESHOLD` | 2 | ≤ this triggers 2× production |
| `DESPERATION_PRODUCTION_MULT` | 2 | Production multiplier when desperate |
| `ROUTE_THRESHOLD` | 10 | Min forces to auto-send on route |
| `CONCERTED_WINDOW` | 800ms | Time window for coordinated attacks |
| `CONCERTED_BONUS` | 0.12 | +12% per additional wave |
| `SOLO_ATTACK_PENALTY` | 0.85 | Solo attacks are 85% effective |

## Game State Flow

```
                    ┌─────────┐
                    │  Menu   │ ← start / win / loss click
                    └────┬────┘
                         │ pick difficulty (1/2/3)
                         ▼
                    ┌─────────┐
              ┌─────│ Playing │─────┐
              │     └────┬────┘     │
              │ Space    │          │ Space
              ▼          │          ▼
         ┌────────┐      │    ┌─────────┐
         │ Paused │──────┘    │ Won/Lost│
         └────────┘           └────┬────┘
              Space unpause        │ click
                                   ▼
                              ┌─────────┐
                              │  Menu   │
                              └─────────┘
```

## Future Plans

See [LEVELS.md](LEVELS.md) for the full design document:

- **100 curated levels** replacing random generation
- **Space phenomena**: nebulae (slow zones), black holes (attrition + acceleration), Oort clouds (static defense), comets (moving defense windows), wandering planets (orbital mechanics)
- **LLM strategic advisor**: local Ollama/qwen3:4b queried every ~180 ticks during headless simulation for play-testing
- **Force types**: infantry, cavalry, artillery, stealth (after phenomena are stable)

See [plan.md](plan.md) for the implementation roadmap.

## License

Private repository — not open source.
