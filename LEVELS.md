# XBattle — Level Design & Mechanics Document

## Core Design Philosophy

Most RTS games define victory as pure expansion at any cost.
This game explicitly rewards **defensive play, patience, and positional thinking**
alongside aggression. No mechanic should make turtling feel wrong — only make
over-turtling feel slow.

---

## Level System

### Format
- 100 curated levels replacing random generation entirely
- Files: `levels/001.json` through `levels/100.json`
- Planet coordinates normalized to 0–1 (scaled to canvas at load time)
- Level progression is sequential; player unlocks next level on win

### Difficulty Curve

| Lever               | Easy (1–20)   | Medium (21–50) | Hard (51–80) | Expert (81–100) |
|---------------------|---------------|----------------|--------------|-----------------|
| AI count            | 1             | 1–2            | 2–3          | 3               |
| AI moveInterval     | 5000–4000ms   | 4000–3000ms    | 3000–2500ms  | 2500–2000ms     |
| AI forceThreshold   | 15            | 12             | 10           | 8               |
| AI topPlanetsPerTick| 1             | 1–2            | 2            | 2–3             |
| AI attackRatio      | 2.0           | 1.8            | 1.5          | 1.2             |
| Total planets       | 8–15          | 15–25          | 20–30        | 25–40           |
| Player start forces | 50            | 50             | 40           | 30              |
| Map layout          | Symmetrical   | Mixed          | Asymmetrical | Hostile         |

### Dynamic AI
AI difficulty scales to opposition in real time via response interval:
- AI losing → fires faster (panic mode, down to ~1100ms)
- AI winning → fires slower (relaxed, up to ~3900ms)
- Cheat mechanism is **response time only** — never production or force counts

### Win Rate Target
- Easy tiers: 60–70% win rate in simulation
- Medium: 50–60%
- Hard: 40–50%
- Expert: 35–45%

---

## Space Phenomena

### Nebulae (Slow Zones)
- Defined regions that apply a speed multiplier to forces passing through
- Multiplier: ~0.4–0.6× normal speed
- Tactical impact: shorter routes through nebulae vs longer clear routes
- Forces player to weigh travel time against distance
- Rendered as faint colored clouds with soft edges

### Black Holes
- Dual mechanic: attrition + acceleration for survivors
- Forces passing within event horizon radius lose a % of their count
- Survivors accelerate: arrive faster but weakened
- Creates genuine risk/reward: large force loses more, small force arrives faster
- Tactical question: send big and lose half, or send small and arrive hot?
- Rendered with gravitational lensing glow effect

### Oort Clouds (Static Defense Zone)
- Diffuse debris field permanently surrounding certain planets
- Incoming forces take small % attrition before arriving at the planet
- Permanent soft defense — not a hard multiplier, just friction
- Makes the surrounded planet cheaper to hold than to take
- Rendered as sparse particle ring around planet

### Comets (Moving Defense Window)
- Moving objects on predictable orbital paths
- When near a planet: incoming forces take significant attrition (hard defense bonus)
- Defense window is temporary — comet drifts in and out of range
- Trajectory is visible to all players
- Rewards timing: attack after the comet passes, defend by waiting for it to return
- Rendered with visible orbit path and particle trail

### Wandering Planets
The signature mechanic. A planet governed by real orbital mechanics —
not a scripted path, but a gravitationally simulated body that responds
to black holes, large planets, and its own velocity.

**Orbital Model**
- Base motion: Keplerian ellipse defined in level JSON (semi-major axis, eccentricity, period, phase)
- Perturbation: black holes and optionally large static planets exert gravitational pull each tick
- Full N-body is unnecessary and expensive — only wandering planets are simulated dynamically;
  static planets have infinite effective mass and do not move
- Trajectory line rendered ahead of current position so players can read the orbit

```js
// Per-tick integration (symplectic Euler — stable for orbital mechanics)
for (const bh of blackHoles) {
    const dx = bh.x - wp.x;
    const dy = bh.y - wp.y;
    const dist = Math.sqrt(dx*dx + dy*dy);
    const force = BH_GRAVITY_CONSTANT / (dist * dist);
    wp.vx += (dx / dist) * force * dt;
    wp.vy += (dy / dist) * force * dt;
}
wp.x += wp.vx * dt;
wp.y += wp.vy * dt;
```

**Capture by Black Hole**
- If wandering planet enters the black hole's event horizon radius: capture event fires
- All forces on the wandering planet are destroyed
- Planet ceases to exist for the remainder of the level
- Rendered as a dramatic spiral-in animation before disappearance
- Strategic consequence: anyone who invested forces in capturing it loses everything

**Collision with Static Planet**
- If wandering planet center enters another planet's radius: collision event fires
- Both planets are destroyed
- A new Oort cloud is spawned at the collision point
- Oort cloud radius = sum of both planet radii × 1.5
- Any forces on either planet at collision time are destroyed
- The resulting Oort cloud is permanently on the map for the rest of the level
- Players must adapt — a previously open lane is now a debris field

**Properties**
- Has its own force count and production rate (typically lower than static planets)
- Starts neutral; can be captured by any player within range
- Capture window: only accessible when within `maxForceRange` of an owned planet
- Creates a hard time deadline — it drifts in and out of range

**Strategic Possibilities**
- Capture it as a **mobile forward base** — carries forces into enemy territory on its orbit
- Sacrifice it deliberately into a black hole to deny the enemy a capture opportunity
- Race to capture it before an opponent; contest it as a shared objective
- Monitor its trajectory to predict collisions and avoid investing forces in nearby planets

**Interactions with Other Phenomena**
- Passes through nebula → velocity reduced, orbit perturbed, capture window extended
- Passes near black hole → gravity well perturbs orbit, may spiral in if too close
- Carries its own Oort cloud if level JSON specifies one
- Collides with static planet → both destroyed, Oort cloud spawned at impact site

**Design Rule**
The orbit and its perturbations must always be visible. Players should be able to
read the physics and make decisions — not be surprised by an invisible simulation.
Predicted trajectory line updates every tick based on current velocity + gravity.

---

## Force Types (Future Layer)

Multiple force types modeled on the original XBattle (circa early Unix era).
Implement **after** the level system and phenomena are stable — force types
touch rendering, combat resolution, AI targeting, and the advisor prompt.

### Proposed Types

| Type       | Speed  | Strength | Notes                                      |
|------------|--------|----------|--------------------------------------------|
| Infantry   | Medium | Medium   | Default, all-purpose                       |
| Cavalry    | Fast   | Low      | Raids, quick captures of weak neutrals     |
| Artillery  | Slow   | High     | Siege, needed to crack fortified planets   |
| Stealth    | Medium | Low      | Invisible on radar until arrival           |

### Implications
- Planet types could produce specific force types naturally
- High-production small planets → cavalry factories
- Large fortress planets → artillery
- Counter-play: cavalry weak against artillery, strong against infantry
- Adds composition decisions: what to send matters, not just how much

---

## Mechanic Interaction Matrix

| Phenomenon       | Nebula           | Black Hole              | Oort Cloud       | Comet            | Wandering Planet               |
|------------------|------------------|-------------------------|------------------|------------------|--------------------------------|
| **Nebula**       | —                | Slows approach          | Stacks           | Slows comet      | Perturbs velocity, slows orbit |
| **Black Hole**   | Slows entry      | —                       | —                | Perturbs comet   | Gravity well, possible capture |
| **Oort Cloud**   | Stacks           | —                       | —                | —                | Can travel with / spawned by   |
| **Comet**        | Slows comet      | Perturbs comet          | —                | —                | —                              |
| **Wandering**    | Velocity reduced | Orbit perturbed/capture | Spawns on impact | Shares space     | Collision → both destroyed     |

**Key emergent events:**
- Wandering planet + black hole → spiral capture, all forces lost
- Wandering planet + static planet → collision, Oort cloud spawned at impact point
- Wandering planet through nebula → orbit altered, capture window changes
- Captured wandering planet + black hole approach → player must decide: abandon or sacrifice

All interactions fall out from combining systems — no special-casing required.

---

## Implementation Order

1. Fix existing bugs (frame-rate independence, AI one-planet bottleneck)
2. Dynamic AI interval (response-time cheating)
3. Instrumentation + event logging
4. Headless simulation harness + fake clock
5. Level JSON format + loader
6. Level progression UI
7. Human observation (10 sessions) + behavioral model
8. Generate 100 level JSONs
9. Playtest with LLM advisor (Qwen3:4b local)
10. **Nebulae** — speed multiplier zones (low implementation cost, high tactical value)
11. **Oort clouds** — arrival attrition on specific planets
12. **Black holes** — attrition + acceleration on ForceStream
13. **Comets** — moving objects with visible orbits
14. **Wandering planets** — orbital simulation (symplectic Euler), capture, trajectory rendering
15a. **Wandering planet × black hole** — gravity capture, force destruction event
15b. **Wandering planet × static planet** — collision detection, dynamic Oort cloud spawn
16. **Force types** — last, because they touch everything

---

## Notes

- All phenomena should have **visible, readable representations** on screen
- Players must be able to parse board state in under 2 seconds at any point
- Phenomena interact emergently — avoid special-casing every combination
- Defense should always be a viable and rewarding strategic choice
- The wandering planet is the signature mechanic — it should feel like an event
