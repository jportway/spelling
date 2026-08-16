#!/usr/bin/env python3
"""Grade every word by how hard it is for a child to spell and to know.

Two questions, scored separately and then added up.

**Can she work the spelling out?** English mostly rewards sounding a word
out, and where it does not, it is because letters are silent, or a grapheme
is doing something unusual, or an unstressed vowel has collapsed into a
schwa that could be spelled with any vowel at all. Comparing the letters
against a pronunciation dictionary finds all three: `coup` is four letters
and two sounds, and the p is simply not there.

**Does she know the word?** Frequency data is built from adult writing, so
it is a poor guide on its own - it thinks `coup` is more familiar than
`hamster`. Age-of-acquisition ratings are the right measurement where they
exist, and a hand-written list of ordinary childhood vocabulary covers the
rest.

Nothing here runs in the browser. The grades are baked into data/words.js at
build time, one digit per word.

Needs `pip install cmudict`.
"""

from __future__ import annotations

import re
from functools import lru_cache
from pathlib import Path

try:
    import cmudict
except ImportError:  # pragma: no cover
    cmudict = None

HERE = Path(__file__).resolve().parent
AOA_PATH = HERE / "aoa.txt"
KID_WORDS_PATH = HERE / "kid_words.txt"

# --------------------------------------------------------------------------
# spelling
# --------------------------------------------------------------------------

# Multi-letter spellings a child is taught as a single unit. Each one accounts
# for (length - 1) letters that would otherwise look like spares.
GRAPHEMES = sorted([
    "ough", "augh", "eigh", "igh", "tch", "dge", "air", "ear", "are", "ure",
    "sh", "ch", "th", "ph", "wh", "ck", "ng", "qu", "ss", "ll", "ff", "zz",
    "ee", "oo", "ea", "ai", "ay", "oa", "ow", "oi", "oy", "ou", "ue", "ew",
    "au", "aw", "ie", "oe", "ei", "ar", "or", "er", "ir", "ur",
    "gh", "ce", "ge",
], key=len, reverse=True)

# Credited only where they actually occur. "ps" begins psalm; it does not sit
# in the middle of corps quietly explaining away two letters.
INITIAL_ONLY = ("kn", "wr", "gn", "ps", "rh")
FINAL_ONLY = ("mb",)

VOWEL_LETTERS = set("aeiouy")

# Endings that are a consonant on paper and part of the vowel in the mouth.
# Without these, window and water look like they end in a silent letter.
VOWEL_ENDINGS = ("ow", "ew", "aw", "ay", "oy", "er", "or", "ar", "ir", "ur",
                 "ey", "uy", "eer", "ier", "our", "yr")

HARD_PATTERNS = [
    (re.compile(r"ough"), 3.0, "ough"),
    (re.compile(r"augh"), 2.6, "augh"),
    (re.compile(r"eigh"), 2.4, "eigh"),
    (re.compile(r"^(kn|gn|wr|ps|pn|rh)"), 2.2, "silent start"),
    (re.compile(r"(mb|mn|bt|lm)$"), 2.2, "silent end"),
    (re.compile(r"ph"), 1.2, "ph"),
    (re.compile(r"sc[ei]"), 1.5, "sc"),
    (re.compile(r"(tion|sion|cious|tious|tial|cial)$"), 1.5, "-tion"),
    (re.compile(r"ture$"), 1.0, "-ture"),
    (re.compile(r"(que|gue)$"), 1.4, "-que"),
    (re.compile(r"(ei|ie)"), 0.7, "ei/ie"),
    (re.compile(r"([bcdfgklmnprstvz])\1"), 0.5, "double letter"),
]

# Words English teaches by sight because sounding them out fails, largely the
# UK national curriculum "common exception words". She will know them - they
# are just not workable-out, so they cost a little rather than a lot.
EXCEPTION_WORDS = set("""
the a do to today of said says are were was is his has you your they be he
me she we no go so by my here there where love come some one once ask friend
school put push pull full house our out water again any many who whole which
people busy pretty beautiful after fast last past father class grass pass
plant path bath hour move prove improve sure sugar eye could should would
half money great break steak clothes because behind both child children climb
every everybody even door floor poor find kind mind gold hold told most only
parents whose two four eight world work word warm above other mother brother
another young touch enough couple trouble double
""".split())

SCHWA = ("AH0", "IH0")

# Turning a British spelling back into the American one CMUdict will know.
# The two sound the same, which is the entire point of using it.
AMERICAN_RULES = [
    ("isation", "ization"), ("isations", "izations"),
    ("ising", "izing"), ("ised", "ized"), ("ises", "izes"), ("ise", "ize"),
    ("ysing", "yzing"), ("ysed", "yzed"), ("yse", "yze"),
    ("ours", "ors"), ("our", "or"),
    ("res", "ers"), ("re", "er"),
    ("ence", "ense"), ("ences", "enses"),
    ("ogue", "og"), ("ogues", "ogs"),
    ("lled", "led"), ("lling", "ling"), ("ller", "ler"),
]


def american_spellings(word: str) -> list[str]:
    """Plausible American spellings of a British word, longest rule first.
    Wrong guesses are harmless: they simply will not be in CMUdict either."""
    out = []
    for british, american in AMERICAN_RULES:
        if word.endswith(british) and len(word) - len(british) >= 3:
            out.append(word[: -len(british)] + american)
    # favourite -> favorite, colourful -> colorful: our -> or in the middle.
    if "our" in word[:-1]:
        out.append(word.replace("our", "or", 1))
    return out


class Grader:
    def __init__(self) -> None:
        self.cmu = cmudict.dict() if cmudict else {}
        self.aoa = self._load_aoa()
        self.kid_words = self._load_kid_words()

    # ---------------------------------------------------------------- data

    @staticmethod
    def _load_aoa() -> dict[str, float]:
        ages: dict[str, float] = {}
        if not AOA_PATH.exists():
            return ages
        for line in AOA_PATH.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            parts = line.split()
            if len(parts) != 2:
                continue
            try:
                ages[parts[0]] = float(parts[1])
            except ValueError:
                continue
        return ages

    @staticmethod
    def _load_kid_words() -> set[str]:
        words: set[str] = set()
        if not KID_WORDS_PATH.exists():
            return words
        for line in KID_WORDS_PATH.read_text(encoding="utf-8").splitlines():
            line = line.split("#", 1)[0].strip().lower()
            words.update(w for w in line.split() if w.isalpha())
        return words

    # ------------------------------------------------------------- sounds

    @lru_cache(maxsize=None)
    def phones(self, word: str) -> tuple[str, ...] | None:
        got = self.cmu.get(word)

        # CMUdict is American, so it has never heard of "colour", "centre" or
        # "realise". Without this every British spelling in the list would be
        # marked unpronounceable and graded as if it were an obscure word -
        # which would quietly push the correct spellings out of a game built
        # for a British child.
        if not got:
            for american in american_spellings(word):
                got = self.cmu.get(american)
                if got:
                    break
        if not got:
            return None

        # The shortest pronunciation is the most reduced, and the most
        # revealing: silent letters show up as sounds that are simply absent.
        return tuple(min(got, key=len))

    @staticmethod
    def grapheme_credit(word: str) -> int:
        i = credit = 0
        while i < len(word):
            for g in GRAPHEMES:
                if word.startswith(g, i):
                    credit += len(g) - 1
                    i += len(g)
                    break
            else:
                hit = None
                if i == 0:
                    hit = next((g for g in INITIAL_ONLY if word.startswith(g)), None)
                if hit is None and i == len(word) - 2:
                    hit = next((g for g in FINAL_ONLY if word.endswith(g)), None)
                if hit:
                    credit += len(hit) - 1
                    i += len(hit)
                else:
                    i += 1
        return credit

    def spelling_difficulty(self, word: str) -> tuple[float, list[str]]:
        """0 means it sounds out cleanly. Above about 3 it cannot be reasoned
        out at all, only memorised."""
        ph = self.phones(word)
        why: list[str] = []

        if ph is None:
            # No pronunciation to check against. Guess from the shape of the
            # word and lean pessimistic - an unknown word is not one to put in
            # front of her as an easy win.
            vowels = sum(1 for c in word if c in VOWEL_LETTERS)
            score = 1.5 + max(0, len(word) - 6) * 0.3
            if vowels == 0 or vowels > len(word) - vowels:
                score += 0.5
            return score, ["no pronunciation on file"]

        score = 0.0
        silent_e = 1 if word.endswith("e") and not word.endswith(("ee", "oe", "ie")) else 0
        excess = len(word) - len(ph) - self.grapheme_credit(word) - silent_e
        if excess > 0:
            score += 1.3 * excess
            why.append(f"{excess} letter{'s' if excess > 1 else ''} not sounded")

        # A consonant on the end that is not said at all. This is the trap
        # that put "coup" in front of her: she hears "coo" and there is no way
        # to reason her way to a p.
        if (word[-1] not in VOWEL_LETTERS
                and not word.endswith(VOWEL_ENDINGS)
                and ph[-1][-1].isdigit()):
            score += 2.8
            why.append("silent last letter")

        if "ch" in word and "CH" not in ph and "K" in ph:
            score += 1.4
            why.append("ch says k")

        for pattern, cost, label in HARD_PATTERNS:
            if pattern.search(word):
                score += cost
                why.append(label)

        # An unstressed vowel collapses to a schwa, and a schwa can be spelled
        # with any vowel letter going - the seperate/separate trap. An "er" on
        # the end is not one of these: that is simply how er is spelled.
        schwas = sum(1 for i, p in enumerate(ph)
                     if p in SCHWA or (p == "ER0" and i < len(ph) - 1))
        if schwas:
            score += 0.8 * schwas
            why.append(f"{schwas} schwa{'s' if schwas > 1 else ''}")

        if word in EXCEPTION_WORDS:
            score += 1.0
            why.append("exception word")

        return score, why

    # -------------------------------------------------------- familiarity

    def syllables(self, word: str) -> int:
        ph = self.phones(word)
        if ph is None:
            return max(1, sum(1 for c in word if c in VOWEL_LETTERS))
        return max(1, sum(1 for p in ph if p[-1].isdigit()))

    def unfamiliarity(self, word: str, zipf: float, tier: int,
                      concrete_rank: int | None, has_definition: bool,
                      corpus_tags: int = 0) -> tuple[float, list[str]]:
        """0 means she certainly knows it."""
        why: list[str] = []

        # Frequency counted from adult writing. Useful, but on its own it
        # thinks "coup" is a more familiar word than "hamster".
        zipf_penalty = max(0.0, (4.6 - zipf) * 1.0)

        if word in self.kid_words:
            # Nothing below applies. A word on that list is one she uses.
            return 0.0, ["childhood word"]

        if word in self.aoa:
            age = self.aoa[word]
            age_penalty = max(0.0, (age - 5.0) * 0.55)
            score = 0.65 * age_penalty + 0.35 * zipf_penalty
            why.append(f"learned at {age:.1f}")
        else:
            score = zipf_penalty
            why.append(f"zipf {zipf:.2f}")

        # How often the word turned up in its dictionary sense in a
        # hand-tagged corpus. This is what separates "ben" from "bed": both
        # look common to a frequency counter, because the counter is also
        # counting every Ben who ever got written about. Only one of them is
        # a word anybody uses to mean a thing.
        if corpus_tags == 0:
            score += 1.1
            why.append("never tagged in a corpus")
        elif corpus_tags < 5:
            score += 0.4

        # The familiarity tier the dictionary build already sorted this word
        # into. It is the single most reliable signal there is that a word
        # belongs to the long tail rather than to ordinary speech, and without
        # it "embargo" and "triad" come out looking easy.
        score += (0.0, 0.7, 1.8)[max(0, min(2, tier))]

        extra = self.syllables(word) - 2
        if extra > 0:
            score += 0.5 * extra
            why.append(f"{extra + 2} syllables")

        if len(word) > 7:
            score += 0.3 * (len(word) - 7)

        if not has_definition:
            score += 0.8
            why.append("no meaning to read out")

        # Abstract words are harder to picture and harder to explain. The rank
        # comes from WordNet's own subject files; 0 is a concrete thing.
        if concrete_rank is not None and concrete_rank >= 3:
            score += 0.7
            why.append("abstract")

        return score, why

    # -------------------------------------------------------------- grade

    def grade(self, word: str, zipf: float, tier: int = 0,
              concrete_rank: int | None = None, has_definition: bool = True,
              corpus_tags: int = 0) -> tuple[int, dict]:
        """0 is easiest, 5 hardest. Grades 4 and 5 never reach the
        missing-letters game."""
        spell, spell_why = self.spelling_difficulty(word)
        unknown, fam_why = self.unfamiliarity(word, zipf, tier, concrete_rank,
                                              has_definition, corpus_tags)
        total = spell + 0.9 * unknown

        for grade, limit in enumerate((0.9, 2.0, 3.2, 4.6, 6.4)):
            if total <= limit:
                break
        else:
            grade = 5

        # A word the game cannot explain has no business being one of the
        # easy ones: the meaning being read out is half of what makes a
        # puzzle answerable.
        if not has_definition:
            grade = max(grade, 2)

        return grade, {
            "spelling": round(spell, 2),
            "unfamiliar": round(unknown, 2),
            "total": round(total, 2),
            "why": spell_why + fam_why,
        }
