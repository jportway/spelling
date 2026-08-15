#!/usr/bin/env python3
"""Build the offline dictionary bundle used by the spelling game.

The game has to work with no network at all (it is opened straight from disk),
so every word and every definition is baked into a single JavaScript file.

Sources
  * word-list (npm)      - 274k English words, including inflected forms.
  * wordfreq (pypi)      - Zipf frequencies, used to keep the list to words a
                           child could plausibly recognise.
  * wordnet-db (npm)     - WordNet 3.0, used for the definitions.
  * naughty-words (npm)  - profanity list, used to keep the game clean.

Usage
    pip install wordfreq
    npm install --prefix tools word-list wordnet-db naughty-words
    python3 tools/build_dictionary.py

Output
    data/dictionary.js
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from pathlib import Path

from wordfreq import zipf_frequency

ROOT = Path(__file__).resolve().parent.parent
OUT_PATH = ROOT / "data" / "dictionary.js"
KID_DEFINITIONS = Path(__file__).resolve().parent / "kid_definitions.txt"

# Where the npm packages live. Override with DICT_MODULES if you installed them
# somewhere else.
MODULES = Path(os.environ.get("DICT_MODULES", ROOT / "tools" / "node_modules"))

# A short word is easy to hit by accident, so it has to be common to count.
# A long word is an achievement, so we are more generous.
MIN_ZIPF_BY_LENGTH = {3: 3.15, 4: 2.85, 5: 2.6, 6: 2.55, 7: 2.45, 8: 2.4}

# Two familiarity tiers, used for the end-of-round "you could also have
# made..." list. That list is a teaching moment, so it should be full of words
# like "camel" and not words like "decry".
#
# The boundary at 4.0 does real work: the frequency corpus inflates foreign
# words and place names ("das" 3.73, "ness" 3.60, "milo" 3.56) into the same
# band as genuine but obscure English, while everyday vocabulary ("bed" 5.07,
# "robot" 4.24, "pig" 4.14) sits clearly above it.
EVERYDAY_ZIPF = 4.0
FAMILIAR_ZIPF = 3.35

# Two letter words are mostly Scrabble noise ("aa", "ae", "qi"), so rather than
# take them on frequency we list the real ones by hand.
TWO_LETTER_WORDS = """
    am an as at ax be by do go he hi if in is it me my no of oh ok on or ox
    pi so to up us we
""".split()

# Words a child knows that the frequency cut can drop. Anything here is kept as
# long as it is a real entry in the source word list.
ALWAYS_KEEP = """
    igloo pram burp poo wee yuck yum yummy nan nana gran grandad grandma dino
    dinos welly wellies telly brolly loo mum mummy dad daddy tum tummy piggy
    doggy kitty bunny teddy hippo rhino croc gecko newt tadpole ladybird foal
    conker satsuma jammy fizzy squishy squelch squelchy wobbly wibble giggly
    grumpy sleepy dozy nifty zoomy swirly twirly sparkly glittery
    unicorn mermaid dragon goblin troll pixie fairy wizard witch ogre
    slide swing seesaw skip hopscotch playtime bedtime storytime
    pancake crumpet biscuit lolly ketchup custard gravy pasty
    hoover plaster jumper trainers wellington
""".split()

# On top of the naughty-words list. Kept deliberately broad: this is a game for
# a seven year old, and a word being missing is a non-event while a word being
# present is not.
EXTRA_BLOCKED = """
    ass asses arse arsed bugger buggered bum bums crap crappy damn damned
    darn bloody bollock bollocks blimey git gits knob knobs prat prats
    sod sodded sodding tit tits twat wanker wank pee peed peeing piss pissed
    poop pooped fart farted farting snot snotty bogey bogeys puke puked
    vomit vomited barf barfed
    booze boozy drunk drunken beer beers wine wines vodka whisky whiskey
    rum gin lager cider ale pub pubs bar bars cocktail cocktails
    smoke smokes smoking cigar cigars cigarette fag fags tobacco vape vapes
    drug drugs drugged dope doped weed weeds stoned high heroin cocaine
    gun guns gunman rifle rifles pistol pistols bullet bullets shotgun
    knife knives stab stabbed stabbing blade blades dagger
    kill kills killed killer killing murder murdered murderer slay slain
    death deaths dead die died dying corpse corpses coffin coffins grave
    graves buried burial funeral morgue autopsy suicide
    blood bloody bleed bleeding gore gory wound wounded
    war wars warfare bomb bombs bombed bombing missile missiles
    hate hates hated hatred racist racism sexist sexism
    naked nude nudes nudity sexy sex sexual kiss kissed kissing
    hell heck satan devil demon demons
"""

# ... but a handful of those are ordinary childhood vocabulary and blocking
# them would be silly. These win over EXTRA_BLOCKED.
UNBLOCK = """
    bum kiss kissed kissing high weed weeds bar bars smoke smokes smoking
    blood bleed bleeding wound wounded knife knives blade blades devil
    demon demons dragon war bomb gun die died dead death hate hates hated
    fart farted farting snot snotty puke bogey bogeys
""".split()

# Fragments long and distinctive enough to match anywhere in a word without
# catching something innocent.
BLOCKED_FRAGMENTS = (
    "fuck", "shit", "cunt", "bitch", "penis", "vagina", "nipple",
    "orgasm", "porn", "slut", "whore", "hooker", "nazi",
    "testicle", "scrotum", "condom", "erotic", "fetish",
    "molest", "incest", "pedophil", "paedophil", "genital", "masturbat",
    "prostitut", "faeces", "urinat", "defecat", "sodom", "bestial",
    "lesbian", "homosexual", "transsexual", "cocaine", "methamphet",
    "marijuana",
)

# Short strings that are only a problem as a whole word. Matching these
# anywhere would throw out grape, canal, basement, heroine, scrape and
# therapist, which is exactly the kind of rejection this game must not make.
BLOCKED_WHOLE_WORDS = """
    anal anus rape raped rapes raping rapist rapists boob boobs boobies
    semen sperm sperms feces urine necro erotica heroin heroins
"""

# WordNet groups every sense into a lexicographer file. Where the reference
# corpus never tagged a word (true of most senses), sense order is effectively
# arbitrary, and these ranks break the tie towards the concrete meaning a child
# would picture. Without this, "canal" is defined as a surface feature of Mars.
CONCRETE_FIRST = {
    6: 0,   # artifact  - chairs, canals, kites: things you can point at
    5: 0,   # animal
    13: 0,  # food
    20: 0,  # plant
    15: 1,  # location
    18: 1,  # person
    27: 1,  # substance
    8: 2,   # body
    17: 2,  # object    - includes astronomy, hence "a feature of Mars"
    19: 2,  # phenomenon
    3: 2,   # Tops
    28: 2,  # time
}
ABSTRACT_RANK = 3

POS_FILES = {"noun": "n", "verb": "v", "adj": "a", "adv": "r"}
# WordNet's ss_type digit, as it appears in a sense key. 5 is an adjective
# satellite, which lives in the adjective data file.
SS_TYPE_TO_POS = {"1": "n", "2": "v", "3": "a", "4": "r", "5": "a"}
# Tie-break only, for lemmas that WordNet has never seen tagged in a corpus.
POS_PRIORITY = {"n": 0, "v": 1, "a": 2, "r": 3}

# Definitions are read aloud, so anything matching these is dropped even
# though the word itself stays playable.
GRIM_IN_DEFINITION = (
    "human flesh", "sexual", "sexually", "genital", "corpse", "cadaver",
    "excrement", "urine", "faeces", "feces", "copulat", "intercourse",
    "obscene", "vulgar", "offensive term", "derogatory", "slur",
    "narcotic", "intoxicat", "suicide", "murder", "torture",
    "mutilat", "disembowel", "castrat", "prostitut",
)
# "rape" is deliberately absent above: as a substring it would strip the
# definition of raisin ("dried grape"). BLOCKED_WHOLE_WORDS catches it by
# token instead.


# --------------------------------------------------------------------------
# sources
# --------------------------------------------------------------------------

def load_source_words() -> list[str]:
    path = MODULES / "word-list" / "words.txt"
    if not path.exists():
        sys.exit(f"missing {path}\nRun: npm install --prefix tools word-list")
    with path.open(encoding="utf-8") as handle:
        return [line.strip() for line in handle if line.strip()]


def load_blocklist() -> set[str]:
    blocked: set[str] = set()
    path = MODULES / "naughty-words" / "en.json"
    if path.exists():
        blocked.update(w.strip().lower() for w in json.loads(path.read_text()))
    else:
        print(f"warning: {path} not found, using built-in list only", file=sys.stderr)
    blocked.update(EXTRA_BLOCKED.split())
    blocked.difference_update(UNBLOCK)
    blocked.update(BLOCKED_WHOLE_WORDS.split())
    return blocked


def load_kid_definitions() -> dict[str, str]:
    """Hand-written definitions that beat anything WordNet has to offer."""
    if not KID_DEFINITIONS.exists():
        print(f"warning: {KID_DEFINITIONS} not found", file=sys.stderr)
        return {}

    written: dict[str, str] = {}
    for number, line in enumerate(KID_DEFINITIONS.read_text(encoding="utf-8").splitlines(), 1):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        word, sep, definition = line.partition("=")
        word = word.strip().lower()
        definition = definition.strip()
        if not sep or not word or not definition:
            sys.exit(f"{KID_DEFINITIONS}:{number}: expected 'word = definition'")
        if not word.isalpha():
            sys.exit(f"{KID_DEFINITIONS}:{number}: '{word}' is not a plain word")
        written[word] = definition
    return written


def wordnet_dir() -> Path:
    path = MODULES / "wordnet-db" / "dict"
    if not path.exists():
        sys.exit(f"missing {path}\nRun: npm install --prefix tools wordnet-db")
    return path


# --------------------------------------------------------------------------
# WordNet
# --------------------------------------------------------------------------

def parse_synsets(data_file: Path) -> dict[str, tuple[set[str], str]]:
    """Map synset offset -> (word forms, raw gloss) for one WordNet data file.

    The word forms are kept with their original capitalisation so that proper
    nouns can be spotted later: WordNet stores the jurist Warren `Burger` in
    the same lowercase index as the thing you eat.
    """
    synsets: dict[str, tuple[set[str], str]] = {}
    with data_file.open(encoding="utf-8", errors="replace") as handle:
        for line in handle:
            if line.startswith("  "):  # licence header
                continue
            head, _, gloss = line.partition("|")
            gloss = gloss.strip()
            if not gloss:
                continue
            fields = head.split()
            if len(fields) < 4:
                continue
            offset = fields[0]
            try:
                word_count = int(fields[3], 16)
            except ValueError:
                continue
            # Word/lex_id pairs start at field 4.
            words = {fields[4 + 2 * i] for i in range(word_count)
                     if 4 + 2 * i < len(fields)}
            synsets[offset] = (words, gloss)
    return synsets


def parse_sense_index(index_file: Path) -> dict[tuple[str, str], list[tuple[int, int, int, str]]]:
    """Map (lemma, pos) -> senses as (-tag_count, concreteness, sense_no, offset).

    Sorting that tuple puts the sense people actually use most first, falling
    back to the most concrete one, which is what is worth reading to a child.
    """
    senses: dict[tuple[str, str], list[tuple[int, int, int, str]]] = {}
    with index_file.open(encoding="utf-8", errors="replace") as handle:
        for line in handle:
            fields = line.split()
            if len(fields) < 4:
                continue
            sense_key, offset, sense_number, tag_count = fields[:4]
            lemma, _, rest = sense_key.partition("%")
            pos = SS_TYPE_TO_POS.get(rest[:1])
            if not pos or "_" in lemma or not lemma.isalpha():
                continue
            try:
                lex_file = int(rest[2:4])
                rank = CONCRETE_FIRST.get(lex_file, ABSTRACT_RANK) if pos == "n" else 0
                entry = (-int(tag_count), rank, int(sense_number), offset)
            except ValueError:
                continue
            senses.setdefault((lemma.lower(), pos), []).append(entry)
    return senses


class WordNet:
    """Definition lookup, best sense first, proper nouns skipped."""

    def __init__(self) -> None:
        directory = wordnet_dir()
        self.synsets: dict[str, tuple[set[str], str]] = {}
        for name in POS_FILES:
            self.synsets.update(parse_synsets(directory / f"data.{name}"))
        self.senses = parse_sense_index(directory / "index.sense")
        for entries in self.senses.values():
            entries.sort()

        # The part of speech a lemma is most often used as.
        self.dominant: dict[str, str] = {}
        best_score: dict[str, tuple[int, int]] = {}
        for (lemma, pos), entries in self.senses.items():
            score = (entries[0][0], POS_PRIORITY[pos])
            if lemma not in best_score or score < best_score[lemma]:
                best_score[lemma] = score
                self.dominant[lemma] = pos

        self._cache: dict[tuple[str, str], tuple[str, str] | None] = {}

    def lemmas(self) -> set[str]:
        return set(self.dominant)

    def tag_count(self, lemma: str, pos: str) -> int:
        """How often this lemma+pos was tagged in WordNet's reference corpus."""
        entries = self.senses.get((lemma, pos))
        return -entries[0][0] if entries else 0

    def define(self, lemma: str, prefer: str = "") -> tuple[str, str] | None:
        """Return (pos, definition), preferring `prefer` when that sense exists."""
        key = (lemma, prefer)
        if key in self._cache:
            return self._cache[key]

        order = []
        if prefer and (lemma, prefer) in self.senses:
            order.append(prefer)
        dominant = self.dominant.get(lemma)
        if dominant and dominant not in order:
            order.append(dominant)
        for pos in ("n", "v", "a", "r"):
            if pos not in order and (lemma, pos) in self.senses:
                order.append(pos)

        result = None
        for pos in order:
            for _, _, _, offset in self.senses.get((lemma, pos), ()):
                words, raw = self.synsets.get(offset, (set(), ""))
                # If every form in the synset is capitalised it is a proper
                # noun that merely happens to share this spelling.
                if words and lemma not in {w.lower() for w in words if w.islower()}:
                    continue
                definition = clean_gloss(raw)
                if definition:
                    result = (pos, definition)
                    break
            if result:
                break

        self._cache[key] = result
        return result


PARENTHETICAL = re.compile(r"\([^)]*\)")
WHITESPACE = re.compile(r"\s+")


def clean_gloss(raw: str) -> str:
    """Turn a WordNet gloss into one short sentence that reads aloud well."""
    # Drop the usage examples, which WordNet stores as quoted clauses.
    parts = [p.strip() for p in raw.split(";")]
    parts = [p for p in parts if p and not p.startswith('"')]
    if not parts:
        return ""

    text = parts[0]
    # A first clause like "(of a person)" carries no meaning on its own, so
    # glue the next clause on rather than reading out the fragment.
    if len(parts) > 1 and len(PARENTHETICAL.sub("", text).strip()) < 12:
        text = f"{text}; {parts[1]}"

    text = PARENTHETICAL.sub(" ", text)
    text = text.replace("`", "'").replace("--", " - ")
    text = WHITESPACE.sub(" ", text).strip(" ,;:-")

    if len(text) > 120:
        cut = text.rfind(" ", 0, 120)
        text = text[: cut if cut > 60 else 120].rstrip(" ,;:-")

    # A one word gloss ("bear: Have", "stopped: Blocked") tells a child
    # nothing when read aloud. Rejecting it here makes the caller fall through
    # to the next sense, which is nearly always more useful.
    if len(text) < 8 or " " not in text.strip():
        return ""
    return text[0].upper() + text[1:]


# --------------------------------------------------------------------------
# morphology: find the dictionary form of an inflected word
# --------------------------------------------------------------------------

VOWELS = set("aeiou")


def preferred_pos(word: str) -> str:
    """The part of speech an inflected form implies, so `jumped` reads as a verb."""
    if word.endswith(("ing", "ed")):
        return "v"
    if word.endswith(("er", "est")):
        return "a"
    if word.endswith("ly"):
        return "r"
    return ""


def undoubled_stem(word: str) -> str:
    """`running` -> `run`, `stopped` -> `stop`. Empty when the rule does not apply."""
    for suffix in ("ed", "ing", "er", "est", "y"):
        if word.endswith(suffix):
            stem = word[: -len(suffix)]
            if len(stem) >= 3 and stem[-1] == stem[-2] and stem[-1] not in VOWELS:
                return stem[:-1]
    return ""


def strong_base_candidates(word: str) -> list[str]:
    """Base forms from rules that cannot misfire on an ordinary word.

    `seed` and `bed` look like past tenses to a naive suffix strip, so the
    rules that would produce `see` and `be` are deliberately excluded here.
    """
    out: list[str] = []

    def add(candidate: str) -> None:
        if len(candidate) >= 3 and candidate != word and candidate not in out:
            out.append(candidate)

    stem = undoubled_stem(word)
    if stem:
        add(stem)
    if word.endswith("ies") and len(word) > 4:
        add(word[:-3] + "y")
    if word.endswith("ing"):
        add(word[:-3])
        add(word[:-3] + "e")
    return out


def base_form_candidates(word: str) -> list[str]:
    """Plausible dictionary forms for an inflected word, best guess first."""
    out: list[str] = list(strong_base_candidates(word))

    def add(candidate: str, minimum: int = 3) -> None:
        if len(candidate) >= minimum and candidate != word and candidate not in out:
            out.append(candidate)

    if word.endswith(("ses", "xes", "zes", "ches", "shes")):
        add(word[:-2])
    if word.endswith("s") and not word.endswith("ss"):
        add(word[:-1], minimum=2)
    if word.endswith("es"):
        add(word[:-2], minimum=2)
    if word.endswith("ied") and len(word) > 4:
        add(word[:-3] + "y")
    if word.endswith("ed"):
        add(word[:-2])
        add(word[:-1])
    if word.endswith("er"):
        add(word[:-2])
        add(word[:-1])
    if word.endswith("est"):
        add(word[:-3])
        add(word[:-2])
    if word.endswith("ly"):
        add(word[:-2])
    if word.endswith("iness"):
        add(word[:-5] + "y")
    if word.endswith("ness"):
        add(word[:-4])
    return out


# --------------------------------------------------------------------------
# filtering
# --------------------------------------------------------------------------

# US spellings a frequency cut keeps but whose British twin it can drop. The
# game is for a British child, so "colour" must never be marked wrong.
BRITISH_SUFFIX_RULES = [
    ("ization", "isation"), ("izations", "isations"),
    ("izing", "ising"), ("ized", "ised"), ("izes", "ises"), ("ize", "ise"),
    ("yzing", "ysing"), ("yzed", "ysed"), ("yze", "yse"),
    ("ors", "ours"), ("or", "our"),
    ("ers", "res"), ("er", "re"),
    ("ense", "ence"), ("enses", "ences"),
    ("og", "ogue"), ("ogs", "ogues"),
]

# Not spelling variants but different words entirely.
BRITISH_WORDS = """
    kerb mum mummy nan nana gran cooker cutlery jumper trainers pram pushchair
    nappy nappies dummy plaster hoover telly brolly wellies welly loo bin
    biscuit sweets crisps chips lolly ice-lolly courgette aubergine coriander
    pyjama rocket swede sultana squash lorry motorway pavement zebra roundabout
    postbox postman rubbish rubber maths football rounders playtime
"""


def british_variants(word: str) -> list[str]:
    """British spellings of an American word, by the regular rules."""
    out = []
    for american, british in BRITISH_SUFFIX_RULES:
        if word.endswith(american) and len(word) - len(american) >= 3:
            out.append(word[: -len(american)] + british)
            break

    # traveled -> travelled, modeling -> modelling, jeweler -> jeweller.
    match = re.fullmatch(r"(.*[aeiou])l(ed|ing|er|ers|est)", word)
    if match:
        out.append(match.group(1) + "ll" + match.group(2))

    return out


def is_clean(word: str, blocked: set[str]) -> bool:
    if word in UNBLOCK:
        return True
    if word in blocked:
        return False
    return not any(fragment in word for fragment in BLOCKED_FRAGMENTS)


def definition_is_clean(definition: str, blocked: set[str]) -> bool:
    lowered = definition.lower()
    if any(fragment in lowered for fragment in BLOCKED_FRAGMENTS + GRIM_IN_DEFINITION):
        return False
    # Whole-word matching here too, so "dried grape" survives.
    tokens = set(re.findall(r"[a-z]+", lowered))
    return not (tokens & blocked)


def resolve_definition(
    word: str, wordnet: WordNet, written: dict[str, str]
) -> tuple[str, str, str]:
    """Return (pos, base_word, definition) for a word, or empty strings."""
    if word in written:
        return "", "", written[word]

    own = wordnet.define(word)

    # An -ing/-ed form that also happens to be a noun in its own right
    # (`running` is a play in American football) is nearly always meant as the
    # verb, so take the base verb when the corpus says that sense is commoner.
    if word.endswith(("ing", "ed")):
        for candidate in strong_base_candidates(word):
            verb = wordnet.define(candidate, "v")
            if verb and verb[0] == "v":
                own_count = wordnet.tag_count(word, own[0]) if own else -1
                if wordnet.tag_count(candidate, "v") >= own_count:
                    return "v", candidate, verb[1]
                break

    if own:
        return own[0], "", own[1]

    prefer = preferred_pos(word)
    for candidate in base_form_candidates(word):
        # A hand-written definition of the root beats WordNet on the root too:
        # "kittens" should explain itself as "a baby cat".
        if candidate in written:
            return "", candidate, written[candidate]
        found = wordnet.define(candidate, prefer)
        if found:
            return found[0], candidate, found[1]
    return "", "", ""


def keeps_word(word: str, zipf: float) -> bool:
    length = len(word)
    if length == 2:
        return word in TWO_LETTER_WORDS
    threshold = MIN_ZIPF_BY_LENGTH.get(length)
    return threshold is not None and zipf >= threshold


# --------------------------------------------------------------------------
# build
# --------------------------------------------------------------------------

def build() -> None:
    print("loading sources...")
    source = load_source_words()
    blocked = load_blocklist()
    written = load_kid_definitions()
    wordnet = WordNet()
    print(f"  {len(source)} source words, {len(wordnet.lemmas())} WordNet lemmas")
    print(f"  {len(written)} hand-written definitions")

    valid_shape = re.compile(r"[a-z]{2,8}")
    source_set = {w for w in source if valid_shape.fullmatch(w)}

    selected: set[str] = set()
    for word in source_set:
        if not is_clean(word, blocked):
            continue
        if keeps_word(word, zipf_frequency(word, "en")):
            selected.add(word)

    for word in TWO_LETTER_WORDS:
        if is_clean(word, blocked):
            selected.add(word)
    for word in list(ALWAYS_KEEP) + BRITISH_WORDS.split():
        if word in source_set and is_clean(word, blocked):
            selected.add(word)

    # Whenever an American spelling made the cut, make sure its British twin
    # did too. A child in Britain writing "colour" has spelled it correctly.
    recovered = 0
    for word in sorted(selected):
        for variant in british_variants(word):
            if (
                variant not in selected
                and variant in source_set
                and is_clean(variant, blocked)
            ):
                selected.add(variant)
                recovered += 1
    print(f"  {recovered} British spellings recovered")

    print(f"  {len(selected)} words kept")

    everyday = []
    familiar = []
    for word in sorted(selected):
        if len(word) < 3:
            continue
        zipf = zipf_frequency(word, "en")
        if zipf >= EVERYDAY_ZIPF:
            everyday.append(word)
        elif zipf >= FAMILIAR_ZIPF:
            familiar.append(word)
    print(f"  {len(everyday)} everyday, {len(familiar)} familiar")

    entries: list[tuple[str, str, str, str]] = []
    with_definition = 0
    for word in sorted(selected):
        pos, base, definition = resolve_definition(word, wordnet, written)
        # Hand-written definitions are trusted; only WordNet needs screening.
        if definition and word not in written and base not in written:
            if not definition_is_clean(definition, blocked):
                pos, base, definition = "", "", ""
        if definition:
            with_definition += 1
        entries.append((word, pos, base, definition))

    unused = sorted(w for w in written if w not in selected)
    if unused:
        print(f"  note: {len(unused)} hand-written words are not in the word "
              f"list and were ignored: {', '.join(unused)}")

    coverage = 100 * with_definition / len(entries)
    print(f"  {with_definition} definitions ({coverage:.1f}% coverage)")

    lines = []
    for word, pos, base, definition in entries:
        if definition:
            lines.append(f"{word}|{pos}|{base}|{definition}")
        else:
            lines.append(word)

    by_length: dict[int, int] = {}
    for word, *_ in entries:
        by_length[len(word)] = by_length.get(len(word), 0) + 1
    print("  by length: " + ", ".join(f"{k}:{v}" for k, v in sorted(by_length.items())))

    payload = "\n".join(lines)
    everyday_payload = " ".join(everyday)
    familiar_payload = " ".join(familiar)
    for text in (payload, everyday_payload, familiar_payload):
        if "`" in text or "${" in text or "\\" in text:
            sys.exit("payload contains characters that would break a template literal")

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(
        "/* Generated by tools/build_dictionary.py - do not edit by hand.\n"
        f" * {len(entries)} words, {with_definition} with definitions.\n"
        f" * {len(everyday)} everyday and {len(familiar)} familiar words are\n"
        " * flagged separately, so suggestions can favour words a child knows.\n"
        " * Each line is either a bare word, or word|pos|baseWord|definition.\n"
        " * Sources: word-list (npm), wordfreq (pypi), WordNet 3.0 (Princeton).\n"
        " */\n"
        "window.SPELLING_DICTIONARY_RAW = `\n"
        f"{payload}\n"
        "`;\n"
        "\n"
        f"window.SPELLING_EVERYDAY_RAW = `{everyday_payload}`;\n"
        "\n"
        f"window.SPELLING_FAMILIAR_RAW = `{familiar_payload}`;\n",
        encoding="utf-8",
    )

    size_kb = OUT_PATH.stat().st_size / 1024
    print(f"wrote {OUT_PATH.relative_to(ROOT)} ({size_kb:.0f} KB)")


if __name__ == "__main__":
    build()
