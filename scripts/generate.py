"""Generate a small, reproducible, entirely fictional football event stream."""
import json
import random
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "match.json"
SEED = 20261025

TEAMS = {
    "harbour": {"name": "Harbour FC", "starters": ["h1", "h2", "h3", "h4", "h5"], "players": {
        "h1": "Mara Vale", "h2": "Ari Bell", "h3": "Noor Finch",
        "h4": "Jules Rowan", "h5": "Tess Calder", "h6": "Eli Shore",
    }},
    "ridge": {"name": "Ridge United", "starters": ["r1", "r2", "r3", "r4", "r5"], "players": {
        "r1": "Pax Reed", "r2": "Lena Moss", "r3": "Sam Kestrel",
        "r4": "Ivo Marsh", "r5": "Rae Solis", "r6": "Kit Hollis",
    }},
}

# Each scenario is an authored football situation. The program supplies stable
# timing, position variation, state transitions and the final event records.
# Coordinates are metres on a 105 x 68 pitch; Harbour attacks toward x=105.
SCENARIOS = [
    ("wing_build", 6 * 60, "Wing build-up and a first goal", [
        ("restart", "harbour", "h1", None, (52,34), (52,34)),
        ("pass", "harbour", "h1", "h2", (48,32), (61,20)),
        ("pass", "harbour", "h2", "h3", (61,20), (71,11)),
        ("pressure", "ridge", "r2", None, (72,12), (72,12)),
        ("pass", "harbour", "h3", "h4", (71,11), (82,28)),
        ("interception", "ridge", "r3", None, (82,28), (80,30)),
        ("pass", "ridge", "r3", "r1", (80,30), (61,35)),
        ("pass", "ridge", "r1", "r4", (61,35), (34,29)),
        ("shot", "ridge", "r4", None, (25,30), (0,34)),
        ("save", "harbour", "h5", None, (3,34), (8,35)),
        ("pass", "harbour", "h5", "h2", (8,35), (35,42)),
        ("pass", "harbour", "h2", "h3", (35,42), (68,15)),
        ("pass", "harbour", "h3", "h4", (68,15), (88,30)),
        ("shot", "harbour", "h4", None, (88,30), (105,34)),
        ("goal", "harbour", "h4", None, (88,30), (105,34)),
    ]),
    ("counter", 51 * 60, "Pressure, turnover and counterattack", [
        ("restart", "ridge", "r1", None, (52,34), (52,34)),
        ("pass", "ridge", "r1", "r2", (54,34), (44,19)),
        ("pass", "ridge", "r2", "r3", (44,19), (36,32)),
        ("pressure", "harbour", "h1", None, (35,31), (35,31)),
        ("tackle", "harbour", "h1", None, (35,31), (37,31)),
        ("pass", "harbour", "h1", "h2", (37,31), (58,20)),
        ("pass", "harbour", "h2", "h4", (58,20), (82,29)),
        ("shot", "harbour", "h4", None, (85,30), (105,35)),
        ("save", "ridge", "r5", None, (102,35), (96,34)),
        ("pass", "ridge", "r5", "r3", (96,34), (75,43)),
        ("pass", "ridge", "r3", "r4", (75,43), (43,40)),
        ("shot", "ridge", "r4", None, (24,40), (0,34)),
        ("goal", "ridge", "r4", None, (24,40), (0,34)),
        ("restart", "harbour", "h1", None, (52,34), (52,34)),
        ("pass", "harbour", "h1", "h3", (52,34), (65,20)),
    ]),
    ("late_change", 80 * 60, "Late substitution and deciding goal", [
        ("kickoff", "harbour", "h1", None, (52,34), (52,34)),
        ("substitution", "harbour", "h3", "h6", (52,34), (52,34)),
        ("pass", "harbour", "h1", "h2", (52,34), (63,45)),
        ("pass", "harbour", "h2", "h6", (63,45), (75,18)),
        ("pressure", "ridge", "r2", None, (75,18), (75,18)),
        ("pass", "harbour", "h6", "h4", (75,18), (87,33)),
        ("shot", "harbour", "h4", None, (88,33), (105,34)),
        ("save", "ridge", "r5", None, (102,34), (95,33)),
        ("pass", "ridge", "r5", "r1", (95,33), (70,36)),
        ("interception", "harbour", "h6", None, (70,36), (71,34)),
        ("pass", "harbour", "h6", "h2", (71,34), (83,42)),
        ("pass", "harbour", "h2", "h4", (83,42), (92,31)),
        ("shot", "harbour", "h4", None, (92,31), (105,34)),
        ("goal", "harbour", "h4", None, (92,31), (105,34)),
        ("kickoff", "ridge", "r1", None, (52,34), (52,34)),
    ]),
]


def generate():
    rng = random.Random(SEED)
    score = {team: 0 for team in TEAMS}
    possession = None
    events = []
    for scene_id, start, title, actions in SCENARIOS:
        current = start
        for kind, team, player, recipient, start_xy, end_xy in actions:
            if events and events[-1]["scene_id"] == scene_id:
                current += rng.randint(11, 17)
            if kind in {"kickoff", "restart", "tackle", "interception", "save"}:
                possession = team
            elif kind == "goal":
                score[team] += 1
                possession = next(t for t in TEAMS if t != team)
            elif kind in {"pass", "shot"}:
                possession = team
            # Pressure and substitution do not move the ball.
            number = len(events) + 1
            events.append({
                "event_id": f"E{number:03d}", "match_id": "fictional-001",
                "scene_id": scene_id, "period": 1 if current < 45 * 60 else 2,
                "match_clock_ms": current * 1000, "event_type": kind,
                "team_id": team, "player_id": player, "recipient_id": recipient,
                "start_xy": list(start_xy), "end_xy": list(end_xy),
                "outcome": "complete" if kind == "pass" else "occurred",
                "score_after": [score["harbour"], score["ridge"]],
                "possession_team": possession,
                "related_event_ids": [events[-1]["event_id"]] if events and kind in {"goal", "save"} else [],
                "source": "synthetic", "generation_seed": SEED,
            })
    return {"schema_version": 1, "match_id": "fictional-001", "pitch_m": [105, 68],
            "teams": TEAMS,
            "scenes": [{"id": s[0], "title": s[2], "start_ms": s[1] * 1000} for s in SCENARIOS],
            "events": events,
            "provenance": "Fictional teams and players; AI-authored scenario outlines, deterministic program-generated events. No real match data."}


if __name__ == "__main__":
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(generate(), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Generated {OUT} ({len(generate()['events'])} events, seed {SEED})")
