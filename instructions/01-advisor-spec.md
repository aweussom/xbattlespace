# XBattle LLM Strategic Advisor Spec

## Overview

The advisor is called every ~180 ticks during headless simulation.
It receives a compact game state snapshot and returns a single tactical decision.
The JS bot executes the decision at tick level; the LLM only sets strategic priority.

## System Prompt

```
You are a tactical advisor for a Galcon-style real-time strategy game.
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
- Omit unused fields

EXAMPLES:
State: planet 3 has 12 forces, draining via route to planet 7, enemy sending 18 forces ETA 40 ticks
Response: {"action":"cancel_route","planet":3}

State: planet 3 has 45 forces, enemy planet 6 has 8 forces, distance within range
Response: {"action":"attack","from":3,"to":6}

State: planet 2 has 38 forces, neutral planet 9 has 6 forces, no threats
Response: {"action":"expand","from":2,"to":9}

State: planet 5 has 8 forces, no route, planet 1 has 60 forces, enemy nearby
Response: {"action":"consolidate","from":5,"to":1}
```

## Actions

| Action         | Required fields | Effect                                      |
|----------------|-----------------|---------------------------------------------|
| `expand`       | `from`, `to`    | Send forces to neutral planet               |
| `attack`       | `from`, `to`    | Send forces to enemy planet                 |
| `consolidate`  | `from`, `to`    | Send forces to own planet                   |
| `set_route`    | `from`, `to`    | Establish persistent auto-send route        |
| `cancel_route` | `planet`        | Delete route on owned planet (defense mode) |

## Advisory Interval

Every ~180 ticks (≈3 game-seconds at 60fps), not wall-clock time.

## Defense Logic

The advisor handles defense primarily through `cancel_route` and `consolidate`:

1. **Incoming threat detected** → cancel any route draining the threatened planet
2. **Threatened planet too weak** → consolidate forces from nearby owned planets
3. **Multiple threats** → prioritize defending high-production planets
4. **Lost cause** → if planet cannot be saved, consolidate away from it instead

The `incomingThreats` array in the snapshot provides all the data needed:
- `targetId`: which of your planets is targeted
- `amount`: how many enemy forces incoming
- `etaTicks`: how soon they arrive
- Compare `amount` vs `planet.forces + (production * etaTicks / 60)` to decide if defensible

## Model Configuration

- **Model:** `qwen3:4b` via Ollama
- **max_tokens:** 32 (responses are tiny JSON)
- **temperature:** 0 (deterministic for reproducible simulations)
- **Endpoint:** `http://localhost:11434/v1/chat/completions`

## Fallback Behavior

If the LLM returns invalid JSON or a decision that fails validation:
- Log the bad decision for debugging
- Fall back to the JS bot's default heuristic for that tick
- Do NOT retry the LLM call — keep simulation moving
