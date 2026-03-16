// Module-level utility — used by both classes
function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

class XBattleGame {
    constructor() {
        this.canvas = document.getElementById('gameCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.setupCanvas(); // also caches bgGradient

        this.planets = [];
        this.forces = [];
        this.players = [];
        this.gameState = 'playing';
        this.gameStartTime = Date.now();
        this.aiEnabled = true;
        this.aiLastMove = [0, 0, 0, 0];
        this.AI_MOVE_INTERVAL = 4000;
        this.MAX_FORCE_RANGE  = 400;

        // --- Planet capacity tuning ---
        // capacity: production stops when forces reach this (food runs out)
        //   = radius × CAPACITY_PER_RADIUS
        // maxForces: forces above this decay over time (can temporarily exceed via reinforcement)
        //   = radius × MAX_FORCES_PER_RADIUS
        // decayRate: forces lost per second when above maxForces
        //   = excess × DECAY_RATE_FRACTION (so larger excess decays faster)
        this.CAPACITY_PER_RADIUS   = 3;    // e.g. radius 24 → capacity 72
        this.MAX_FORCES_PER_RADIUS = 5;    // e.g. radius 24 → maxForces 120
        this.DECAY_RATE_FRACTION   = 0.15; // 15% of excess per second
        this.DECAY_INTERVAL        = 500;  // check decay every 500ms

        this.routes = new Map();      // planet -> targetPlanet
        this.ROUTE_THRESHOLD = 10;

        this.mousePos = { x: 0, y: 0 };
        this.dragStart = null;
        this.dragCurrent = null;
        this.selectedPlanet = null;
        this.bgTime = 0;

        this.setupEventListeners();
        this.initGame();
        this.createStarField();
        this.gameLoop();
    }

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

    setupEventListeners() {
        this.canvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
        this.canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        this.canvas.addEventListener('mouseup',   (e) => this.handleMouseUp(e));

        this.canvas.addEventListener('touchstart', (e) => this.handleTouchStart(e));
        this.canvas.addEventListener('touchmove',  (e) => this.handleTouchMove(e));
        this.canvas.addEventListener('touchend',   (e) => this.handleTouchEnd(e));

        this.canvas.addEventListener('click', (e) => {
            if (this.gameState === 'won' || this.gameState === 'lost') {
                this.restartGame();
            }
        });

        window.addEventListener('keydown', (e) => {
            if (e.code === 'Space') {
                e.preventDefault();
                if (this.gameState === 'playing') {
                    this.gameState = 'paused';
                    this.pausedAt = Date.now();
                } else if (this.gameState === 'paused') {
                    // Adjust all timestamps so the pause gap is invisible
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
        });
    }

    initGame() {
        this.setupPlayers();
        this.generatePlanets();
        this.assignStartingPlanets();
    }

    restartGame() {
        this.planets = [];
        this.forces = [];
        this.routes = new Map();
        this.gameState = 'playing';
        this.gameStartTime = Date.now();
        this.aiLastMove = [0, 0, 0, 0];
        this.initGame();
        this.createStarField();
    }

    setupPlayers() {
        this.players = [
            { id: 0, color: '#00ffff', name: 'Player 1' },
            { id: 1, color: '#ff00ff', name: 'Player 2' },
            { id: 2, color: '#00ff00', name: 'Player 3' },
            { id: 3, color: '#ffaa00', name: 'Player 4' }
        ];
    }

    generatePlanets() {
        const numPlanets = 25 + Math.floor(Math.random() * 15);
        const minSpacing = 80;
        const maxRange = this.MAX_FORCE_RANGE;

        // First planet placed freely
        const firstSize = 15 + Math.random() * 25;
        this.planets.push({
            id: 0,
            x: 100 + Math.random() * (this.canvas.width - 200),
            y: 100 + Math.random() * (this.canvas.height - 200),
            radius: firstSize,
            owner: null,
            forces: Math.floor(firstSize / 2),
            productionRate: Math.max(1, Math.floor(firstSize / 10)),
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

            const size = 15 + Math.random() * 25;
            this.planets.push({
                id: i,
                x, y,
                radius: size,
                owner: null,
                forces: Math.floor(size / 2),
                productionRate: Math.max(1, Math.floor(size / 10)),
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

    assignStartingPlanets() {
        const corners = [
            { x: 0,                  y: 0 },
            { x: this.canvas.width,  y: 0 },
            { x: 0,                  y: this.canvas.height },
            { x: this.canvas.width,  y: this.canvas.height }
        ];

        for (let i = 0; i < this.players.length && i < 4; i++) {
            for (let j = 0; j < 3; j++) {
                let closest = null, closestDist = Infinity;
                for (let planet of this.planets) {
                    if (planet.owner !== null) continue;
                    const dist = Math.sqrt(
                        (planet.x - corners[i].x) ** 2 + (planet.y - corners[i].y) ** 2
                    );
                    if (dist < closestDist) { closestDist = dist; closest = planet; }
                }
                if (closest) {
                    closest.owner = i;
                    // Normalize ALL starting planets so no player gets a size advantage
                    closest.radius = j === 0 ? 24 : 20;
                    closest.productionRate = 2;
                    closest.forces = j === 0 ? 50 : 10;
                    closest.capacity = Math.floor(closest.radius * this.CAPACITY_PER_RADIUS);
                    closest.maxForces = Math.floor(closest.radius * this.MAX_FORCES_PER_RADIUS);
                }
            }
        }
    }

    // Delta time is passed from requestAnimationFrame timestamps (ms)
    gameLoop(timestamp = 0) {
        const dt = Math.min(timestamp - (this.lastTimestamp || timestamp), 50); // cap at 50ms
        this.lastTimestamp = timestamp;
        this.bgTime += dt;
        this.update(dt);
        this.render();
        requestAnimationFrame((ts) => this.gameLoop(ts));
    }

    update(dt) {
        if (this.gameState !== 'playing') return;

        const now = Date.now();

        for (let planet of this.planets) {
            if (planet.owner !== null) {
                // Production: only if below food capacity
                if (planet.forces < planet.capacity && now - planet.lastProduction > 1150) {
                    planet.forces = Math.min(planet.forces + planet.productionRate, planet.capacity);
                    planet.lastProduction = now;
                }
                // Decay: forces above maxForces dwindle over time
                if (planet.forces > planet.maxForces && now - planet.lastDecay >= this.DECAY_INTERVAL) {
                    const excess = planet.forces - planet.maxForces;
                    const decay = Math.max(1, Math.floor(excess * this.DECAY_RATE_FRACTION));
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

    render() {
        this.renderBackground();
        this.renderStars();
        this.renderRoutes();
        this.renderPlanets();
        this.renderForces();
        this.renderDragLine();
        this.renderScoreboard();
        this.renderGameState();
    }

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

    renderBackground() {
        this.ctx.fillStyle = this.bgGradient;
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }

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

    renderRoutes() {
        this.ctx.save();
        for (let [planet, target] of this.routes) {
            const playerColor = this.players[planet.owner]?.color ?? '#fff';

            this.ctx.strokeStyle = hexToRgba(playerColor, 0.25);
            this.ctx.lineWidth = 1.5;
            this.ctx.setLineDash([8, 6]);
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

                // Background ring (dim)
                this.ctx.strokeStyle = 'rgba(255,255,255,0.08)';
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
            this.ctx.font = 'bold 14px Arial';
            this.ctx.textAlign = 'center';
            this.ctx.strokeStyle = '#000';
            this.ctx.lineWidth = 3;
            this.ctx.strokeText(planet.forces.toString(), planet.x, planet.y + 5);
            this.ctx.fillText(planet.forces.toString(), planet.x, planet.y + 5);

            this.ctx.restore();
        }
    }

    renderForces() {
        for (let force of this.forces) force.render(this.ctx);
    }

    renderDragLine() {
        if (!this.dragStart || !this.dragCurrent || !this.selectedPlanet) return;

        const dx = this.dragCurrent.x - this.selectedPlanet.x;
        const dy = this.dragCurrent.y - this.selectedPlanet.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const outOfRange = dist > this.MAX_FORCE_RANGE;

        this.ctx.save();

        this.ctx.strokeStyle = outOfRange ? 'rgba(255,80,80,0.4)' : 'rgba(255,255,255,0.2)';
        this.ctx.lineWidth = 1;
        this.ctx.setLineDash([6, 4]);
        this.ctx.beginPath();
        this.ctx.arc(this.selectedPlanet.x, this.selectedPlanet.y, this.MAX_FORCE_RANGE, 0, Math.PI * 2);
        this.ctx.stroke();

        this.ctx.strokeStyle = outOfRange ? '#ff4444' : this.players[this.selectedPlanet.owner].color;
        this.ctx.lineWidth = 2;
        this.ctx.setLineDash([5, 5]);
        this.ctx.beginPath();
        this.ctx.moveTo(this.dragStart.x, this.dragStart.y);
        this.ctx.lineTo(this.dragCurrent.x, this.dragCurrent.y);
        this.ctx.stroke();

        this.ctx.restore();
    }

    renderGameState() {
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

    hexToRgba(hex, alpha) { return hexToRgba(hex, alpha); }

    handleMouseDown(e) {
        this.updateMousePos(e);
        const planet = this.getPlanetAt(this.mousePos.x, this.mousePos.y);
        if (planet && planet.owner === 0) {
            this.dragStart = { ...this.mousePos };
            this.selectedPlanet = planet;
        }
    }

    handleMouseMove(e) {
        this.updateMousePos(e);
        if (this.dragStart) this.dragCurrent = { ...this.mousePos };
    }

    handleMouseUp(e) {
        if (this.dragStart && this.selectedPlanet) {
            this.updateMousePos(e);
            const ddx = this.mousePos.x - this.dragStart.x;
            const ddy = this.mousePos.y - this.dragStart.y;
            const isClick = Math.sqrt(ddx * ddx + ddy * ddy) < 8;

            if (isClick) {
                this.routes.delete(this.selectedPlanet);
            } else {
                const target = this.getPlanetAt(this.mousePos.x, this.mousePos.y);
                if (target && target !== this.selectedPlanet) {
                    const dx = target.x - this.selectedPlanet.x;
                    const dy = target.y - this.selectedPlanet.y;
                    if (Math.sqrt(dx * dx + dy * dy) <= this.MAX_FORCE_RANGE &&
                        this.selectedPlanet.forces > 0) {
                        this.routes.set(this.selectedPlanet, target);
                        this.sendForces(this.selectedPlanet, target);
                    }
                }
            }
        }
        this.dragStart = null;
        this.dragCurrent = null;
        this.selectedPlanet = null;
    }

    handleTouchStart(e) {
        e.preventDefault();
        const t = e.touches[0];
        this.handleMouseDown({ clientX: t.clientX, clientY: t.clientY });
    }

    handleTouchMove(e) {
        e.preventDefault();
        const t = e.touches[0];
        this.handleMouseMove({ clientX: t.clientX, clientY: t.clientY });
    }

    handleTouchEnd(e) {
        e.preventDefault();
        this.handleMouseUp({ clientX: this.mousePos.x, clientY: this.mousePos.y });
    }

    updateMousePos(e) {
        const rect = this.canvas.getBoundingClientRect();
        this.mousePos.x = e.clientX - rect.left;
        this.mousePos.y = e.clientY - rect.top;
    }

    getPlanetAt(x, y) {
        for (let planet of this.planets) {
            const dist = Math.sqrt((x - planet.x) ** 2 + (y - planet.y) ** 2);
            if (dist <= planet.radius) return planet;
        }
        return null;
    }

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
    }

    processRoutes() {
        const now = Date.now();
        for (let [planet, target] of this.routes) {
            // Drop route if planet changed hands
            if (planet.owner !== 0) {
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

    handleForceArrival(force) {
        const target = force.target;
        if (target.owner === force.owner) {
            // Forces only move one way — friendly arrivals are absorbed (lost)
            return;
        }
        // Lanchester-style combat: the larger force has an advantage.
        const atk = force.amount;
        const def = target.forces;
        if (def <= 0) {
            target.owner = force.owner;
            target.forces = atk;
            return;
        }
        const ratio = atk / def;
        const bonus = ratio > 1 ? Math.sqrt(ratio) : 1;
        const effectiveAtk = Math.floor(atk * bonus);
        target.forces -= effectiveAtk;
        if (target.forces < 0) {
            target.owner = force.owner;
            target.forces = Math.floor(Math.abs(target.forces) / bonus);
        }
    }

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

    // Scale active planets with territory size — more planets = more active fronts
    makeAIMove(playerId) {
        const aiPlanets = this.planets
            .filter(p => p.owner === playerId && p.forces > 10)
            .sort((a, b) => b.forces - a.forces);
        const maxActive = Math.max(2, Math.ceil(aiPlanets.length * 0.4));
        for (const source of aiPlanets.slice(0, maxActive)) {
            const target = this.selectBestTargetPlanet(source, playerId);
            if (target) this.sendForces(source, target);
        }
    }

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

class ForceStream {
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

    // dt is milliseconds from the game loop
    update(dt) {
        this.progress += this.speed * dt / 1000;
    }

    hasArrived() {
        return this.progress >= 1;
    }

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
            ctx.lineWidth = 3;
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

window.addEventListener('load', () => { new XBattleGame(); });
