# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

This is a standalone web-based game with no build system. To run:
- Open `index.html` directly in a web browser
- Serve locally using a simple HTTP server: `python -m http.server 8000` or `npx http-server`

No package management, build tools, or testing frameworks are configured.

## Architecture Overview

**XBattle - Galcon Fusion** is a real-time strategy game inspired by Galcon, implemented as a single-page HTML5 canvas application.

### Core Components

- **XBattleGame Class** (`game.js:1-525`): Main game engine handling state, rendering, and game loop
  - Canvas setup and responsive resizing
  - Game state management (playing/won states)
  - Turn-based multiplayer with AI opponents
  - Mouse and touch input handling

- **ForceStream Class** (`game.js:527-605`): Represents moving forces between planets
  - Particle-based visual effects with trails
  - Animation and collision detection
  - Automatic cleanup on arrival

### Game Mechanics

- **Planet System**: Procedurally generated planets with varying sizes, production rates, and strategic positions
- **Force Management**: Players send forces between planets using drag-and-drop mechanics
- **AI Opponents**: 3 AI players with strategic decision-making based on force advantage and distance
- **Win Conditions**: Control all planets or 80%+ of total planets

### Rendering Pipeline

1. Background gradient and starfield
2. Planets with ownership-based coloring and force counts
3. Moving force streams with particle effects
4. UI overlays and drag indicators
5. Game state overlays (win screen)

### Key Game States

- `this.gameState`: Controls overall game flow ('playing', 'won')
- `this.currentPlayer`: Active player index (0-3, where 0 is human)
- `this.planets[]`: All planet objects with ownership and force data
- `this.forces[]`: Active force movements between planets

The game uses a single JavaScript file with ES6 classes and runs entirely client-side with no external dependencies.