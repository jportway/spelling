#!/usr/bin/env python3
"""Invent a plausible term's practice, so the analytics can be tested.

There is a chicken and egg problem with a dashboard about a child's progress:
you cannot tell whether it measures progress correctly until you have months
of data, and by then it has already told you things you believed.

So this makes a child up. Her b/d confusion decays on a known curve, her
decision times come down by a known amount, and a handful of words stay
stubborn on purpose. The output is records in exactly the shape js/logbook.js
writes, plus a sidecar of the parameters that generated them - which the test
then checks the analysis recovers. If the engine cannot find a decline that
was put there deliberately, it will not find a real one.

    python3 tools/simulate_logs.py --weeks 10 --out /tmp/fake-logs.json

Nothing here ever goes near the real project. The device ids all start with
"sim_" so a stray file is obvious at a glance.
"""

from __future__ import annotations

import argparse
import json
import math
import random
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

PARTNER = {"b": "d", "d": "b", "p": "q", "q": "p", "n": "m", "m": "n"}
TRICKY = list(PARTNER)

# Where each letter starts and ends up over the simulated term. These are the
# numbers the test holds the analysis to.
TRUTH = {
    #            first-try accuracy at week 0 -> at the end
    "b":        (0.55, 0.88),
    "d":        (0.62, 0.90),
    "p":        (0.70, 0.92),
    "q":        (0.74, 0.93),
    "n":        (0.78, 0.94),
    "m":        (0.82, 0.95),
    "_other":   (0.93, 0.97),
}

# Of the times she is wrong on a tricky letter and the partner is on offer,
# how often the partner is what she grabs. Falls as the shapes settle.
PARTNER_PULL = (0.80, 0.45)

# Median deciding time, in ms, at the start and the end.
PACE = (2100, 1250)

# A few words that never quite stick, whatever week it is.
STUBBORN = ["bandit", "damp", "bump", "queen", "number", "problem"]


def load_words() -> list[str]:
    """The real word list, so the report names words that really come up."""
    text = (ROOT / "data" / "words.js").read_text(encoding="utf-8")
    words: list[str] = []
    for name in ("EVERYDAY", "FAMILIAR"):
        m = re.search(r'SPELLING_WORDS_%s\s*=\s*[`"]([^`"]*)[`"]' % name, text)
        if m:
            words.extend(w for w in m.group(1).split(" ") if w)
    if not words:                       # the format moved; keep going anyway
        words = ["bandit", "damp", "queen", "number", "problem", "pond", "bump"]
    return [w for w in words if 3 <= len(w) <= 8]


def curve(start: float, end: float, t: float) -> float:
    """Learning is fast at first and then flattens, so interpolate on a curve
    rather than a straight line. t runs 0..1 over the whole term."""
    return start + (end - start) * (1 - math.exp(-2.5 * t)) / (1 - math.exp(-2.5))


def pick_holes(rng: random.Random, word: str) -> list[int]:
    """Roughly what js/puzzle.js does: usually one hole, usually a tricky
    letter if the word has one."""
    tricky_at = [i for i, ch in enumerate(word) if ch in PARTNER]
    count = 2 if len(word) >= 6 and rng.random() < 0.1 else 1

    if tricky_at and rng.random() < 0.78:
        holes = [rng.choice(tricky_at)]
    else:
        holes = [rng.randrange(len(word))]

    while len(holes) < count:
        spare = [i for i in range(len(word)) if i not in holes and abs(i - holes[0]) > 1]
        if not spare:
            break
        holes.append(rng.choice(spare))
    return sorted(holes)


def build_pool(rng: random.Random, word: str, holes: list[int]) -> list[str]:
    """The answers, the partner of any tricky answer nine times in ten, and
    decoys up to five or six tiles."""
    pool = {word[h] for h in holes}
    for h in holes:
        partner = PARTNER.get(word[h])
        if partner and rng.random() < 0.9:
            pool.add(partner)

    size = rng.choice([5, 6])
    alphabet = "abcdefghijklmnopqrstuvwxyz"
    while len(pool) < size:
        pool.add(rng.choice(alphabet))

    out = list(pool)
    rng.shuffle(out)
    return out


def attempt_letter(rng: random.Random, want: str, pool: list[str], t: float) -> str:
    """What she puts in, given how far through the term she is."""
    start, end = TRUTH.get(want, TRUTH["_other"])
    if rng.random() < curve(start, end, t):
        return want

    partner = PARTNER.get(want)
    if partner and partner in pool and rng.random() < curve(*PARTNER_PULL, t):
        return partner

    wrong = [c for c in pool if c != want]
    return rng.choice(wrong) if wrong else want


def deciding_ms(rng: random.Random, t: float, correct: bool) -> int:
    """Lognormal-ish: a floor, a typical value that falls over the term, and a
    long tail for the times she wandered off."""
    typical = curve(*PACE, t)
    if not correct:
        typical *= 0.75                 # wrong answers come faster - guessing
    ms = rng.lognormvariate(math.log(typical), 0.45)
    if rng.random() < 0.02:
        ms *= rng.uniform(4, 12)        # distracted
    return int(max(220, min(ms, 90_000)))


def simulate(weeks: int, seed: int) -> tuple[list[dict], dict]:
    rng = random.Random(seed)
    words = load_words()

    records: list[dict] = []
    device = "sim_ipad"
    seq = 0
    # Finish "now" so the report looks current.
    day_ms = 86_400_000
    end_at = 1_760_000_000_000
    start_at = end_at - weeks * 7 * day_ms

    def push(rec: dict, at: int, round_id: str) -> None:
        nonlocal seq
        seq += 1
        rec.update({"d": device, "r": round_id, "t": at, "n": seq})
        records.append(rec)

    rounds = 0
    for week in range(weeks):
        for _ in range(rng.choice([2, 3, 3, 4])):        # rounds this week
            t = (week + rng.random()) / max(1, weeks)
            at = start_at + int((week * 7 + rng.uniform(0, 7)) * day_ms)
            round_id = "r_sim%04d" % rounds
            rounds += 1

            minutes = rng.choice([3, 5, 5, 10])
            push({"k": "round-start", "minutes": minutes, "game": "missing"},
                 at, round_id)

            solved_count = 0
            first_go = 0
            tricky_fixed = 0
            seen: set[str] = set()

            for _ in range(int(minutes * rng.uniform(1.6, 2.6))):
                # Draw from the stubborn handful outright now and then, rather
                # than salting them into eleven thousand others where they
                # would never come up twice.
                word = (rng.choice(STUBBORN) if rng.random() < 0.05
                        else rng.choice(words))
                if word in seen:
                    continue
                seen.add(word)

                holes = pick_holes(rng, word)
                pool = build_pool(rng, word, holes)

                # Stubborn words are simply harder, whatever the week.
                penalty = 0.75 if word in STUBBORN else 1.0

                tries = []
                clean = True
                for hole in holes:
                    want = word[hole]
                    tried: set[str] = set()
                    for _ in range(6):
                        got = attempt_letter(rng, want, pool, t)
                        if penalty < 1 and got == want and rng.random() > penalty:
                            wrong = [c for c in pool if c != want and c not in tried]
                            if wrong:
                                got = rng.choice(wrong)
                        if got in tried:
                            wrong = [c for c in pool if c not in tried]
                            if not wrong:
                                got = want
                            else:
                                got = rng.choice(wrong)
                        tried.add(got)

                        opening = not tries
                        if opening:
                            # The first move waits on the word being read out.
                            ms = int(rng.uniform(1800, 4200)
                                     + deciding_ms(rng, t, got == want) * 0.4)
                        else:
                            ms = deciding_ms(rng, t, got == want)

                        tries.append({"hole": hole, "got": got, "ms": ms})
                        if got != want:
                            clean = False
                        else:
                            break

                at += sum(x["ms"] for x in tries) + 900
                solved = tries[-1]["got"] == word[tries[-1]["hole"]]
                if solved:
                    solved_count += 1
                if solved and clean:
                    first_go += 1
                    if any(word[h] in PARTNER for h in holes):
                        tricky_fixed += 1

                push({
                    "k": "word", "w": word,
                    "g": min(5, max(0, len(word) - 3)),
                    "lv": min(5, week // 2),
                    "h": holes, "p": pool, "tries": tries,
                    "solved": solved, "skipped": not solved,
                    "puffs": 2 if clean else 1,
                }, at, round_id)

            fill = min(100, int(solved_count * rng.uniform(4, 9)))
            push({"k": "round-end", "words": solved_count, "firstGo": first_go,
                  "tricky": tricky_fixed, "fill": fill, "popped": fill >= 100},
                 at, round_id)

    truth = {
        "weeks": weeks,
        "seed": seed,
        "rounds": rounds,
        "letters": {k: {"from": v[0], "to": v[1]} for k, v in TRUTH.items()},
        "partnerPull": {"from": PARTNER_PULL[0], "to": PARTNER_PULL[1]},
        "pace": {"from": PACE[0], "to": PACE[1]},
        "stubborn": STUBBORN,
        "note": "Invented data. Every device id starts with sim_.",
    }
    return records, truth


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--weeks", type=int, default=10)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--out", default="/tmp/fake-logs.json")
    ap.add_argument("--truth", default="")
    args = ap.parse_args()

    records, truth = simulate(args.weeks, args.seed)

    Path(args.out).write_text(json.dumps(records), encoding="utf-8")
    if args.truth:
        Path(args.truth).write_text(json.dumps(truth, indent=1), encoding="utf-8")

    words = sum(1 for r in records if r["k"] == "word")
    tries = sum(len(r.get("tries", [])) for r in records)
    print("%d records: %d rounds, %d words, %d attempts -> %s"
          % (len(records), truth["rounds"], words, tries, args.out))


if __name__ == "__main__":
    main()
