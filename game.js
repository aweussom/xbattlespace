/**
 * Converts a hex color string to an rgba() CSS string.
 * Used by both XBattleGame and ForceStream for all color rendering with transparency.
 * @param {string} hex - CSS hex color (e.g. '#00ffff')
 * @param {number} alpha - Opacity value 0–1
 * @returns {string} CSS rgba() string
 */
function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Main game engine. Manages all game state, rendering, input, AI, and the game loop.
 * All tuning constants are defined at the top of the constructor for easy editing.
 * Game states: 'menu' → 'playing' ↔ 'paused' → 'won'/'lost' → 'menu'
 */
class XBattleGame {
    /** Initializes canvas, tuning constants, input state, parallax starfield, and starts the game loop. */
    constructor() {
        this.canvas = document.getElementById('gameCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.setupCanvas(); // also caches bgGradient

        this.planets = [];
        this.forces = [];
        this.players = [];
        this.gameState = 'menu';
        this.difficulty = 1;  // 1 = Easy, 2 = Medium, 3 = Hard
        this.gameStartTime = Date.now();
        this.aiEnabled = true;
        this.aiLastMove = [0, 0, 0, 0];
        this.AI_MOVE_INTERVAL = 4000;
        this.MAX_FORCE_RANGE  = 320;

        // --- Planet capacity tuning ---
        // capacity: production stops when forces reach this (food runs out)
        //   = radius × CAPACITY_PER_RADIUS
        // maxForces: forces above this decay over time (can temporarily exceed via reinforcement)
        //   = radius × MAX_FORCES_PER_RADIUS
        // decayRate: forces lost per second when above maxForces
        //   = excess × DECAY_RATE_FRACTION (so larger excess decays faster)
        this.CAPACITY_PER_RADIUS   = 3;    // e.g. radius 24 → capacity 72
        this.MAX_FORCES_PER_RADIUS = 5;    // e.g. radius 24 → maxForces 120
        this.DECAY_INTERVAL        = 1000; // check decay every second

        // --- Territory overstretch ---
        // Owning many planets accelerates decay (supply lines stretch thin)
        this.TERRITORY_DECAY_THRESHOLD = 6;   // no penalty below this many planets
        this.TERRITORY_DECAY_SCALE    = 0.04; // +4% decay per planet above threshold

        // --- Desperation bonus ---
        // Players with very few planets get a production boost
        this.DESPERATION_PLANET_THRESHOLD = 2; // ≤ this many planets triggers bonus
        this.DESPERATION_PRODUCTION_MULT  = 2; // 2× production when desperate

        this.routes = new Map();      // planet -> targetPlanet
        this.ROUTE_THRESHOLD = 10;

        // --- Concerted attack tuning ---
        this.CONCERTED_WINDOW     = 800;  // ms — arrivals within this window count as coordinated
        this.CONCERTED_BONUS      = 0.12; // +12% effectiveness per additional wave
        this.SOLO_ATTACK_PENALTY  = 0.85; // solo attacks are 85% as effective

        this.mousePos = { x: 0, y: 0 };
        this.dragStart = null;
        this.dragCurrent = null;
        this.selectedPlanet = null;
        this.bgTime = 0;
        this.impacts = [];

        // Box-select state
        this.boxSelect = null;        // {startX, startY} during drag
        this.boxCurrent = null;       // {x, y} during drag
        this.selectedPlanets = [];    // planets selected by box
        this.boxMode = null;          // 'send' (left-click) or 'cancel' (shift/touch-btn)
        this.virtualShift = false;    // touch-screen shift toggle

        this.setupEventListeners();
        this.createStarField();
        this.gameLoop();
    }

    /** Sets canvas to full viewport dimensions and caches background gradient. Listens for resize. */
    setupCanvas() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
        this.cacheBackground();

        window.addEventListener('resize', () => {
            this.canvas.width = window.innerWidth;
            this.canvas.height = window.innerHeight;
            this.cacheBackground();
        });
    }

    /** Pre-computes the radial gradient for the deep-space background. Called on init and resize. */
    cacheBackground() {
        const grad = this.ctx.createRadialGradient(
            this.canvas.width / 2, this.canvas.height / 2, 0,
            this.canvas.width / 2, this.canvas.height / 2,
            Math.max(this.canvas.width, this.canvas.height)
        );
        grad.addColorStop(0, '#001122');
        grad.addColorStop(0.5, '#000811');
        grad.addColorStop(1, '#000000');
        this.bgGradient = grad;
    }

    /** Binds mouse, touch, and keyboard events. Handles menu, pause, difficulty keys, and box-select cancel. */
    setupEventListeners() {
        this.canvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
        this.canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        this.canvas.addEventListener('mouseup',   (e) => this.handleMouseUp(e));

        this.canvas.addEventListener('touchstart', (e) => this.handleTouchStart(e));
        this.canvas.addEventListener('touchmove',  (e) => this.handleTouchMove(e));
        this.canvas.addEventListener('touchend',   (e) => this.handleTouchEnd(e));

        this.canvas.addEventListener('click', (e) => {
            if (this.gameState === 'menu') {
                this.handleMenuClick(e);
            } else if (this.gameState === 'won' || this.gameState === 'lost') {
                this.gameState = 'menu';
            }
        });

        window.addEventListener('keydown', (e) => {
            if (this.gameState === 'menu') {
                if (e.key === '1' || e.key === '2' || e.key === '3') {
                    this.difficulty = parseInt(e.key);
                    this.startGame();
                    return;
                }
            }
            if (e.code === 'Space') {
                e.preventDefault();
                if (this.gameState === 'playing') {
                    this.gameState = 'paused';
                    this.pausedAt = Date.now();
                } else if (this.gameState === 'paused') {
                    const pauseDuration = Date.now() - this.pausedAt;
                    this.gameStartTime += pauseDuration;
                    for (const p of this.planets) {
                        p.lastProduction += pauseDuration;
                        p.lastDecay += pauseDuration;
                    }
                    for (let i = 0; i < this.aiLastMove.length; i++) this.aiLastMove[i] += pauseDuration;
                    for (const [p] of this.routes) {
                        if (p.lastAutoSend) p.lastAutoSend += pauseDuration;
                    }
                    this.gameState = 'playing';
                }
            }
            if (e.key === 'Escape') {
                this.clearBoxSelect();
            }
        });
    }

    /** Orchestrates game initialization: sets up players, generates planets, assigns starting positions. */
    initGame() {
        this.setupPlayers();
        this.generatePlanets();
        this.assignStartingPlanets();
    }

    /** Resets all game state and transitions from menu to playing. Called when player picks difficulty. */
    startGame() {
        this.planets = [];
        this.forces = [];
        this.routes = new Map();
        this.gameStartTime = Date.now();
        this.aiLastMove = [0, 0, 0, 0];
        this.gameState = 'playing';
        this.initGame();
        this.createStarField();
        const hint = document.getElementById('hint');
        if (hint) hint.style.display = '';
    }

    /** Returns to menu state. Called from win/loss screen. */
    restartGame() {
        this.gameState = 'menu';
    }

    /** Creates player array based on difficulty. Easy=1 AI, Medium=2, Hard=3. Human is always player 0 (cyan). */
    setupPlayers() {
        // Easy=1 AI, Medium=2 AI, Hard=3 AI
        const aiCount = this.difficulty || 2;
        const colors = [
            { id: 0, color: '#00ffff', name: 'Player 1' },
            { id: 1, color: '#ff00ff', name: 'Player 2' },
            { id: 2, color: '#00ff00', name: 'Player 3' },
            { id: 3, color: '#ffaa00', name: 'Player 4' }
        ];
        this.players = colors.slice(0, 1 + aiCount);
    }

    /**
     * Procedurally generates 25–40 neutral planets as a connected graph.
     * Each planet is within MAX_FORCE_RANGE of at least one neighbor and ≥80px from all others.
     * Post-processes loner planets by nudging them toward potential neighbors.
     * Planet radius: 15–30, production: 1–2 (capped to prevent snowball).
     */
    generatePlanets() {
        const numPlanets = 25 + Math.floor(Math.random() * 15);
        const minSpacing = 80;
        const maxRange = this.MAX_FORCE_RANGE;

        // First planet placed freely
        const firstSize = 15 + Math.random() * 15;
        this.planets.push({
            id: 0,
            x: 100 + Math.random() * (this.canvas.width - 200),
            y: 100 + Math.random() * (this.canvas.height - 200),
            radius: firstSize,
            owner: null,
            forces: Math.floor(firstSize / 2),
            productionRate: Math.max(1, Math.min(2, Math.floor(firstSize / 15))),
            capacity: Math.floor(firstSize * this.CAPACITY_PER_RADIUS),
            maxForces: Math.floor(firstSize * this.MAX_FORCES_PER_RADIUS),
            lastProduction: Date.now(),
            lastDecay: Date.now()
        });

        // Each subsequent planet must be within maxRange of at least one
        // existing planet (connected graph) and ≥ minSpacing from all
        for (let i = 1; i < numPlanets; i++) {
            let x, y, placed = false;
            for (let attempt = 0; attempt < 200; attempt++) {
                x = 100 + Math.random() * (this.canvas.width - 200);
                y = 100 + Math.random() * (this.canvas.height - 200);

                let tooClose = false;
                let neighborsInRange = 0;
                for (let planet of this.planets) {
                    const dist = Math.sqrt((x - planet.x) ** 2 + (y - planet.y) ** 2);
                    if (dist < minSpacing) { tooClose = true; break; }
                    if (dist <= maxRange) neighborsInRange++;
                }
                // Must not overlap AND must reach at least 1 existing planet
                if (!tooClose && neighborsInRange >= 1) { placed = true; break; }
            }
            if (!placed) continue; // skip if couldn't place (very rare)

            const size = 15 + Math.random() * 15;
            this.planets.push({
                id: i,
                x, y,
                radius: size,
                owner: null,
                forces: Math.floor(size / 2),
                productionRate: Math.max(1, Math.min(2, Math.floor(size / 15))),
                capacity: Math.floor(size * this.CAPACITY_PER_RADIUS),
                maxForces: Math.floor(size * this.MAX_FORCES_PER_RADIUS),
                lastProduction: Date.now(),
                lastDecay: Date.now()
            });
        }

        // Post-check: try to give every planet at least 2 neighbors
        // by nudging loners toward their nearest neighbor
        for (let planet of this.planets) {
            const neighbors = this.planets.filter(p =>
                p !== planet &&
                Math.sqrt((p.x - planet.x) ** 2 + (p.y - planet.y) ** 2) <= maxRange
            );
            if (neighbors.length >= 2) continue;
            if (neighbors.length === 0) continue; // shouldn't happen with connected gen

            // Find second-nearest planet outside range and nudge toward it
            const outside = this.planets
                .filter(p => p !== planet && !neighbors.includes(p))
                .sort((a, b) => {
                    const da = Math.sqrt((a.x - planet.x) ** 2 + (a.y - planet.y) ** 2);
                    const db = Math.sqrt((b.x - planet.x) ** 2 + (b.y - planet.y) ** 2);
                    return da - db;
                });
            if (outside.length === 0) continue;

            const target = outside[0];
            const dx = target.x - planet.x;
            const dy = target.y - planet.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist <= maxRange * 1.3) {
                // Nudge 30% of the way toward the target
                const nx = planet.x + dx * 0.3;
                const ny = planet.y + dy * 0.3;
                // Only move if still respects minimum spacing
                const tooClose = this.planets.some(p =>
                    p !== planet &&
                    Math.sqrt((p.x - nx) ** 2 + (p.y - ny) ** 2) < minSpacing
                );
                if (!tooClose) {
                    planet.x = nx;
                    planet.y = ny;
                }
            }
        }
    }

    /**
     * Assigns starting planets to map corners. Human gets corner 0 with difficulty-based count
     * (Easy=3, Medium=2, Hard=1). AI players get 1 planet each in remaining corners.
     * All starting planets are normalized to identical stats: radius 24, 30 forces, production 2.
     */
    assignStartingPlanets() {
        // Difficulty controls human starting planet count; AI always gets 1
        // 1 = Easy (human 3, AI 1), 2 = Medium (human 2, AI 1), 3 = Hard (human 1, AI 1)
        const humanCount = Math.max(1, 4 - this.difficulty); // 3, 2, 1
        const aiCount = 1;

        const corners = [
            { x: 0,                  y: 0 },
            { x: this.canvas.width,  y: 0 },
            { x: 0,                  y: this.canvas.height },
            { x: this.canvas.width,  y: this.canvas.height }
        ];

        const assignToCorner = (cornerIdx, ownerId, count) => {
            for (let j = 0; j < count; j++) {
                let closest = null, closestDist = Infinity;
                for (let planet of this.planets) {
                    if (planet.owner !== null) continue;
                    const dist = Math.sqrt(
                        (planet.x - corners[cornerIdx].x) ** 2 + (planet.y - corners[cornerIdx].y) ** 2
                    );
                    if (dist < closestDist) { closestDist = dist; closest = planet; }
                }
                if (closest) {
                    closest.owner = ownerId;
                    closest.radius = 24;
                    closest.productionRate = 2;
                    closest.forces = 30;
                    closest.capacity = Math.floor(closest.radius * this.CAPACITY_PER_RADIUS);
                    closest.maxForces = Math.floor(closest.radius * this.MAX_FORCES_PER_RADIUS);
                }
            }
        };

        // Player 0 (human) gets corner 0
        assignToCorner(0, 0, humanCount);
        // AI players get remaining corners, 1 planet each
        for (let i = 1; i < this.players.length && i < 4; i++) {
            assignToCorner(i, i, aiCount);
        }
    }

    /**
     * Main animation loop via requestAnimationFrame. Computes delta time (capped at 50ms
     * to prevent physics explosion on tab-switch), updates background animation timer,
     * then calls update() and render().
     * @param {number} timestamp - High-resolution timestamp from requestAnimationFrame
     */
    // Delta time is passed from requestAnimationFrame timestamps (ms)
    gameLoop(timestamp = 0) {
        const dt = Math.min(timestamp - (this.lastTimestamp || timestamp), 50); // cap at 50ms
        this.lastTimestamp = timestamp;
        this.bgTime += dt;
        this.update(dt);
        this.render(dt);
        requestAnimationFrame((ts) => this.gameLoop(ts));
    }

    /**
     * Core game tick. Processes: planet production (with siege taper + desperation bonus),
     * logarithmic force decay (with territory overstretch), force movement/arrival,
     * route auto-sending, AI decisions, and win/loss condition checks.
     * @param {number} dt - Delta time in milliseconds since last frame
     */
    update(dt) {
        if (this.gameState !== 'playing') return;

        const now = Date.now();

        // Pre-compute per-player planet counts for territory mechanics
        const planetCounts = new Array(this.players.length).fill(0);
        for (const p of this.planets) {
            if (p.owner !== null) planetCounts[p.owner]++;
        }

        for (let planet of this.planets) {
            if (planet.owner !== null) {
                const ownedCount = planetCounts[planet.owner];

                // Production: only if below food capacity, tapered by incoming threats
                if (planet.forces < planet.capacity && now - planet.lastProduction > 1150) {
                    const incomingThreat = this.forces
                        .filter(f => f.target === planet && f.owner !== planet.owner)
                        .reduce((sum, f) => sum + f.amount, 0);
                    const threatRatio = incomingThreat / Math.max(planet.forces, 1);
                    const threatMult = Math.max(0, 1 - threatRatio);

                    // Desperation bonus: ≤ threshold planets → boosted production
                    const despMult = ownedCount <= this.DESPERATION_PLANET_THRESHOLD
                        ? this.DESPERATION_PRODUCTION_MULT : 1;

                    const multiplier = threatMult * despMult;
                    planet.productionMultiplier = threatMult;
                    const actualProduction = Math.floor(planet.productionRate * multiplier);
                    if (actualProduction > 0) {
                        planet.forces = Math.min(planet.forces + actualProduction, planet.capacity);
                    }
                    planet.lastProduction = now;
                } else {
                    planet.productionMultiplier = 1;
                }

                // Decay: logarithmic — small surplus barely bleeds, large surplus bleeds faster
                // Territory overstretch: more planets → faster decay
                if (planet.forces > planet.maxForces && now - planet.lastDecay >= this.DECAY_INTERVAL) {
                    const excess = planet.forces - planet.maxForces;
                    const overstretch = Math.max(0, ownedCount - this.TERRITORY_DECAY_THRESHOLD);
                    // log2(excess+1) gives: excess 10→~3, 40→~5, 100→~7, 200→~8
                    const decay = Math.max(1, Math.floor(Math.log2(excess + 1) * (1 + overstretch * 0.15)));
                    planet.forces -= decay;
                    planet.lastDecay = now;
                }
            }
        }

        for (let i = this.forces.length - 1; i >= 0; i--) {
            const force = this.forces[i];
            force.update(dt);
            if (force.hasArrived()) {
                this.handleForceArrival(force);
                this.forces.splice(i, 1);
            }
        }

        this.processRoutes();
        this.updateAI();
        this.checkWinCondition();
    }

    /**
     * Composites all visual layers in draw order: background → stars → routes → planets →
     * forces → impacts → drag line → box-select → virtual shift btn → scoreboard → game state overlays.
     * @param {number} dt - Delta time in ms, passed to renderImpacts for animation
     */
    render(dt) {
        this.renderBackground();
        this.renderStars();
        this.renderRoutes();
        this.renderPlanets();
        this.renderForces();
        this.renderImpacts(dt);
        this.renderDragLine();
        this.renderBoxSelect();
        this.renderVirtualShiftBtn();
        this.renderScoreboard();
        this.renderGameState();
    }

    /**
     * Generates the 3-layer parallax starfield plus galaxy clouds. All elements placed in an
     * oversized circle (diagonal × 0.55) to prevent edge reveal during rotation.
     * Layers: deep stars (300), galaxy clouds (2–4), dust patches (18), close stars (120 with twinkle).
     */
    createStarField() {
        const w = this.canvas.width;
        const h = this.canvas.height;
        const diag = Math.sqrt(w * w + h * h);
        // Overshoot radius so rotation never reveals edges
        const r = diag * 0.55;

        // Deep background stars — tiny, dim, barely move
        this.deepStars = [];
        for (let i = 0; i < 300; i++) {
            const angle = Math.random() * Math.PI * 2;
            const dist = Math.random() * r;
            this.deepStars.push({
                ox: Math.cos(angle) * dist,
                oy: Math.sin(angle) * dist,
                size: Math.random() * 1.2 + 0.3,
                opacity: Math.random() * 0.35 + 0.08
            });
        }

        // Distant galaxy clouds — faint elongated smudges (Magellanic-type)
        this.galaxyClouds = [];
        const cloudCount = 2 + Math.floor(Math.random() * 3); // 2–4 clouds
        for (let i = 0; i < cloudCount; i++) {
            const angle = Math.random() * Math.PI * 2;
            const dist = r * 0.3 + Math.random() * r * 0.5;
            // Each cloud is a cluster of overlapping blobs
            const blobCount = 5 + Math.floor(Math.random() * 6);
            const tilt = Math.random() * Math.PI; // elongation axis
            const spread = 60 + Math.random() * 100;
            const baseHue = [210, 240, 270, 30, 190][Math.floor(Math.random() * 5)];
            const blobs = [];
            for (let b = 0; b < blobCount; b++) {
                const along = (b / (blobCount - 1) - 0.5) * spread;
                const perp = (Math.random() - 0.5) * spread * 0.35;
                blobs.push({
                    dx: Math.cos(tilt) * along - Math.sin(tilt) * perp,
                    dy: Math.sin(tilt) * along + Math.cos(tilt) * perp,
                    radius: 20 + Math.random() * 45,
                    opacity: 0.015 + Math.random() * 0.025,
                    hue: baseHue + (Math.random() - 0.5) * 20,
                    lightness: 35 + Math.random() * 20
                });
            }
            this.galaxyClouds.push({
                ox: Math.cos(angle) * dist,
                oy: Math.sin(angle) * dist,
                blobs
            });
        }

        // Mid-layer dust patches — soft blobs, drift slowly
        this.dustPatches = [];
        for (let i = 0; i < 18; i++) {
            const angle = Math.random() * Math.PI * 2;
            const dist = Math.random() * r;
            this.dustPatches.push({
                ox: Math.cos(angle) * dist,
                oy: Math.sin(angle) * dist,
                radius: 40 + Math.random() * 120,
                hue: Math.random() < 0.5
                    ? 200 + Math.random() * 40     // blue-cyan
                    : 270 + Math.random() * 30,     // purple
                opacity: 0.02 + Math.random() * 0.04
            });
        }

        // Close star field — brighter, drift noticeably faster
        this.closeStars = [];
        for (let i = 0; i < 120; i++) {
            const angle = Math.random() * Math.PI * 2;
            const dist = Math.random() * r;
            this.closeStars.push({
                ox: Math.cos(angle) * dist,
                oy: Math.sin(angle) * dist,
                size: Math.random() * 2.5 + 0.8,
                opacity: Math.random() * 0.7 + 0.3,
                twinkleSpeed: 0.5 + Math.random() * 2,
                twinklePhase: Math.random() * Math.PI * 2
            });
        }
    }

    /** Fills canvas with cached radial space gradient. */
    renderBackground() {
        this.ctx.fillStyle = this.bgGradient;
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }

    /**
     * Renders all parallax layers with per-layer rotation around screen center.
     * Deep: 0.0008 rad/s, dust: 0.002 rad/s, close: 0.004 rad/s with sinusoidal twinkle.
     * Galaxy clouds rotate at deep-star speed. Background always animates (even when paused).
     */
    renderStars() {
        const cx = this.canvas.width / 2;
        const cy = this.canvas.height / 2;
        const t = this.bgTime / 1000; // seconds

        // Rotation speeds (radians/sec) — centre rotates slowest
        const DEEP_ROT   = 0.0008;
        const DUST_ROT   = 0.002;
        const CLOSE_ROT  = 0.004;

        this.ctx.save();

        // --- Deep background stars ---
        const da = t * DEEP_ROT;
        const cosD = Math.cos(da), sinD = Math.sin(da);
        for (const s of this.deepStars) {
            const x = cx + s.ox * cosD - s.oy * sinD;
            const y = cy + s.ox * sinD + s.oy * cosD;
            this.ctx.fillStyle = `rgba(255,255,255,${s.opacity})`;
            this.ctx.beginPath();
            this.ctx.arc(x, y, s.size, 0, Math.PI * 2);
            this.ctx.fill();
        }

        // --- Distant galaxy clouds (Magellanic-type) ---
        for (const cloud of this.galaxyClouds) {
            const gx = cx + cloud.ox * cosD - cloud.oy * sinD;
            const gy = cy + cloud.ox * sinD + cloud.oy * cosD;
            for (const b of cloud.blobs) {
                const bx = gx + b.dx;
                const by = gy + b.dy;
                const grad = this.ctx.createRadialGradient(bx, by, 0, bx, by, b.radius);
                grad.addColorStop(0, `hsla(${b.hue},50%,${b.lightness}%,${b.opacity})`);
                grad.addColorStop(0.6, `hsla(${b.hue},40%,${b.lightness * 0.6}%,${b.opacity * 0.4})`);
                grad.addColorStop(1, `hsla(${b.hue},30%,20%,0)`);
                this.ctx.fillStyle = grad;
                this.ctx.beginPath();
                this.ctx.arc(bx, by, b.radius, 0, Math.PI * 2);
                this.ctx.fill();
            }
        }

        // --- Mid-layer dust / nebula patches ---
        const ma = t * DUST_ROT;
        const cosM = Math.cos(ma), sinM = Math.sin(ma);
        for (const d of this.dustPatches) {
            const x = cx + d.ox * cosM - d.oy * sinM;
            const y = cy + d.ox * sinM + d.oy * cosM;
            const grad = this.ctx.createRadialGradient(x, y, 0, x, y, d.radius);
            grad.addColorStop(0, `hsla(${d.hue},60%,40%,${d.opacity})`);
            grad.addColorStop(1, `hsla(${d.hue},60%,20%,0)`);
            this.ctx.fillStyle = grad;
            this.ctx.beginPath();
            this.ctx.arc(x, y, d.radius, 0, Math.PI * 2);
            this.ctx.fill();
        }

        // --- Close star field ---
        const ca = t * CLOSE_ROT;
        const cosC = Math.cos(ca), sinC = Math.sin(ca);
        for (const s of this.closeStars) {
            const x = cx + s.ox * cosC - s.oy * sinC;
            const y = cy + s.ox * sinC + s.oy * cosC;
            const twinkle = 0.6 + 0.4 * Math.sin(t * s.twinkleSpeed + s.twinklePhase);
            this.ctx.fillStyle = `rgba(255,255,255,${s.opacity * twinkle})`;
            this.ctx.beginPath();
            this.ctx.arc(x, y, s.size, 0, Math.PI * 2);
            this.ctx.fill();
        }

        this.ctx.restore();
    }

    /** Draws top-right scoreboard: all players ranked by planet count with force totals and eliminated status. */
    renderScoreboard() {
        const pad = 12, lineH = 22;
        const boxW = 180;
        const boxH = pad * 2 + this.players.length * lineH;
        const x = this.canvas.width - boxW - 10;
        const y = 10;

        this.ctx.save();
        this.ctx.fillStyle = 'rgba(0,0,0,0.55)';
        this.ctx.strokeStyle = 'rgba(255,255,255,0.12)';
        this.ctx.lineWidth = 1;
        this.ctx.beginPath();
        this.ctx.roundRect(x, y, boxW, boxH, 6);
        this.ctx.fill();
        this.ctx.stroke();

        const planetCount = new Array(this.players.length).fill(0);
        const forceCount  = new Array(this.players.length).fill(0);
        for (let p of this.planets) {
            if (p.owner !== null) {
                planetCount[p.owner]++;
                forceCount[p.owner] += p.forces;
            }
        }

        const order = this.players.map((_, i) => i)
            .sort((a, b) => planetCount[b] - planetCount[a]);

        this.ctx.font = 'bold 13px Arial';
        this.ctx.textAlign = 'left';

        order.forEach((pid, rank) => {
            const py = y + pad + rank * lineH + lineH * 0.75;
            const player = this.players[pid];
            const eliminated = planetCount[pid] === 0 &&
                !this.forces.some(f => f.owner === pid);

            this.ctx.fillStyle = eliminated ? '#444' : player.color;
            this.ctx.shadowColor = eliminated ? 'transparent' : player.color;
            this.ctx.shadowBlur = eliminated ? 0 : 6;
            this.ctx.beginPath();
            this.ctx.arc(x + pad + 5, py - 4, 5, 0, Math.PI * 2);
            this.ctx.fill();
            this.ctx.shadowBlur = 0;

            this.ctx.fillStyle = eliminated ? '#555' : '#ddd';
            this.ctx.fillText(pid === 0 ? 'You' : player.name, x + pad + 16, py);

            this.ctx.fillStyle = eliminated ? '#444' : '#aaa';
            this.ctx.textAlign = 'right';
            this.ctx.fillText(
                eliminated ? 'out' : `${planetCount[pid]}p  ${forceCount[pid]}f`,
                x + boxW - pad, py
            );
            this.ctx.textAlign = 'left';
        });

        this.ctx.restore();
    }

    /** Draws active supply routes as dashed lines with marching-ants animation and arrowheads. Uses player color. */
    renderRoutes() {
        this.ctx.save();
        for (let [planet, target] of this.routes) {
            const playerColor = this.players[planet.owner]?.color ?? '#fff';

            this.ctx.strokeStyle = hexToRgba(playerColor, 0.25);
            this.ctx.lineWidth = 1.5;
            this.ctx.setLineDash([8, 6]);
            this.ctx.lineDashOffset = -(this.bgTime / 60) % 14;
            this.ctx.beginPath();
            this.ctx.moveTo(planet.x, planet.y);
            this.ctx.lineTo(target.x, target.y);
            this.ctx.stroke();

            const angle = Math.atan2(target.y - planet.y, target.x - planet.x);
            const ax = target.x - Math.cos(angle) * (target.radius + 8);
            const ay = target.y - Math.sin(angle) * (target.radius + 8);
            this.ctx.setLineDash([]);
            this.ctx.strokeStyle = hexToRgba(playerColor, 0.5);
            this.ctx.lineWidth = 2;
            this.ctx.beginPath();
            this.ctx.moveTo(ax - Math.cos(angle - 0.4) * 10, ay - Math.sin(angle - 0.4) * 10);
            this.ctx.lineTo(ax, ay);
            this.ctx.lineTo(ax - Math.cos(angle + 0.4) * 10, ay - Math.sin(angle + 0.4) * 10);
            this.ctx.stroke();
        }
        this.ctx.restore();
    }

    /**
     * Renders all planets: owner-colored gradient fills, capacity arc rings (green/yellow/red),
     * and force count text in Orbitron font scaled to planet radius. Arc dims when siege-suppressed.
     */
    renderPlanets() {
        for (let planet of this.planets) {
            this.ctx.save();

            if (planet.owner !== null) {
                const color = this.players[planet.owner].color;
                const grad = this.ctx.createRadialGradient(
                    planet.x - planet.radius * 0.3, planet.y - planet.radius * 0.3, 0,
                    planet.x, planet.y, planet.radius
                );
                grad.addColorStop(0, hexToRgba(color, 0.8));
                grad.addColorStop(1, hexToRgba(color, 0.2));
                this.ctx.fillStyle = grad;
                this.ctx.strokeStyle = color;
                this.ctx.lineWidth = 3;
                this.ctx.shadowColor = color;
                this.ctx.shadowBlur = 10;
            } else {
                const grad = this.ctx.createRadialGradient(
                    planet.x - planet.radius * 0.3, planet.y - planet.radius * 0.3, 0,
                    planet.x, planet.y, planet.radius
                );
                grad.addColorStop(0, '#444');
                grad.addColorStop(1, '#111');
                this.ctx.fillStyle = grad;
                this.ctx.strokeStyle = '#666';
                this.ctx.lineWidth = 2;
            }

            this.ctx.beginPath();
            this.ctx.arc(planet.x, planet.y, planet.radius, 0, Math.PI * 2);
            this.ctx.fill();
            this.ctx.stroke();

            // Capacity arc — shows food level as a ring around the planet
            this.ctx.shadowBlur = 0;
            if (planet.owner !== null) {
                const fillRatio = Math.min(planet.forces / planet.capacity, 1);
                const arcRadius = planet.radius + 4;
                const startAngle = -Math.PI / 2;
                const endAngle = startAngle + fillRatio * Math.PI * 2;

                // Background ring (dims when production suppressed by siege)
                const arcAlpha = 0.08 + (planet.productionMultiplier ?? 1) * 0.25;
                this.ctx.strokeStyle = `rgba(255,255,255,${arcAlpha.toFixed(2)})`;
                this.ctx.lineWidth = 2;
                this.ctx.beginPath();
                this.ctx.arc(planet.x, planet.y, arcRadius, 0, Math.PI * 2);
                this.ctx.stroke();

                // Fill ring — green when under capacity, yellow near cap, red if decaying
                let arcColor;
                if (planet.forces > planet.maxForces) arcColor = '#ff4444';
                else if (planet.forces >= planet.capacity * 0.85) arcColor = '#ffaa00';
                else arcColor = '#44ff44';

                this.ctx.strokeStyle = arcColor;
                this.ctx.lineWidth = 2;
                this.ctx.beginPath();
                this.ctx.arc(planet.x, planet.y, arcRadius, startAngle, endAngle);
                this.ctx.stroke();
            }

            this.ctx.fillStyle = '#fff';
            const fontSize = Math.max(9, Math.min(15, Math.floor(planet.radius * 0.52)));
            this.ctx.font = `bold ${fontSize}px Orbitron, "Courier New", monospace`;
            this.ctx.textAlign = 'center';
            this.ctx.strokeStyle = '#000';
            this.ctx.lineWidth = 3;
            this.ctx.strokeText(planet.forces.toString(), planet.x, planet.y + 5);
            this.ctx.fillText(planet.forces.toString(), planet.x, planet.y + 5);

            this.ctx.restore();
        }
    }

    /** Delegates rendering to each active ForceStream. */
    renderForces() {
        for (let force of this.forces) force.render(this.ctx);
    }

    /**
     * Animates expanding glow rings at hostile force arrival sites (280ms ease-out).
     * Only triggered on combat arrivals, not friendly reinforcements.
     * @param {number} dt - Delta time in ms for age progression
     */
    renderImpacts(dt) {
        for (let i = this.impacts.length - 1; i >= 0; i--) {
            const imp = this.impacts[i];
            imp.age += dt;
            if (imp.age >= imp.maxAge) { this.impacts.splice(i, 1); continue; }
            const t = imp.age / imp.maxAge;
            const eased = 1 - Math.pow(1 - t, 2);
            const r = imp.radius + eased * imp.radius * 1.2;
            const alpha = (1 - t) * 0.7;
            this.ctx.save();
            this.ctx.strokeStyle = hexToRgba(imp.color, alpha);
            this.ctx.lineWidth = 2;
            this.ctx.shadowColor = imp.color;
            this.ctx.shadowBlur = 8;
            this.ctx.beginPath();
            this.ctx.arc(imp.x, imp.y, r, 0, Math.PI * 2);
            this.ctx.stroke();
            this.ctx.restore();
        }
    }

    /**
     * Shows single-planet drag indicator: range circle, arrow with snap targeting,
     * arrowhead, and snap highlight ring. Red when invalid, player-colored when valid.
     */
    renderDragLine() {
        if (!this.dragStart || !this.dragCurrent || !this.selectedPlanet) return;

        const snap = this.getSnapTarget(this.dragCurrent.x, this.dragCurrent.y, this.selectedPlanet);
        const endX = snap ? snap.x : this.dragCurrent.x;
        const endY = snap ? snap.y : this.dragCurrent.y;

        const dx = endX - this.selectedPlanet.x;
        const dy = endY - this.selectedPlanet.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const valid = snap && this.isDragValid(this.selectedPlanet, snap);

        this.ctx.save();

        // Range circle
        this.ctx.strokeStyle = valid ? 'rgba(255,255,255,0.2)' : 'rgba(255,80,80,0.4)';
        this.ctx.lineWidth = 1;
        this.ctx.setLineDash([6, 4]);
        this.ctx.beginPath();
        this.ctx.arc(this.selectedPlanet.x, this.selectedPlanet.y, this.MAX_FORCE_RANGE, 0, Math.PI * 2);
        this.ctx.stroke();

        // Arrow line
        const lineColor = valid ? this.players[this.selectedPlanet.owner].color : '#ff4444';
        this.ctx.strokeStyle = lineColor;
        this.ctx.lineWidth = 2;
        this.ctx.setLineDash([5, 5]);
        this.ctx.beginPath();
        this.ctx.moveTo(this.selectedPlanet.x, this.selectedPlanet.y);
        this.ctx.lineTo(endX, endY);
        this.ctx.stroke();

        // Arrowhead
        if (dist > 20) {
            const angle = Math.atan2(dy, dx);
            const headLen = 12;
            this.ctx.setLineDash([]);
            this.ctx.fillStyle = lineColor;
            this.ctx.beginPath();
            this.ctx.moveTo(endX, endY);
            this.ctx.lineTo(endX - headLen * Math.cos(angle - 0.4), endY - headLen * Math.sin(angle - 0.4));
            this.ctx.lineTo(endX - headLen * Math.cos(angle + 0.4), endY - headLen * Math.sin(angle + 0.4));
            this.ctx.closePath();
            this.ctx.fill();
        }

        // Snap highlight ring on target planet
        if (snap) {
            this.ctx.setLineDash([]);
            this.ctx.strokeStyle = valid ? 'rgba(255,255,255,0.6)' : 'rgba(255,68,68,0.6)';
            this.ctx.lineWidth = 2;
            this.ctx.beginPath();
            this.ctx.arc(snap.x, snap.y, snap.radius + 6, 0, Math.PI * 2);
            this.ctx.stroke();
        }

        this.ctx.restore();
    }

    /**
     * Draws box-select rectangle during drag (cyan for send, red for cancel mode).
     * Shows animated dashed halos on selected planets and "N planets selected — click target" prompt.
     */
    renderBoxSelect() {
        // Draw selection rectangle while dragging
        if (this.boxSelect && this.boxCurrent) {
            const bx = Math.min(this.boxSelect.startX, this.boxCurrent.x);
            const by = Math.min(this.boxSelect.startY, this.boxCurrent.y);
            const bw = Math.abs(this.boxCurrent.x - this.boxSelect.startX);
            const bh = Math.abs(this.boxCurrent.y - this.boxSelect.startY);

            this.ctx.save();
            const isCancel = this.boxMode === 'cancel';
            this.ctx.fillStyle = isCancel ? 'rgba(255,60,60,0.08)' : 'rgba(0,255,255,0.08)';
            this.ctx.fillRect(bx, by, bw, bh);
            this.ctx.strokeStyle = isCancel ? 'rgba(255,60,60,0.5)' : 'rgba(0,255,255,0.5)';
            this.ctx.lineWidth = 1.5;
            this.ctx.setLineDash([6, 4]);
            this.ctx.strokeRect(bx, by, bw, bh);
            this.ctx.restore();
        }

        // Highlight selected planets waiting for target
        if (this.selectedPlanets.length > 0) {
            this.ctx.save();
            for (const p of this.selectedPlanets) {
                this.ctx.strokeStyle = 'rgba(0,255,255,0.8)';
                this.ctx.lineWidth = 2;
                this.ctx.setLineDash([4, 4]);
                this.ctx.lineDashOffset = -(this.bgTime / 80) % 8;
                this.ctx.beginPath();
                this.ctx.arc(p.x, p.y, p.radius + 8, 0, Math.PI * 2);
                this.ctx.stroke();
            }
            // Prompt text
            this.ctx.setLineDash([]);
            this.ctx.font = 'bold 14px Arial';
            this.ctx.textAlign = 'center';
            this.ctx.fillStyle = 'rgba(0,255,255,0.7)';
            this.ctx.fillText(
                `${this.selectedPlanets.length} planet${this.selectedPlanets.length > 1 ? 's' : ''} selected — click target`,
                this.canvas.width / 2, 30
            );
            this.ctx.restore();
        }
    }

    /** Renders "CANCEL MODE" toggle button in bottom-left corner. Only visible on touch-capable devices. */
    renderVirtualShiftBtn() {
        if (this.gameState !== 'playing') return;
        // Only show on touch-capable devices
        if (!('ontouchstart' in window)) return;

        const size = 56;
        const margin = 10;
        const x = margin;
        const y = this.canvas.height - size - margin;

        this.ctx.save();
        this.ctx.fillStyle = this.virtualShift
            ? 'rgba(255,60,60,0.4)' : 'rgba(255,255,255,0.12)';
        this.ctx.strokeStyle = this.virtualShift
            ? 'rgba(255,60,60,0.7)' : 'rgba(255,255,255,0.3)';
        this.ctx.lineWidth = 1.5;
        this.ctx.beginPath();
        this.ctx.roundRect(x, y, size, size, 8);
        this.ctx.fill();
        this.ctx.stroke();

        this.ctx.fillStyle = this.virtualShift ? '#ff6666' : '#aaa';
        this.ctx.font = 'bold 11px Arial';
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        this.ctx.fillText('CANCEL', x + size / 2, y + size / 2 - 6);
        this.ctx.fillText('MODE', x + size / 2, y + size / 2 + 8);
        this.ctx.restore();
    }

    /** Draws difficulty selection screen with title, 3 clickable buttons, and keyboard hint. */
    renderMenu() {
        const cx = this.canvas.width / 2;
        const cy = this.canvas.height / 2;

        this.ctx.save();
        this.ctx.fillStyle = 'rgba(0,0,0,0.7)';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // Title
        this.ctx.font = 'bold 52px Arial';
        this.ctx.textAlign = 'center';
        this.ctx.fillStyle = '#00ffff';
        this.ctx.shadowColor = '#00ffff';
        this.ctx.shadowBlur = 20;
        this.ctx.fillText('XBattle', cx, cy - 130);
        this.ctx.shadowBlur = 0;
        this.ctx.font = '20px Arial';
        this.ctx.fillStyle = '#888';
        this.ctx.fillText('Galcon Fusion', cx, cy - 100);

        // Difficulty buttons
        const labels = ['1 — Easy', '2 — Medium', '3 — Hard'];
        const descs = ['3 starting planets', '2 starting planets', '1 starting planet'];
        const btnW = 220, btnH = 50, gap = 16;
        const startY = cy - 20;

        this._menuButtons = [];
        for (let i = 0; i < 3; i++) {
            const bx = cx - btnW / 2;
            const by = startY + i * (btnH + gap);
            const selected = this.difficulty === i + 1;

            this.ctx.fillStyle = selected ? 'rgba(0,255,255,0.15)' : 'rgba(255,255,255,0.05)';
            this.ctx.strokeStyle = selected ? '#00ffff' : 'rgba(255,255,255,0.2)';
            this.ctx.lineWidth = selected ? 2 : 1;
            this.ctx.beginPath();
            this.ctx.roundRect(bx, by, btnW, btnH, 8);
            this.ctx.fill();
            this.ctx.stroke();

            this.ctx.font = 'bold 18px Arial';
            this.ctx.fillStyle = selected ? '#00ffff' : '#ccc';
            this.ctx.fillText(labels[i], cx, by + 23);
            this.ctx.font = '12px Arial';
            this.ctx.fillStyle = '#777';
            this.ctx.fillText(descs[i], cx, by + 41);

            this._menuButtons.push({ x: bx, y: by, w: btnW, h: btnH, difficulty: i + 1 });
        }

        this.ctx.font = '15px Arial';
        this.ctx.fillStyle = 'rgba(255,255,255,0.4)';
        this.ctx.fillText('Click a difficulty or press 1 / 2 / 3', cx, startY + 3 * (btnH + gap) + 20);

        this.ctx.restore();
    }

    /**
     * Processes clicks on difficulty buttons in menu state.
     * @param {MouseEvent} e - Click event with clientX/clientY
     */
    handleMenuClick(e) {
        const rect = this.canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        if (!this._menuButtons) return;
        for (const btn of this._menuButtons) {
            if (mx >= btn.x && mx <= btn.x + btn.w && my >= btn.y && my <= btn.y + btn.h) {
                this.difficulty = btn.difficulty;
                this.startGame();
                return;
            }
        }
    }

    /** Dispatches to menu/pause/win/loss overlay renderers based on current gameState. */
    renderGameState() {
        if (this.gameState === 'menu') {
            this.renderMenu();
            return;
        }

        if (this.gameState === 'paused') {
            const cx = this.canvas.width / 2;
            const cy = this.canvas.height / 2;
            this.ctx.save();
            this.ctx.fillStyle = 'rgba(0,0,0,0.5)';
            this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
            this.ctx.font = 'bold 48px Arial';
            this.ctx.textAlign = 'center';
            this.ctx.fillStyle = '#ffffff';
            this.ctx.shadowColor = '#00ffff';
            this.ctx.shadowBlur = 15;
            this.ctx.fillText('PAUSED', cx, cy - 10);
            this.ctx.shadowBlur = 0;
            this.ctx.font = '18px Arial';
            this.ctx.fillStyle = 'rgba(255,255,255,0.5)';
            this.ctx.fillText('Press Space to resume', cx, cy + 30);
            this.ctx.restore();
            return;
        }

        if (this.gameState !== 'won' && this.gameState !== 'lost') return;

        const cx = this.canvas.width / 2;
        const cy = this.canvas.height / 2;
        const elapsed = Math.floor((Date.now() - this.gameStartTime) / 1000);
        const mins = Math.floor(elapsed / 60).toString().padStart(2, '0');
        const secs = (elapsed % 60).toString().padStart(2, '0');

        this.ctx.save();
        this.ctx.fillStyle = 'rgba(0,0,0,0.78)';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        const won = this.gameState === 'won';
        this.ctx.font = 'bold 52px Arial';
        this.ctx.textAlign = 'center';
        this.ctx.fillStyle = won ? '#00ffff' : '#ff4444';
        this.ctx.shadowColor = won ? '#00ffff' : '#ff4444';
        this.ctx.shadowBlur = 20;
        this.ctx.fillText(won ? 'VICTORY' : 'DEFEATED', cx, cy - 120);
        this.ctx.shadowBlur = 0;

        if (!won && this.winner !== null) {
            this.ctx.font = '22px Arial';
            this.ctx.fillStyle = this.players[this.winner].color;
            this.ctx.fillText(`${this.players[this.winner].name} conquered the galaxy`, cx, cy - 80);
        }

        this.ctx.font = '16px Arial';
        this.ctx.fillStyle = '#888';
        this.ctx.fillText(`Game time: ${mins}:${secs}`, cx, cy - 52);

        const scores = this.finalScores || [];
        const order = this.players.map((_, i) => i)
            .sort((a, b) => (scores[b] || 0) - (scores[a] || 0));

        const boxW = 320, rowH = 34;
        const boxH = 16 + order.length * rowH + 16;
        const bx = cx - boxW / 2;
        const by = cy - 30;

        this.ctx.fillStyle = 'rgba(255,255,255,0.07)';
        this.ctx.strokeStyle = 'rgba(255,255,255,0.18)';
        this.ctx.lineWidth = 1;
        this.ctx.beginPath();
        this.ctx.roundRect(bx, by, boxW, boxH, 8);
        this.ctx.fill();
        this.ctx.stroke();

        order.forEach((pid, rank) => {
            const py = by + 16 + rank * rowH + rowH * 0.68;
            const player = this.players[pid];
            const ps = scores[pid] || 0;

            this.ctx.font = 'bold 14px Arial';
            this.ctx.fillStyle = '#666';
            this.ctx.textAlign = 'left';
            this.ctx.fillText(`#${rank + 1}`, bx + 14, py);

            this.ctx.fillStyle = player.color;
            this.ctx.shadowColor = player.color;
            this.ctx.shadowBlur = 8;
            this.ctx.beginPath();
            this.ctx.arc(bx + 50, py - 5, 6, 0, Math.PI * 2);
            this.ctx.fill();
            this.ctx.shadowBlur = 0;

            this.ctx.fillStyle = '#eee';
            this.ctx.font = pid === 0 ? 'bold 15px Arial' : '14px Arial';
            this.ctx.fillText(pid === 0 ? 'You' : player.name, bx + 64, py);

            this.ctx.fillStyle = '#aaa';
            this.ctx.textAlign = 'right';
            this.ctx.fillText(`${ps} planet${ps !== 1 ? 's' : ''}`, bx + boxW - 14, py);
            this.ctx.textAlign = 'left';
        });

        this.ctx.font = '18px Arial';
        this.ctx.fillStyle = 'rgba(255,255,255,0.5)';
        this.ctx.textAlign = 'center';
        this.ctx.fillText('Click anywhere to play again', cx, by + boxH + 36);

        this.ctx.restore();
    }

    /** @see hexToRgba — instance-level wrapper for the module-level utility. */
    hexToRgba(hex, alpha) { return hexToRgba(hex, alpha); }

    /**
     * Routes mouse-down to: (1) box-select target assignment if planets are selected,
     * (2) single-planet drag if clicking own planet, (3) new box-select if clicking empty space.
     * @param {MouseEvent} e - Mouse event (or synthetic from touch adapter)
     */
    handleMouseDown(e) {
        this.updateMousePos(e);
        if (this.gameState !== 'playing') return;

        // If we have a box selection waiting for target, a click assigns the target
        if (this.selectedPlanets.length > 0 && this.boxMode === 'send') {
            const target = this.getSnapTarget(this.mousePos.x, this.mousePos.y, null);
            if (target && target.owner !== 0) {
                this.sendSelectedToTarget(target);
            } else if (target && target.owner === 0) {
                // Reinforce own planet
                this.sendSelectedToTarget(target);
            }
            this.clearBoxSelect();
            return;
        }

        // Start single-planet drag if clicking on own planet
        const planet = this.getPlanetAt(this.mousePos.x, this.mousePos.y);
        if (planet && planet.owner === 0) {
            this.dragStart = { ...this.mousePos };
            this.selectedPlanet = planet;
            return;
        }

        // Start box-select from empty space
        this.boxSelect = { startX: this.mousePos.x, startY: this.mousePos.y };
        this.boxCurrent = { ...this.mousePos };
        this.boxMode = (e.shiftKey || this.virtualShift) ? 'cancel' : 'send';
    }

    /** Updates drag or box-select cursor position during mouse movement. */
    handleMouseMove(e) {
        this.updateMousePos(e);
        if (this.dragStart) this.dragCurrent = { ...this.mousePos };
        if (this.boxSelect) this.boxCurrent = { ...this.mousePos };
    }

    /**
     * Finalizes drag/box-select: single-planet drag → set route + send forces (or click → cancel route).
     * Box-select → select owned planets in rectangle; shift mode cancels routes instead.
     */
    handleMouseUp(e) {
        // Single-planet drag release
        if (this.dragStart && this.selectedPlanet) {
            this.updateMousePos(e);
            const ddx = this.mousePos.x - this.dragStart.x;
            const ddy = this.mousePos.y - this.dragStart.y;
            const isClick = Math.sqrt(ddx * ddx + ddy * ddy) < 8;

            if (isClick) {
                this.routes.delete(this.selectedPlanet);
            } else {
                const target = this.getSnapTarget(this.mousePos.x, this.mousePos.y, this.selectedPlanet);
                if (target && this.isDragValid(this.selectedPlanet, target) &&
                    this.selectedPlanet.forces > 0) {
                    this.routes.set(this.selectedPlanet, target);
                    this.sendForces(this.selectedPlanet, target);
                }
            }
            this.dragStart = null;
            this.dragCurrent = null;
            this.selectedPlanet = null;
            return;
        }

        // Box-select release
        if (this.boxSelect) {
            this.updateMousePos(e);
            const bx = Math.min(this.boxSelect.startX, this.mousePos.x);
            const by = Math.min(this.boxSelect.startY, this.mousePos.y);
            const bw = Math.abs(this.mousePos.x - this.boxSelect.startX);
            const bh = Math.abs(this.mousePos.y - this.boxSelect.startY);

            // Must be a real drag, not a tiny click
            if (bw > 10 && bh > 10) {
                const selected = this.planets.filter(p =>
                    p.owner === 0 &&
                    p.x >= bx && p.x <= bx + bw &&
                    p.y >= by && p.y <= by + bh
                );

                if (selected.length > 0) {
                    if (this.boxMode === 'cancel') {
                        // Shift+drag: cancel all routes on selected planets
                        for (const p of selected) this.routes.delete(p);
                        this.clearBoxSelect();
                    } else {
                        // Normal drag: select planets, wait for target click
                        this.selectedPlanets = selected;
                    }
                } else {
                    this.clearBoxSelect();
                }
            } else {
                this.clearBoxSelect();
            }

            this.boxSelect = null;
            this.boxCurrent = null;
        }
    }

    /** Touch adapter: checks for virtual shift button tap first, then delegates to handleMouseDown. */
    handleTouchStart(e) {
        e.preventDefault();
        const t = e.touches[0];
        const rect = this.canvas.getBoundingClientRect();
        const tx = t.clientX - rect.left;
        const ty = t.clientY - rect.top;

        // Virtual shift button: bottom-left 70×70 area
        if (this.gameState === 'playing' && tx < 70 && ty > this.canvas.height - 70) {
            this.virtualShift = !this.virtualShift;
            return;
        }
        this.handleMouseDown({ clientX: t.clientX, clientY: t.clientY, shiftKey: this.virtualShift });
    }

    /** Touch adapter for handleMouseMove. */
    handleTouchMove(e) {
        e.preventDefault();
        const t = e.touches[0];
        this.handleMouseMove({ clientX: t.clientX, clientY: t.clientY });
    }

    /** Touch adapter for handleMouseUp. */
    handleTouchEnd(e) {
        e.preventDefault();
        this.handleMouseUp({ clientX: this.mousePos.x, clientY: this.mousePos.y });
    }

    /**
     * Converts client coordinates to canvas-relative coordinates.
     * @param {MouseEvent} e - Event with clientX/clientY
     */
    updateMousePos(e) {
        const rect = this.canvas.getBoundingClientRect();
        this.mousePos.x = e.clientX - rect.left;
        this.mousePos.y = e.clientY - rect.top;
    }

    /**
     * Returns the planet whose center is within its radius of (x,y), or null.
     * @param {number} x - Canvas X coordinate
     * @param {number} y - Canvas Y coordinate
     * @returns {Object|null} Planet object or null
     */
    getPlanetAt(x, y) {
        for (let planet of this.planets) {
            const dist = Math.sqrt((x - planet.x) ** 2 + (y - planet.y) ** 2);
            if (dist <= planet.radius) return planet;
        }
        return null;
    }

    /**
     * Finds nearest planet within 50px snap radius of cursor (excluding fromPlanet).
     * Makes drag targeting forgiving — don't need pixel-perfect aim.
     * @param {number} x - Canvas X coordinate
     * @param {number} y - Canvas Y coordinate
     * @param {Object|null} fromPlanet - Planet to exclude (the drag source)
     * @returns {Object|null} Nearest snappable planet or null
     */
    getSnapTarget(x, y, fromPlanet) {
        const SNAP_RADIUS = 50;
        let best = null, bestDist = Infinity;
        for (const p of this.planets) {
            if (p === fromPlanet) continue;
            const d = Math.sqrt((x - p.x) ** 2 + (y - p.y) ** 2);
            if (d < SNAP_RADIUS + p.radius && d < bestDist) {
                best = p;
                bestDist = d;
            }
        }
        return best;
    }

    /**
     * Validates that target exists, isn't the same planet, and is within MAX_FORCE_RANGE.
     * @param {Object} fromPlanet - Source planet
     * @param {Object} target - Destination planet
     * @returns {boolean} True if the drag/route is valid
     */
    isDragValid(fromPlanet, target) {
        if (!target || target === fromPlanet) return false;
        const dx = target.x - fromPlanet.x;
        const dy = target.y - fromPlanet.y;
        return Math.sqrt(dx * dx + dy * dy) <= this.MAX_FORCE_RANGE;
    }

    /** Resets all box-select state and virtual shift toggle. Called on cancel, completion, or Escape. */
    clearBoxSelect() {
        this.selectedPlanets = [];
        this.boxSelect = null;
        this.boxCurrent = null;
        this.boxMode = null;
        this.virtualShift = false;
    }

    /**
     * Euclidean distance between two objects with x,y properties.
     * @param {{x:number,y:number}} a
     * @param {{x:number,y:number}} b
     * @returns {number} Distance in pixels
     */
    distBetween(a, b) {
        return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
    }

    /**
     * BFS pathfinding through player-owned planets to find a relay chain when target is
     * beyond direct range. Returns the first hop planet for the route.
     * Used by box-select to enable smart routing across the map.
     * @param {Object} source - Starting planet (must be owned by player 0)
     * @param {Object} target - Destination planet (any owner)
     * @returns {Object|null} First hop planet to route through, or null if unreachable
     */
    // BFS to find a relay chain from source to target through owned planets
    findRouteChain(source, target) {
        if (this.distBetween(source, target) <= this.MAX_FORCE_RANGE) {
            return target; // direct route
        }
        // BFS through owned planets to find nearest intermediate relay
        const owned = this.planets.filter(p => p.owner === 0 && p !== source);
        const visited = new Set([source.id]);
        const queue = [{ planet: source, firstHop: null }];

        while (queue.length > 0) {
            const { planet, firstHop } = queue.shift();
            // Find neighbors within range
            for (const next of owned) {
                if (visited.has(next.id)) continue;
                if (this.distBetween(planet, next) > this.MAX_FORCE_RANGE) continue;
                visited.add(next.id);
                const hop = firstHop || next;
                // Can this neighbor reach the target?
                if (this.distBetween(next, target) <= this.MAX_FORCE_RANGE) {
                    return hop; // route through this first hop
                }
                queue.push({ planet: next, firstHop: hop });
            }
        }
        return null; // no path found
    }

    /**
     * Iterates box-selected planets and sets routes/sends forces to target.
     * Uses findRouteChain() for out-of-range planets to create relay chains.
     * @param {Object} target - Destination planet to send all selected forces toward
     */
    sendSelectedToTarget(target) {
        for (const planet of this.selectedPlanets) {
            if (planet === target || planet.forces <= 0) continue;
            const routeTo = this.findRouteChain(planet, target);
            if (routeTo) {
                this.routes.set(planet, routeTo);
                this.sendForces(planet, routeTo);
            }
        }
    }

    /**
     * Creates a ForceStream: deducts 50% of source forces and spawns an animated particle stream.
     * Hides the tutorial hint on the first human send.
     * @param {Object} fromPlanet - Source planet (forces deducted from here)
     * @param {Object} toPlanet - Destination planet (ForceStream target)
     */
    sendForces(fromPlanet, toPlanet) {
        const forcesToSend = Math.floor(fromPlanet.forces * 0.5);
        if (forcesToSend <= 0) return;
        fromPlanet.forces -= forcesToSend;
        this.forces.push(new ForceStream(
            fromPlanet.x, fromPlanet.y,
            toPlanet.x,   toPlanet.y,
            forcesToSend,
            fromPlanet.owner,
            toPlanet,
            this.players[fromPlanet.owner].color
        ));
        if (fromPlanet.owner === 0) {
            const hint = document.getElementById('hint');
            if (hint) hint.style.display = 'none';
        }
    }

    /**
     * Auto-sends forces along established routes every 1150ms when source has ≥ ROUTE_THRESHOLD forces.
     * Cleans up routes on unowned (neutral) planets.
     */
    processRoutes() {
        const now = Date.now();
        for (let [planet, target] of this.routes) {
            // Drop route if planet changed hands or target was captured by same owner
            if (planet.owner === null) {
                this.routes.delete(planet);
                continue;
            }
            if (planet.forces >= this.ROUTE_THRESHOLD &&
                (!planet.lastAutoSend || now - planet.lastAutoSend >= 1150)) {
                this.sendForces(planet, target);
                planet.lastAutoSend = now;
            }
        }
    }

    /**
     * Combat resolution when a ForceStream reaches its target.
     * Friendly → reinforce (uncapped, but excess will decay naturally).
     * Hostile → concerted attack tracking (800ms window for coordination bonus),
     * Lanchester √ bonus for overwhelming force, solo attack penalty.
     * Clears captured planet's routes on ownership change.
     * @param {ForceStream} force - The arriving force stream
     */
    handleForceArrival(force) {
        const target = force.target;
        if (target.owner === force.owner) {
            target.forces += force.amount;
            return;
        }

        // Track recent hostile arrivals for concerted attack bonus
        const now = Date.now();
        if (!target._recentAttacks) target._recentAttacks = [];
        target._recentAttacks.push({ owner: force.owner, time: now });
        // Prune old entries
        target._recentAttacks = target._recentAttacks.filter(
            a => now - a.time <= this.CONCERTED_WINDOW
        );
        // Count waves from this attacker in the window (excluding current)
        const waves = target._recentAttacks.filter(a => a.owner === force.owner).length;
        // waves=1 → solo (penalty), waves≥2 → coordinated (bonus per extra wave)
        const coordMult = waves <= 1
            ? this.SOLO_ATTACK_PENALTY
            : 1 + (waves - 1) * this.CONCERTED_BONUS;

        const color = this.players[force.owner]?.color ?? '#ffffff';
        this.impacts.push({
            x: target.x, y: target.y, color,
            radius: target.radius, age: 0, maxAge: 280
        });
        const atk = force.amount;
        const def = target.forces;
        if (def <= 0) {
            this.routes.delete(target);
            target.owner = force.owner;
            target.forces = atk;
            return;
        }
        const ratio = atk / def;
        const lanchesterBonus = ratio > 1 ? Math.sqrt(ratio) : 1;
        const effectiveAtk = Math.floor(atk * lanchesterBonus * coordMult);
        target.forces -= effectiveAtk;
        if (target.forces < 0) {
            this.routes.delete(target);
            target.owner = force.owner;
            target.forces = Math.floor(Math.abs(target.forces) / (lanchesterBonus * coordMult));
        }
    }

    /** Checks if player lost (no planets + no forces in flight), won (all enemies eliminated), or an AI won. */
    checkWinCondition() {
        const planetCount = new Array(this.players.length).fill(0);
        for (let p of this.planets) {
            if (p.owner !== null) planetCount[p.owner]++;
        }

        const alive = this.players.map((_, i) =>
            planetCount[i] > 0 || this.forces.some(f => f.owner === i)
        );

        if (!alive[0]) {
            this.gameState = 'lost';
            this.winner = null;
            this.finalScores = planetCount;
            return;
        }

        if (!alive.slice(1).some(v => v)) {
            this.gameState = 'won';
            this.winner = 0;
            this.finalScores = planetCount;
            return;
        }

        const aliveIds = this.players.map((_, i) => i).filter(i => alive[i]);
        if (aliveIds.length === 1 && aliveIds[0] !== 0) {
            this.gameState = 'lost';
            this.winner = aliveIds[0];
            this.finalScores = planetCount;
        }
    }

    /**
     * Dynamic AI tick rate. Behind → panic (0.4× = 1600ms), even → normal,
     * ahead → mildly relaxed (1.1× = 4400ms). AI never truly relaxes.
     * @param {number} playerId - AI player index
     * @returns {number} Interval in milliseconds
     */
    // Dynamic interval: AI behind → shorter (panic), AI ahead → slightly shorter too (press advantage)
    getAIInterval(playerId) {
        const playerPlanets = this.planets.filter(p => p.owner === 0).length;
        const aiPlanets     = this.planets.filter(p => p.owner === playerId).length;
        const ratio = aiPlanets / Math.max(playerPlanets, 1);
        // Behind (ratio < 1) → panic, down to 0.4×
        // Even (ratio ≈ 1) → normal
        // Ahead (ratio > 1) → only mildly relaxed, cap at 1.1× (press the advantage)
        const scale = ratio < 1
            ? Math.max(0.4, ratio)
            : Math.min(1.1, 0.9 + ratio * 0.1);
        return this.AI_MOVE_INTERVAL * scale;
    }

    /** Fires AI decisions for each AI player when their dynamic interval has elapsed. */
    updateAI() {
        if (!this.aiEnabled) return;
        const now = Date.now();
        for (let i = 1; i < this.players.length; i++) {
            if (now - this.aiLastMove[i] >= this.getAIInterval(i)) {
                this.makeAIMove(i);
                this.aiLastMove[i] = now;
            }
        }
    }

    /**
     * AI decision-making: clears stale routes, sorts owned planets by force count,
     * activates top 40% (min 2), and sets routes to best-scored targets.
     * @param {number} playerId - AI player index
     */
    // Scale active planets with territory size — more planets = more active fronts
    makeAIMove(playerId) {
        // Clear stale AI routes (target captured by same owner, or source lost)
        for (const [planet, target] of this.routes) {
            if (planet.owner !== playerId) continue;
            if (target.owner === playerId || planet.owner === null) {
                this.routes.delete(planet);
            }
        }

        const aiPlanets = this.planets
            .filter(p => p.owner === playerId && p.forces > 10)
            .sort((a, b) => b.forces - a.forces);
        const maxActive = Math.max(2, Math.ceil(aiPlanets.length * 0.4));
        for (const source of aiPlanets.slice(0, maxActive)) {
            const target = this.selectBestTargetPlanet(source, playerId);
            if (target) {
                this.routes.set(source, target);
                this.sendForces(source, target);
            }
        }
    }

    /**
     * AI target scoring. Skips own planets. Scores neutrals by production/distance,
     * enemies by force advantage/production/distance. Applies territorial bias toward
     * nearest rival and capacity pressure bonus when source planet is near cap.
     * @param {Object} sourcePlanet - AI planet sending forces
     * @param {number} playerId - AI player index
     * @returns {Object|null} Best target planet or null if none viable
     */
    selectBestTargetPlanet(sourcePlanet, playerId) {
        const candidates = this.planets.filter(p => {
            if (p === sourcePlanet) return false;
            const dx = p.x - sourcePlanet.x;
            const dy = p.y - sourcePlanet.y;
            return Math.sqrt(dx * dx + dy * dy) <= this.MAX_FORCE_RANGE;
        });

        // Find this AI's nearest rival (by average planet distance) — prefer fighting them
        const nearestRival = this.findNearestRival(playerId);

        let bestTarget = null, bestScore = -Infinity;

        for (let planet of candidates) {
            const distance = Math.sqrt(
                (planet.x - sourcePlanet.x) ** 2 + (planet.y - sourcePlanet.y) ** 2
            );
            let score = 0;

            if (planet.owner === playerId) {
                // Cannot send to own planets — skip
                continue;
            } else if (planet.owner === null) {
                // Expand into neutrals — medium priority
                score = planet.productionRate * 3 - distance * 0.01;
            } else if (sourcePlanet.forces >= planet.forces * 1.2) {
                // Attack with modest advantage (was 1.5× — too conservative)
                const adv = sourcePlanet.forces - planet.forces;
                score = planet.productionRate * 4 - distance * 0.01 + adv * 0.1;
                // Territorial bias: strongly prefer attacking nearest rival over others
                if (planet.owner === nearestRival) {
                    score *= 1.5;
                }
            }

            // Pressure: if source is near capacity, lower the bar — must spend forces
            if (sourcePlanet.forces >= sourcePlanet.capacity * 0.8 && planet.owner !== playerId) {
                score += 3;
            }

            if (score > bestScore) { bestScore = score; bestTarget = planet; }
        }

        return bestTarget;
    }

    /**
     * Finds which enemy has planets closest to this AI's territory center.
     * Used for territorial focus — AI prefers attacking the nearest rival.
     * @param {number} playerId - AI player index
     * @returns {number|null} Owner ID of nearest rival, or null
     */
    // Find which rival has planets closest to this AI's territory
    findNearestRival(playerId) {
        const myPlanets = this.planets.filter(p => p.owner === playerId);
        if (myPlanets.length === 0) return null;

        // Center of this AI's territory
        const cx = myPlanets.reduce((s, p) => s + p.x, 0) / myPlanets.length;
        const cy = myPlanets.reduce((s, p) => s + p.y, 0) / myPlanets.length;

        let nearest = null, nearestDist = Infinity;
        for (let p of this.planets) {
            if (p.owner === null || p.owner === playerId) continue;
            const dist = Math.sqrt((p.x - cx) ** 2 + (p.y - cy) ** 2);
            if (dist < nearestDist) { nearestDist = dist; nearest = p.owner; }
        }
        return nearest;
    }
}

/**
 * Represents a moving force between two planets. Rendered as a gradient trail
 * with a bright head dot. Width scales logarithmically with force count.
 */
class ForceStream {
    /**
     * @param {number} startX - Origin X (source planet center)
     * @param {number} startY - Origin Y
     * @param {number} endX - Destination X (target planet center)
     * @param {number} endY - Destination Y
     * @param {number} amount - Number of forces in transit
     * @param {number} owner - Player index who owns this force
     * @param {Object} target - Target planet object (for arrival resolution)
     * @param {string} color - CSS hex color for rendering
     */
    constructor(startX, startY, endX, endY, amount, owner, target, color) {
        this.startX = startX;
        this.startY = startY;
        this.endX = endX;
        this.endY = endY;
        this.amount = amount;
        this.owner = owner;
        this.target = target;
        this.color = color;
        this.progress = 0;

        const dist = Math.sqrt((endX - startX) ** 2 + (endY - startY) ** 2);
        // 100px/sec expressed as fraction-of-journey per second
        this.speed = 85 / Math.max(dist, 1);
    }

    /**
     * Advances progress along the path. Speed is pre-computed as fraction-of-journey per second.
     * @param {number} dt - Delta time in milliseconds
     */
    // dt is milliseconds from the game loop
    update(dt) {
        this.progress += this.speed * dt / 1000;
    }

    /** @returns {boolean} True when the force has reached its destination (progress ≥ 1) */
    hasArrived() {
        return this.progress >= 1;
    }

    /**
     * Draws gradient trail from tail to head with logarithmic width scaling,
     * plus a bright white head dot. Trail length is 18% of total journey distance.
     * @param {CanvasRenderingContext2D} ctx - Canvas 2D context
     */
    render(ctx) {
        const headP = Math.min(this.progress, 1);
        const tailP = Math.max(0, this.progress - 0.18);
        if (headP <= 0) return;

        const headX = this.startX + (this.endX - this.startX) * headP;
        const headY = this.startY + (this.endY - this.startY) * headP;
        const tailX = this.startX + (this.endX - this.startX) * tailP;
        const tailY = this.startY + (this.endY - this.startY) * tailP;

        ctx.save();

        if (headX !== tailX || headY !== tailY) {
            const grad = ctx.createLinearGradient(tailX, tailY, headX, headY);
            grad.addColorStop(0, hexToRgba(this.color, 0));
            grad.addColorStop(1, hexToRgba(this.color, 0.85));
            ctx.strokeStyle = grad;
            ctx.lineWidth = 1.5 + Math.log2(Math.max(this.amount, 1)) * 0.6;
            ctx.lineCap = 'round';
            ctx.shadowColor = this.color;
            ctx.shadowBlur = 8;
            ctx.beginPath();
            ctx.moveTo(tailX, tailY);
            ctx.lineTo(headX, headY);
            ctx.stroke();
        }

        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = this.color;
        ctx.shadowBlur = 14;
        ctx.beginPath();
        ctx.arc(headX, headY, 3.5, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
    }
}

/** Bootstrap: instantiate the game when the page has fully loaded. */
window.addEventListener('load', () => { new XBattleGame(); });
