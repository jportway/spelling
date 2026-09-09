# Cooper's Spelling Games

Two games for Cooper, built around one specific difficulty: telling **b** from
**d**, **p** from **q**, and **n** from **m**.

| | |
| --- | --- |
| [`index.html`](index.html) | **Cooper's Word Game** — sixteen letters, five minutes, make as many words as you can |
| [`missing.html`](missing.html) | **Cooper's Missing Letters** — a word with a hole in it, and the letter it is muddled with sitting right next to the right answer |

They share a dictionary, a kitten, a set of settings and the same six-letter
lesson. Each start screen links to the other.

## Playing them

Open either file in a browser. That is the whole thing — no server, no
install, no internet connection.

There are also single-file builds, `wordbuilder.html` and
`missingletters.html`, with the stylesheets, all the code and the whole
dictionary folded into one 1.5 MB file each. They are the easy ones to live
with: email them to yourself, drop them in iCloud or Dropbox, put them on a
USB stick, and open them on whatever device Cooper is holding. Keep the two in
the same folder and the link between them still works.

```sh
python3 tools/build_standalone.py     # regenerates both single-file builds
```

### Putting them online

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

The word list is 171 KB (67 KB compressed) and either game is playable as soon
as it lands — under three seconds even on a 1 Mbps connection. The 1.2 MB of
definitions downloads afterwards, in the background, while she is already
playing. Both are cached after the first visit.

## Cooper's Word Game

Sixteen letters, five minutes, and as many words as she can build. Letters are
dragged (or tapped) onto a line where they can go on the front, the end, or
into the middle of what she has already made. Every word she finds is
celebrated, read aloud with its meaning, and the letters go straight back to
the grid for the next one.

**Every grid contains tricky letters**, and two thirds of the time both halves
of a pair turn up together, so the discrimination gets practised rather than
avoided. Using one in a word is worth bonus points.

**Wrong answers get a targeted hint.** If she builds a word that fails *only*
because of a b/d, p/q or n/m mix-up, the game does not just say no. It works
out which letter is the problem, wobbles that exact tile, and asks the question
that fixes it:

> So close! Look hard at the **n** — how many humps should it have?

At the end she gets a handful of words she *could* have made — short, common
ones — and tapping any of them says what it means.

## Cooper's Missing Letters

A word appears with a hole in it and gets read out, meaning and all. She drags
the letter that belongs in the hole. The right one locks in and goes green; the
wrong one tips over and falls back into the pile. Buttons repeat the word and
its meaning as often as she likes.

Where the word game waits for a mix-up to happen, this one goes looking:

- **About four fifths of the time the missing letter is one of the six.** Not
  all of the time — if the answer were always a b or a d she could stop
  reading the word and play the pile instead.
- **When it is, the letter it is muddled with is in the pile too**, better than
  nine times out of ten. That is the whole game in one sentence: a b with no d
  beside it is not a decision.
- **The word sits on a writing line**, with the tails of p, q, g and y hanging
  through it. The lesson is "which side is the ball on, and does the tail hang
  below the line", so the line has to actually be there.
- **The other decoys are chosen to tempt**, not to pad: a letter from
  elsewhere in the word first, then one more of the six, then ordinary
  letters.

Longer words sometimes get two holes, never side by side — adjacent blanks stop
being two decisions and turn into one guess.

### Easy words first

Every word in the dictionary is graded 0 to 5 for how hard it is — see
[the dictionary](#the-dictionary) below — and this game works up the scale.
The first round opens on grade 0 only: **bob, ant, snap, gym, wish, bite,
bird**. The band widens as she gets them right, and stops at grade 3.

Grades 4 and 5 are never reachable. That is where `coup` lives: four letters,
two sounds, a silent p, and no way on earth to reason your way to it. So do
`through`, `ballet`, `debris` and `yacht`.

A British child is also never asked to complete `flavor`. Where both spellings
survived, the American one is held back — the word game still accepts it, this
game just will not teach it.

### When she gets one wrong

Nothing is lost and nothing turns red. The letter falls out, and the game says
which letter she actually picked and asks the question that separates it from
the right one — without saying which is which:

> That one's a **d** — ball on the left, sitting on the line. Listen again:
> **bad**. Which side should the ball be on?

If the wrong letter happens to spell a real word, which happens constantly with
b and d, it says so rather than pretending otherwise:

> That spells **dad** — a real word! But we want **bad**.

After a second miss the right letter and the one it is muddled with lift out of
the pile together, narrowing six choices to two — a scaffold, not the answer.
She can try as long as she likes. **Skip** is always there, and after five
misses the game points at it.

### Getting harder as she goes

Six levels, from three-letter everyday words up to eight-letter ones with two
holes. Two clean answers in a row moves her up a rung; a word that took a
couple of goes moves her back down. She should be working, never drowning.

### The balloon

There is no score. The round is: **fill the balloon before the clock runs
out**, and popping it plays a video.

That shape is deliberate, and it replaced a points total that was quietly
teaching the wrong lesson. Points came from words completed, so going faster
was worth more — and because the pile nearly always holds the answer beside
the letter it is muddled with, guessing was a coin flip that paid out half the
time and cost almost nothing. The best way to play was to stop thinking.

Now there is no "more" to earn by hurrying. The balloon needs what it needs.

Every word is worth a few **puffs of air**, shown as a little pile beside it
so the stake is visible before she touches anything — longer words and tricky
holes are worth more. Every wrong letter halves what is left, with a floor of
one so finishing always counts:

```
worth 5  →  miss  →  3  →  miss  →  2  →  miss  →  1  →  1
```

Finish the word and the remaining puffs fly up and blow the balloon out, one
at a time. It stretches, the rubber goes pale and thin, and past four fifths
full it starts trembling and creaking, so she can see and hear the pop coming.
Nothing ever deflates — air already banked is hers.

The numbers, measured by playing the real game three ways for a few minutes
each and projecting to a five-minute round:

| how she plays | puffs a second | to fill the balloon |
| ------------- | -------------- | ------------------- |
| stops and looks | 0.68 | **170s** — 57% of the round |
| stops and looks, but misses one in four | 0.56 | **205s** — 68% |
| taps until something sticks | 0.18 | **656s** — twice the clock |

Careful play is not merely better any more. It is the only thing that gets
there. The two simulated players live in the test suite, and that is where the
balloon's size was calibrated.

### The pop

The round ends the moment it bursts, and she gets a My Little Pony video.

Both knobs are at the top of [`js/reward.js`](js/reward.js). Fill in `VIDEOS`
with ids of videos you have watched yourself and it plays one of those.
Otherwise set `CHANNEL_ID` to a channel's real id — the one starting `UC`, not
the `@name` in the address bar — and it picks at random from that channel's
uploads. No API key is involved either way, so there is no secret to leak out
of a public repository.

Two things worth knowing about the channel route: a random pick from a whole
back catalogue is sometimes an advert or a two-hour compilation, and an
embedded player has end-screen cards that cannot be fully suppressed. It is
fine with someone in the room; it is not a walled garden. The curated list
avoids both, which is probably where you end up.

**With neither set — which is how this ships — the balloon bursts into a
full-screen party instead**, and the game stays entirely offline. That is also
what happens with no connection, or if the video will not load within six
seconds. This is the only part of either game that touches the network, and
nothing is fetched until the balloon actually goes.

### Afterwards

The results screen has a **Still a bit wobbly** panel listing the pairs that
went wrong and how often. That one is really for whoever is sitting next to
her. Tapping a pair reads out how to tell the two apart.

## The practice log

Every word she is given and every letter she tries is written down, so the
thing worth knowing — is b-for-d getting rarer, is she getting quicker at
deciding — can actually be looked at rather than guessed.

One record per word:

```json
{ "w": "bandit", "h": [0, 3], "g": 1, "lv": 2,
  "tries": [ { "hole": 3, "got": "p", "ms": 616 },
             { "hole": 3, "got": "d", "ms": 900 },
             { "hole": 0, "got": "b", "ms": 899 } ],
  "solved": true, "puffs": 2 }
```

`hole` is the position in the word, not which gap it was in the queue, so a
word with two letters missing says exactly which one she was filling. `ms` is
how long she took over that particular choice.

**It is deliberately raw.** Whether an attempt was right, and whether a wrong
one was the b/d muddle rather than something else, are both worked out when
the log is *read* — they are `got === w[hole]` and a glance at the pair.
Writing "this was a b/d error" into the record would bake in an opinion about
what counts as a mistake and quietly hide any pattern that opinion did not
anticipate.

### Where it goes

**localStorage first, and always.** The queue on her iPad is the real copy;
uploading drains it. That is what makes a tablet on a train behave exactly
like one at home, and it means logging works today with nothing set up at all.
Records only leave the queue once a server has actually acknowledged them, so
a failed upload costs a retry and nothing else.

Under **Settings → Practice log** there is a box for an upload address and a
button that downloads the lot as JSON. With no address set, the download is
the whole mechanism.

If you want it uploading, a **Google Apps Script web app writing to a Sheet**
is the easiest thing that works: no server, no API key, free, and it lands
directly in the thing you want to chart. The one gotcha is baked into the
code already — the upload posts as `text/plain`, because anything else
triggers a CORS preflight that Apps Script's redirect will not survive.

**The address is not in this repository, on purpose.** The site is public, so
a URL committed here would be an open endpoint for anyone who found it. It is
typed into Settings once, on her iPad, and lives only in that browser.

Nothing in the log identifies a person: a random id for the device, and no
name.

## How they help with b, d, p, q, n and m

**Each tricky letter has its own colour**, everywhere it appears — on the
tile, in the word she is building or reading, and in the hints. The two halves
of each pair are deliberately far apart in hue, so colour alone is enough to
separate them at a glance.

**Each tricky letter carries a diagram** showing where its ball sits and
whether its tail hangs below the writing line. The diagram teaches a rule that
actually generalises, rather than a fact to memorise:

|                    | ball on the **left** | ball on the **right** |
| ------------------ | -------------------- | --------------------- |
| **sits on** the line | d                  | b                     |
| **tail hangs down**  | q                  | p                     |

and n has one hump where m has two. The `?` button on either page opens a page
of these, including the classic **bed** trick — tap any card to hear it read
out.

## The kitten

A cat sits on the rim of the word and watches. It reacts to what she is
doing, and each reaction has several animations rather than one, because a
celebration you have seen four times stops being a celebration:

| when | she does | out of |
| ---- | -------- | ------ |
| nothing on the line | blinks, ear flicks, tail flicks, head tilts, looks around, yawns | 6 |
| a letter goes down | perks her ears, leans in, bobs, blinks | 4 |
| **one letter away from a real word** | wiggles, bounces, taps her paws, eyes go wide, ears twitch | 5 |
| the line already spells a word | shimmies, hops, cranes her neck | 3 |
| a word is finished | jumps, spins, waves, dances, purrs with her eyes shut | 5 |
| a long word is finished | any of those, plus floating hearts | 4 |
| not right yet | tilts her head, blinks, points a paw, peers closer | 4 |
| paused | curls up and sleeps, with z's | — |

Thirty-one animations in all. One is drawn at random each time and never the
same one twice running, so she stays surprising for a lot longer than a fixed
animation would. Her pupils also follow the pointer, which does more for *this
cat is watching me* than any amount of animation.

She is decoration, so she is hidden from screen readers and everything she
reacts to is also said in words on the message line. She never overlaps a
letter at any screen size — she sits in head-room reserved above the word,
not on it. Turn her off under **Settings → Kitten friend**; calm mode keeps her
but takes the bounce out.

## The rest of the design

Everything here is aimed at a seven year old who finds writing hard and has
ADHD.

- **Nothing punishes a wrong guess.** No lost points, no red, no buzzer — a
  warm two-note chime and a nudge.
- **Two ways to place a letter.** Drag it, or just tap it. A keyboard works
  too.
- **Big targets, calm screen.** The letters are the brightest thing on the
  page and nothing else competes with them.
- **A pause button**, and the games pause themselves if she switches away.
- **The clock is a quiet ring**, not a red countdown.

Settings (from either start screen or the cog) turn off the letter diagrams,
letter-reading, spoken meanings, the "this is a real word" glow, the reward
video, sound, and a calm mode that tones down the celebrations. Calm mode switches itself on if
the device asks for reduced motion. **The settings are shared between the two
games** — the sound switch is the same switch on both pages — while each game
keeps its own best score. Both live in the browser.

## Making it hers

The games call her by name: on the start screens, in the hints, on the results
screens, and in a bit under half the cheers — where they mix in her nicknames
too, so she gets "Nice one, Meepsie!" and "You got it, Meeps!" as well as her
proper name.

Those knobs are at the top of `js/game.js` and `js/missing.js`:

```js
var PLAYER = "Cooper";
var NAMES = [PLAYER, "Meeps", "Meepsie"];  // picked at random
var NAME_CHANCE = 0.45;                    // how often a cheer uses one at all
```

Each name is equally likely; listing one twice would make it twice as common.
The headings and the dedications are written into the two HTML files.

## The dictionary

`data/words.js` and `data/definitions.js` hold 23,761 words with 21,305
definitions, all offline.
It is built to be **generous about accepting and careful about suggesting**:
having a word she genuinely made turned down is the one thing that would put
her off, so the list is wide, while the words the games *offer* her — the ones
missing-letters asks her to finish, and the ones the word game lists at the end
of a round — come from a much smaller everyday tier.

- Words are filtered by how common they are, with a higher bar for short words
  (easy to hit by accident) than long ones (an achievement).
- British spellings are recovered wherever the American one made the cut, so
  `colour`, `practise` and `kerb` are all correct.
- Profanity and adult vocabulary are filtered out — carefully, so that `grape`,
  `canal`, `basement` and `scrape` survive.
- Obscure words that are a b/d, p/q or n/m reversal of an everyday word are
  removed, so a game can never mark her reversal correct. `nam` is a real
  entry in the frequency data, and it is also exactly what you get when you
  write `man` with the n and m the wrong way round. Real words like `cone`,
  `mane` and `dab` are reversals too, and those stay.
- Definitions come from WordNet, cleaned up and cut to one short sentence.

### Grading

Every word carries a grade from **0** (easiest) to **5**, worked out at build
time by [`tools/grade_words.py`](tools/grade_words.py) and stored as one digit
per word. It answers two questions.

**Can she work the spelling out?** English usually rewards sounding a word
out, and where it does not, it is because letters are silent, a grapheme is
doing something unusual, or an unstressed vowel has collapsed into a schwa
that could be spelled with any vowel going. Checking the letters against a
pronunciation dictionary finds all three. `coup` is four letters and two
sounds — `K UW` — and the p is simply not there, so no amount of listening
will get her to it. `cat` is three letters and three sounds and scores zero.

**Does she know the word?** Frequency data is counted from adult writing, so
on its own it believes `coup` is a more familiar word than `hamster`. Three
things correct it: age-of-acquisition ratings, which say when people report
learning a word; how often the word appears *in its dictionary sense* in a
hand-tagged corpus, which is what separates `bed` from `ben` — both look
common to a frequency counter, because the counter is also counting every Ben
ever written about; and a hand-written list of ordinary childhood vocabulary.

[`tools/kid_words.txt`](tools/kid_words.txt) is that list, and like
`kid_definitions.txt` **it is meant to be edited**. Anything on it is treated
as certainly familiar whatever the numbers say, which is how `hamster`,
`wellies` and `playground` get to be grade 0.

```
grade 0   1,548 words   cat bed pig moon hair chin ant snap
grade 1   2,235         puddle spelling colour word work
grade 2   3,750         island knee rabbit school yacht
grade 3   5,932         elephant flavour
grade 4   7,499         coup through debris — never used by the games
grade 5   2,811         ballet
```

WordNet is written for adults, so the ~250 words a child is most likely to
meet have hand-written definitions instead, in
[`tools/kid_definitions.txt`](tools/kid_definitions.txt):

```
cat = A soft furry pet that says meow and likes to curl up and sleep
```

**That file is meant to be edited.** Add Cooper's own words to it, rerun the
build, and the games will read your wording out instead.

### Rebuilding it

```sh
pip install wordfreq cmudict
npm install --prefix tools word-list wordnet-db naughty-words
python3 tools/build_dictionary.py
```

## What is in here

```
index.html              Cooper's Word Game
missing.html            Cooper's Missing Letters
css/styles.css          the shell both games wear
css/kitten.css          the cat's look and all 31 animations
css/missing.css         the word on its writing line, and the hole in it
js/letters.js           the six tricky letters: colours, diagrams, hints
js/dictionary.js        word lookup, anagram search, near-miss detection
js/grid.js              picking sixteen playable letters
js/dragdrop.js          dragging and tapping, shared by both games
js/speech.js            reading letters, words and meanings aloud
js/sound.js             synthesised chimes, no audio files
js/confetti.js          the reward
js/kitten.js            the cat: reactions and picking between them
js/game.js              the word game's round
js/puzzle.js            choosing a word, a hole and a pile of letters
js/balloon.js           the balloon: how full, how strained, and the pop
js/reward.js            what happens when it bursts
js/logbook.js           what she did, kept locally and uploaded if you like
js/missing.js           the missing-letters round
data/words.js           generated — the word list and its grades, loaded first
data/definitions.js     generated — the meanings, loaded in the background
wordbuilder.html        generated — the word game as one file
missingletters.html     generated — missing letters as one file
tools/build_dictionary.py
tools/build_standalone.py
tools/grade_words.py    how hard is this word to spell, and to know?
tools/kid_definitions.txt
tools/kid_words.txt     childhood vocabulary the frequency data undervalues
tools/aoa.txt           age-of-acquisition ratings (Kuperman et al. 2012)
```

## Known rough edges

- Speech uses whatever voices the browser has. It picks a British one where it
  can; on a device with no voices installed it stays silent and everything
  else still works. Missing Letters leans on speech more than the word game
  does, but it always shows the word on screen as well as saying it.
- The ~21,000 WordNet definitions were not read one by one. The common words
  were checked and the worst offenders overridden, but somewhere in the long
  tail there will be a definition that is technically correct and oddly
  worded. Adding a line to `kid_definitions.txt` fixes any you hit.
- Words are 3 to 8 letters. Longer ones are not in the dictionary.
- The grading is a good sorter, not a perfect one. The age-of-acquisition
  ratings only cover about 2,600 words, so most of the list is graded on
  frequency, corpus tagging and word shape instead. Expect the odd word in
  the easy band that is technically simple but not childhood vocabulary. If
  one turns up that she should not be meeting, adding it to
  `tools/kid_words.txt` is the wrong fix — that list makes words *easier*.
  Raise it in `EXTRA_BLOCKED` in `build_dictionary.py` instead.
