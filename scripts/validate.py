"""Check football state and source integrity of the generated demo stream."""
import json
from pathlib import Path

DATA = Path(__file__).resolve().parents[1] / "data" / "match.json"


def validate(match):
    errors = []
    teams = match["teams"]
    score = {team: 0 for team in teams}
    possession = None
    active = {team: set(info["starters"]) for team, info in teams.items()}
    seen = set()
    last_time = -1
    last_kind = None
    last_team = None
    for event in match["events"]:
        eid = event["event_id"]
        kind = event["event_type"]
        team = event["team_id"]
        player = event["player_id"]
        recipient = event["recipient_id"]
        t = event["match_clock_ms"]
        if eid in seen:
            errors.append(f"{eid}: duplicate ID")
        if t <= last_time:
            errors.append(f"{eid}: time is not increasing")
        if event["source"] != "synthetic":
            errors.append(f"{eid}: non-synthetic source")
        if team not in teams or player not in teams.get(team, {}).get("players", {}):
            errors.append(f"{eid}: unknown team/player")
        if recipient and recipient not in teams.get(team, {}).get("players", {}):
            errors.append(f"{eid}: unknown recipient")
        if player not in active.get(team, set()):
            errors.append(f"{eid}: inactive player used")
        if recipient and kind != "substitution" and recipient not in active.get(team, set()):
            errors.append(f"{eid}: recipient is inactive")
        for xy in (event["start_xy"], event["end_xy"]):
            if len(xy) != 2 or not 0 <= xy[0] <= 105 or not 0 <= xy[1] <= 68:
                errors.append(f"{eid}: coordinate outside pitch")
        if kind == "substitution":
            if recipient in active[team] or recipient == player:
                errors.append(f"{eid}: invalid incoming player")
            active[team].remove(player)
            active[team].add(recipient)
        if kind in {"kickoff", "restart", "tackle", "interception", "save"}:
            possession = team
        elif kind == "goal":
            if last_kind != "shot" or last_team != team:
                errors.append(f"{eid}: goal without same-team shot")
            score[team] += 1
            possession = next(x for x in teams if x != team)
        elif kind in {"pass", "shot"}:
            if possession != team:
                errors.append(f"{eid}: action by team without possession")
            possession = team
        elif kind == "pressure":
            if possession == team:
                errors.append(f"{eid}: pressure by team in possession")
        else:
            if kind != "substitution":
                errors.append(f"{eid}: unknown event type")
        if event["possession_team"] != possession:
            errors.append(f"{eid}: possession mismatch")
        if event["score_after"] != [score["harbour"], score["ridge"]]:
            errors.append(f"{eid}: score mismatch")
        if any(ref not in seen for ref in event["related_event_ids"]):
            errors.append(f"{eid}: invalid evidence reference")
        seen.add(eid)
        last_time, last_kind, last_team = t, kind, team
    return errors


if __name__ == "__main__":
    match = json.loads(DATA.read_text(encoding="utf-8"))
    problems = validate(match)
    if problems:
        raise SystemExit("\n".join(problems))
    print(f"Validated {len(match['events'])} synthetic events in {len(match['scenes'])} scenes; final score {match['events'][-1]['score_after']}.")
