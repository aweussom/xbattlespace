# Copilot Instructions for XBattle - Galcon Fusion

## Build, test, and lint commands
- This repository has no build system, package manager scripts, linter config, or automated test framework.
- Run the game directly:
  - Open `index.html` in a browser.
  - Or serve locally:
    - `python -m http.server 8000`
    - `npx http-server`
- Single-test command: Not available (no automated tests are configured).

## High-level architecture
- The app is a standalone client-side HTML5 canvas game:
  - `index.html` provides the canvas (`#gameCanvas`) and lightweight UI text, then loads `game.js`.
  - `game.js` contains all runtime logic.
- `XBattleGame` is the main engine:
  - Initializes canvas, input listeners, players, planet generation, and game start.
  - Runs the `requestAnimationFrame` loop with `update(dt)` then `render()`.
  - Manages world state: `planets`, `forces`, `players`, `routes`, `gameState`, and AI timing.
- `ForceStream` models moving fleets:
  - Stores source/target path, owner, amount, progress, and visual rendering behavior.
  - `XBattleGame` updates/removes these and resolves arrival combat.

## Key conventions in this codebase
- Player IDs are fixed:
  - `0` is the human player (`#00ffff`, shown as “You”).
  - `1-3` are AI players.
- Planet objects use a shared shape (`id`, `x`, `y`, `radius`, `owner`, `forces`, `productionRate`, `lastProduction`) and are mutated in place.
- Range and routing rules are centralized in `XBattleGame` constants/fields:
  - `MAX_FORCE_RANGE = 400`
  - `ROUTE_THRESHOLD = 10`
  - Routes are stored in `Map<planet, targetPlanet>` and auto-send about once per second when threshold is met.
- Fleet sending follows one rule everywhere: `sendForces()` dispatches `Math.floor(fromPlanet.forces * 0.5)`.
- Time handling is mixed by design:
  - Frame delta (`dt`) from `requestAnimationFrame` drives movement.
  - `Date.now()` timestamps gate production, AI cadence, route auto-send, and match time UI.
- Input handling pattern:
  - Mouse is canonical; touch handlers call into mouse handlers with translated coordinates.
- Rendering order is meaningful and should be preserved when editing visuals:
  - Background → stars → routes → planets → force streams → drag line → scoreboard → game-state overlay.
