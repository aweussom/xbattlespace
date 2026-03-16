// Snapshot builder — generates compact game state for the LLM advisor
// Intended to be added as a method on XBattleGame during headless simulation

function buildAdvisorSnapshot(game) {
    const myPlanets = game.planets
        .filter(p => p.owner === 0)
        .map(p => {
            const route = game.routes.get(p);
            return {
                id: p.id,
                forces: p.forces,
                production: p.productionRate,
                hasRoute: !!route,
                routeTarget: route ? route.id : null,
                routeDrainPerSec: route ? Math.floor(p.forces * 0.5) : 0
            };
        });

    const myPlanetObjs = game.planets.filter(p => p.owner === 0);
    const myPlanetIds = new Set(myPlanetObjs.map(p => p.id));

    // Incoming threats: enemy forces heading toward our planets
    const incomingThreats = game.forces
        .filter(f => f.owner !== 0 && myPlanetIds.has(f.target.id))
        .map(f => ({
            targetId: f.target.id,
            amount: f.amount,
            owner: f.owner,
            etaTicks: Math.ceil((1 - f.progress) / (f.speed / 60))
        }));

    // Helper: find nearest owned planet and distance
    function nearestOwned(planet) {
        let nearest = null, minDist = Infinity;
        for (const mp of myPlanetObjs) {
            const dx = planet.x - mp.x;
            const dy = planet.y - mp.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < minDist) { minDist = dist; nearest = mp; }
        }
        return { id: nearest?.id ?? null, distance: Math.round(minDist) };
    }

    // Neutrals within range of any owned planet
    const neutralsInRange = game.planets
        .filter(p => p.owner === null)
        .map(p => {
            const n = nearestOwned(p);
            return { ...n, pid: p.id, forces: p.forces, production: p.productionRate };
        })
        .filter(p => p.distance <= game.MAX_FORCE_RANGE)
        .map(({ pid, forces, production, id, distance }) => ({
            id: pid,
            forces,
            production,
            nearestMyPlanetId: id,
            distance
        }));

    // Enemy planets within range of any owned planet
    const enemyPlanetsInRange = game.planets
        .filter(p => p.owner !== null && p.owner !== 0)
        .map(p => {
            const n = nearestOwned(p);
            return { ...n, pid: p.id, owner: p.owner, forces: p.forces, production: p.productionRate };
        })
        .filter(p => p.distance <= game.MAX_FORCE_RANGE)
        .map(({ pid, owner, forces, production, id, distance }) => ({
            id: pid,
            owner,
            forces,
            production,
            nearestMyPlanetId: id,
            distance
        }));

    return {
        tick: game.simulationTick ?? 0,
        myPlanets,
        incomingThreats,
        neutralsInRange,
        enemyPlanetsInRange,
        maxForceRange: game.MAX_FORCE_RANGE
    };
}

module.exports = { buildAdvisorSnapshot };
