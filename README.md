# Cooper's Word Game

A spelling game for Cooper.

Sixteen letters, five minutes, and as many words as she can build. Letters are
dragged (or tapped) onto a line where they can go on the front, the end, or
into the middle of what she has already made. Every word she finds is
celebrated, read aloud with its meaning, and the letters go straight back to
the grid for the next one.

It is built around one specific difficulty: telling **b** from **d**, **p**
from **q**, and **n** from **m**.

## Playing it

Open `index.html` in a browser. That is the whole thing — no server, no
install, no internet connection.

There is also a single-file build, `wordbuilder.html`, with the stylesheet,
all the code and the whole dictionary folded into one 1.4 MB file. It is the
easy one to live with: email it to yourself, drop it in iCloud or Dropbox,
put it on a USB stick, and open it on whatever device Cooper is holding.

```sh
python3 tools/build_standalone.py     # regenerates wordbuilder.html
```

### Putting it online

It is a static site, so anything that serves files will do.

- **Netlify Drop** — go to [app.netlify.com/drop](https://app.netlify.com/drop)
  and drag this folder onto the page. You get a URL in about ten seconds, with
  no account and no build configuration. Easiest option by a distance.
- **GitHub Pages** — Settings → Pages → deploy from a branch, root folder.
  Note that Pages on a *private* repository needs a paid GitHub plan; on a
  free account the repository has to be public first.
- **On your own network** — `python3 -m http.server 8000` in this folder, then
  open `http://<your-computer's-ip>:8000` on the tablet. Good enough for
  testing on the sofa, and nothing leaves the house.

The word list is 171 KB (67 KB compressed) and the game is playable as soon as
it lands — under three seconds even on a 1 Mbps connection. The 1.2 MB of
definitions downloads afterwards, in the background, while she is already
playing. Both are cached after the first visit.

## How it helps with b, d, p, q, n and m

**Each tricky letter has its own colour**, everywhere it appears — on the
tile, in the word she is building, and in the hints. The two halves of each
pair are deliberately far apart in hue, so colour alone is enough to separate
them at a glance.

**Each tricky letter carries a diagram** showing where its ball sits and
whether its tail hangs below the writing line. The diagram teaches a rule that
actually generalises, rather than a fact to memorise:

|                    | ball on the **left** | ball on the **right** |
| ------------------ | -------------------- | --------------------- |
| **sits on** the line | d                  | b                     |
| **tail hangs down**  | q                  | p                     |

and n has one hump where m has two. The `?` button opens a page of these,
including the classic **bed** trick — tap any card to hear it read out.

**Wrong answers get a targeted hint.** This is the part that matters most. If
she builds a word that fails *only* because of a b/d, p/q or n/m mix-up, the
game does not just say no. It works out which letter is the problem, wobbles
that exact tile, and asks the question that fixes it:

> So close! Look hard at the **n** — how many humps should it have?

**Every grid contains tricky letters**, and two thirds of the time both halves
of a pair turn up together, so the discrimination gets practised rather than
avoided. Using one in a word is worth bonus points.

## The kitten

A cat sits on the rim of the word line and watches. It reacts to what she is
doing, and each reaction has several animations rather than one, because a
celebration you have seen four times stops being a celebration:

| when | she does | out of |
| ---- | -------- | ------ |
| nothing on the line | blinks, ear flicks, tail flicks, head tilts, looks around, yawns | 6 |
| a letter goes down | perks her ears, leans in, bobs, blinks | 4 |
| **one letter away from a real word** | wiggles, bounces, taps her paws, eyes go wide, ears twitch | 5 |
| the line already spells a word | shimmies, hops, cranes her neck | 3 |
| a word is found | jumps, spins, waves, dances, purrs with her eyes shut | 5 |
| a long word is found | any of those, plus floating hearts | 4 |
| not a word yet | tilts her head, blinks, points a paw, peers closer | 4 |
| paused | curls up and sleeps, with z's | — |

Thirty-one animations in all. One is drawn at random each time and never the
same one twice running, so she stays surprising for a lot longer than a fixed
animation would.

The excited "nearly!" reaction is the interesting one: it fires when adding
one letter she can still reach would finish a real word, which is a genuine
"you are close" rather than a guess. Her pupils also follow the pointer, which
does more for *this cat is watching me* than any amount of animation.

She is decoration, so she is hidden from screen readers and everything she
reacts to is also said in words on the message line. She never overlaps a
letter at any screen size — she sits in head-room reserved above the word
line, not on it. Turn her off under **Settings → Kitten friend**; calm mode
keeps her but takes the bounce out.

## The rest of the design

Everything here is aimed at a seven year old who finds writing hard and has
ADHD.

- **Nothing punishes a wrong guess.** No lost points, no red, no buzzer — a
  warm two-note chime and a nudge. The letters stay exactly where they are so
  she can fix the word rather than start again.
- **Two ways to place a letter.** Drag it, or just tap it. Tapping a gap moves
  the insertion point. A keyboard works too.
- **Big targets, calm screen.** The letters are the brightest thing on the
  page and nothing else competes with them.
- **A pause button**, and the game pauses itself if she switches away.
- **Sound it out** reads the word back letter by letter, then whole.
- **The clock is a quiet ring**, not a red countdown.
- At the end she gets a handful of words she *could* have made — short, common
  ones — and tapping any of them says what it means.

Settings (from the start screen or the cog) turn off the letter diagrams,
letter-reading, spoken meanings, the "this is a real word" glow, sound, and a
calm mode that tones down the celebrations. Calm mode switches itself on if
the device asks for reduced motion. Best score and the collection of every
word she has ever found are kept in the browser.

## Making it hers

The game calls her by name: on the start screen, in the hints, on the results
screen, and in a bit under half the cheers when she finds a word — where it
mixes in her nicknames too, so she gets "Nice one, Meepsie!" and "You got it,
Meeps!" as well as her proper name.

Those knobs are at the top of `js/game.js`:

```js
var PLAYER = "Cooper";
var NAMES = [PLAYER, "Meeps", "Meepsie"];  // picked at random
var NAME_CHANCE = 0.45;                    // how often a cheer uses one at all
```

Each name is equally likely; listing one twice would make it twice as common.
The headings and the dedication are written into `index.html`.

## The dictionary

`data/words.js` and `data/definitions.js` hold 23,761 words with 21,305
definitions, all offline.
It is built to be **generous about accepting and careful about suggesting**:
having a word she genuinely made turned down is the one thing that would put
her off, so the list is wide, while the words the game offers her at the end
of a round come from a much smaller everyday tier.

- Words are filtered by how common they are, with a higher bar for short words
  (easy to hit by accident) than long ones (an achievement).
- British spellings are recovered wherever the American one made the cut, so
  `colour`, `practise` and `kerb` are all correct.
- Profanity and adult vocabulary are filtered out — carefully, so that `grape`,
  `canal`, `basement` and `scrape` survive.
- Obscure words that are a b/d, p/q or n/m reversal of an everyday word are
  removed, so the game can never mark her reversal correct. `nam` is a real
  entry in the frequency data, and it is also exactly what you get when you
  write `man` with the n and m the wrong way round. Real words like `cone`,
  `mane` and `dab` are reversals too, and those stay.
- Definitions come from WordNet, cleaned up and cut to one short sentence.

WordNet is written for adults, so the ~250 words a child is most likely to
build have hand-written definitions instead, in
[`tools/kid_definitions.txt`](tools/kid_definitions.txt):

```
cat = A soft furry pet that says meow and likes to curl up and sleep
```

**That file is meant to be edited.** Add Cooper's own words to it, rerun the
build, and the game will read your wording out instead.

### Rebuilding it

```sh
pip install wordfreq
npm install --prefix tools word-list wordnet-db naughty-words
python3 tools/build_dictionary.py
```

## What is in here

```
index.html              the game
css/styles.css
css/kitten.css          the cat's look and all 31 animations
js/letters.js           the six tricky letters: colours, diagrams, hints
js/dictionary.js        word lookup, anagram search, near-miss detection
js/grid.js              picking sixteen playable letters
js/dragdrop.js          dragging and tapping
js/speech.js            reading letters, words and meanings aloud
js/sound.js             synthesised chimes, no audio files
js/confetti.js          the reward
js/kitten.js            the cat: reactions and picking between them
js/game.js              the round
data/words.js           generated — the word list, loaded first
data/definitions.js     generated — the meanings, loaded in the background
wordbuilder.html        generated — the whole game as one file
tools/build_dictionary.py
tools/build_standalone.py
tools/kid_definitions.txt
```

## Known rough edges

- Speech uses whatever voices the browser has. It picks a British one where it
  can; on a device with no voices installed it stays silent and everything
  else still works.
- The ~21,000 WordNet definitions were not read one by one. The common words
  were checked and the worst offenders overridden, but somewhere in the long
  tail there will be a definition that is technically correct and oddly
  worded. Adding a line to `kid_definitions.txt` fixes any you hit.
- Words are 3 to 8 letters. Longer ones are not in the dictionary.
