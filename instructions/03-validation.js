// Advisor decision validation — run before applying any LLM decision
// If validation fails, fall back to JS bot heuristic. Do not retry LLM.

function validateDecision(decision, gameState) {
    if (!decision || typeof decision.action !== 'string') return false;

    const myIds = new Set(gameState.myPlanets.map(p => p.id));
    const allIds = new Set([
        ...gameState.myPlanets,
        ...gameState.neutralsInRange,
        ...gameState.enemyPlanetsInRange
    ].map(p => p.id));

    switch (decision.action) {
        case 'cancel_route':
            return typeof decision.planet === 'number'
                && myIds.has(decision.planet);

        case 'expand':
            return typeof decision.from === 'number'
                && typeof decision.to === 'number'
                && myIds.has(decision.from)
                && gameState.neutralsInRange.some(p => p.id === decision.to);

        case 'attack':
            return typeof decision.from === 'number'
                && typeof decision.to === 'number'
                && myIds.has(decision.from)
                && gameState.enemyPlanetsInRange.some(p => p.id === decision.to);

        case 'consolidate':
            return typeof decision.from === 'number'
                && typeof decision.to === 'number'
                && myIds.has(decision.from)
                && myIds.has(decision.to)
                && decision.from !== decision.to;

        case 'set_route':
            return typeof decision.from === 'number'
                && typeof decision.to === 'number'
                && myIds.has(decision.from)
                && allIds.has(decision.to)
                && decision.from !== decision.to;

        default:
            return false;
    }
}

module.exports = { validateDecision };
