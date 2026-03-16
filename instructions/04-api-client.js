// Ollama API client for the LLM strategic advisor
// Calls qwen3:4b locally via the OpenAI-compatible endpoint

const { validateDecision } = require('./03-validation');

const ADVISOR_SYSTEM_PROMPT = `You are a tactical advisor for a Galcon-style real-time strategy game.
Players capture planets and send forces between them. Planets produce forces over time.

Your job: given the current game state, return ONE tactical decision.

RULES:
- You can only act on planets owned by player 0 (you)
- cancel_route: stop draining a planet so it can build defenses
- set_route: establish persistent auto-send from one of your planets to a target
- attack: send forces from your planet to an enemy planet (only if forces > enemy forces * attackRatio)
- expand: send forces to a neutral (unowned) planet
- consolidate: send forces from a weak owned planet to a stronger owned planet

PRIORITIES (in order):
1. Cancel routes on planets with incoming threats you cannot survive
2. Attack enemy planets when you have clear force advantage
3. Expand to neutral planets within range
4. Consolidate forces toward the front line
5. Set new routes only when surplus is high and no threats exist

RESPOND WITH ONLY VALID JSON. No explanation. No markdown. No extra fields.
Format: {"action":"expand"|"attack"|"consolidate"|"cancel_route"|"set_route","from":id,"to":id,"planet":id}
- Use "from" and "to" for: expand, attack, consolidate, set_route
- Use "planet" for: cancel_route
- Omit unused fields`;

const OLLAMA_URL = 'http://localhost:11434/v1/chat/completions';
const MODEL = 'qwen3:4b';

async function queryAdvisor(gameState) {
    try {
        const response = await fetch(OLLAMA_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: MODEL,
                max_tokens: 32,
                temperature: 0,
                messages: [
                    { role: 'system', content: ADVISOR_SYSTEM_PROMPT },
                    { role: 'user', content: JSON.stringify(gameState) }
                ]
            })
        });

        const data = await response.json();
        const raw = data.choices[0].message.content.trim();

        // Strip markdown fencing if model wraps response
        const cleaned = raw.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');

        const decision = JSON.parse(cleaned);
        if (validateDecision(decision, gameState)) {
            return decision;
        }

        console.warn('[ADVISOR] Invalid decision:', decision);
        return null;
    } catch (err) {
        console.warn('[ADVISOR] Error:', err.message);
        return null; // malformed JSON or network error → fallback to JS heuristic
    }
}

module.exports = { queryAdvisor, ADVISOR_SYSTEM_PROMPT, OLLAMA_URL, MODEL };
