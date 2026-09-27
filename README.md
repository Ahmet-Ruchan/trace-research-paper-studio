<div align="center">

<img src="logo/trace.png" alt="Trace Research Paper Studio" width="720" />

# Trace — Research Paper Studio

**Name a paper. Get an interactive site where every claim points back to a page and a quote.**

Trace turns a research paper into something you can verify, learn from and experiment with —
running on the coding agent you already use, with no second API key.

[![Check](https://img.shields.io/github/actions/workflow/status/Ahmet-Ruchan/trace-research-paper-studio/check.yml?branch=main&style=for-the-badge&label=check&color=2E7254&labelColor=191B18)](https://github.com/Ahmet-Ruchan/trace-research-paper-studio/actions/workflows/check.yml)
[![Plugins](https://img.shields.io/github/actions/workflow/status/Ahmet-Ruchan/trace-research-paper-studio/plugins.yml?branch=main&style=for-the-badge&label=plugin%20on%203%20agents&color=2E7254&labelColor=191B18)](https://github.com/Ahmet-Ruchan/trace-research-paper-studio/actions/workflows/plugins.yml)
[![Stars](https://img.shields.io/github/stars/Ahmet-Ruchan/trace-research-paper-studio?style=for-the-badge&color=E75B37&labelColor=191B18)](https://github.com/Ahmet-Ruchan/trace-research-paper-studio/stargazers)
[![Forks](https://img.shields.io/github/forks/Ahmet-Ruchan/trace-research-paper-studio?style=for-the-badge&color=2E7254&labelColor=191B18)](https://github.com/Ahmet-Ruchan/trace-research-paper-studio/network/members)
[![Issues](https://img.shields.io/github/issues/Ahmet-Ruchan/trace-research-paper-studio?style=for-the-badge&color=8C5C18&labelColor=191B18)](https://github.com/Ahmet-Ruchan/trace-research-paper-studio/issues)
[![License](https://img.shields.io/github/license/Ahmet-Ruchan/trace-research-paper-studio?style=for-the-badge&color=191B18&labelColor=191B18)](LICENSE)
[![Last commit](https://img.shields.io/github/last-commit/Ahmet-Ruchan/trace-research-paper-studio?style=for-the-badge&color=666B64&labelColor=191B18)](https://github.com/Ahmet-Ruchan/trace-research-paper-studio/commits/main)

**Works with the agent you already have**

[![Claude Code](https://img.shields.io/badge/Claude_Code-D97757?style=for-the-badge&logo=claude&logoColor=fff)](#claude-code)
[![Codex](https://img.shields.io/badge/Codex-412991?style=for-the-badge&logo=openai&logoColor=fff)](#codex)
[![Antigravity CLI](https://img.shields.io/badge/Antigravity_CLI-4285F4?style=for-the-badge&logo=google&logoColor=fff)](#antigravity-cli)

**Built with**

![Next.js](https://img.shields.io/badge/Next.js_16-000?style=flat-square&logo=nextdotjs&logoColor=fff)
![React](https://img.shields.io/badge/React_19-149ECA?style=flat-square&logo=react&logoColor=fff)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=fff)
![Zod](https://img.shields.io/badge/Zod-3E67B1?style=flat-square&logo=zod&logoColor=fff)
![arXiv](https://img.shields.io/badge/arXiv-B31B1B?style=flat-square&logo=arxiv&logoColor=fff)

</div>

---

## The problem

Summarising a paper takes seconds. Trusting the summary takes hours.

Ask any model to summarise a paper and you get fluent prose you cannot check. Which sentence
came from which page? Is this something the authors measured, or something they suggested?
To find out you have to go back to the paper — so the summary saved you nothing.

**Trace inverts that.** Every claim carries the page and the exact quote it rests on. Measured
results, author interpretation and background are labelled separately. Anything the excerpt does
not directly support is never marked verified.

---

## One sentence is the whole interface

You do not need the PDF.

```text
Explain Attention Is All You Need using the Trace plugin.
```

```mermaid
flowchart LR
    A["Paper name<br/>or PDF"] --> B["Find on arXiv<br/>+ published context"]
    B --> C["Read page by page<br/>evidence + quotes"]
    C --> D["Report · appendix<br/>visual story"]
    D --> E["Primer · derivations<br/>playgrounds · quiz<br/>misreadings"]
    E --> F["Validate"]
    F --> G["Local site opens"]
    F --> H["Portable<br/>.trace.json"]

    style A fill:#f2efe7,stroke:#beb9af,color:#191b18
    style F fill:#191b18,stroke:#191b18,color:#ffffff
    style G fill:#e75b37,stroke:#e75b37,color:#ffffff
    style H fill:#2e7254,stroke:#2e7254,color:#ffffff
```

Trace finds the paper on arXiv, downloads it, gathers what is publicly known about it (version
history, DOI, the venue it was published in, citation counts), reads it page by page, and opens
a finished local site in your browser.

### Start from a DOI or a repository link

Not every field lives on arXiv. Give a DOI, or a link or id from bioRxiv, medRxiv, PubMed Central,
ACL Anthology or OpenReview, and Trace looks for the open-access copy: the arXiv version when one
exists, then the repository's own PDF, Europe PMC's open-access archive, and the open-access
locations OpenAlex lists. A title that arXiv cannot match with certainty is searched on OpenAlex too.

```text
Explain 10.1101/2021.10.04.463034 using the Trace plugin.
Explain https://aclanthology.org/2020.acl-main.1 using the Trace plugin.
```

Trace downloads only from that short list of repositories, never from a publisher's site. When the
only open copy lives somewhere else, it tells you where, and you pass the PDF yourself. OpenReview
and the PubMed Central website may ask for a browser check; Trace does not try to get around it. For
PubMed Central it uses the open-access archive EBI publishes for programs; for OpenReview it asks
you for the PDF or the title. Set `UNPAYWALL_EMAIL` to let Trace ask Unpaywall as well.

The studio has the same search under the upload box: type a title, a DOI, an arXiv id or a link.

---

## What you actually get

### Learn from it, not just read it

Every analysis comes with a learning layer, sized by the depth you pick: the prior knowledge the
paper assumes, the key results derived step by step, playgrounds that run its formulas, a quiz whose
every answer shows its page, the paper's common misreadings, and a guide to using the method. It is written from the evidence alone
and checked like everything else: every item cites existing claims, a formula must parse and give a
finite value at the paper's own setting, and a derivation step that only restates its formula is
refused. A number a reader would take for the paper's own (a playground's "paper value", a table
cell, a hyperparameter, the numbers a worked example starts from) must appear in the evidence. When
a teaching device needs made-up numbers, such as a worked attention matrix, it is labelled
**Illustrative values, not from the paper**. In the studio a fifth model, **Teaching**, writes it;
it never receives the PDF, so it can be a local model. If one part fails its checks twice, the
analysis still completes and says which part is missing.

A project made before this (or imported without it) shows **Add the learning layer** on its
overview. It writes only the missing parts, from the locked evidence, and the previous version stays
in the history.

### Run the paper's own equations

The paper argues that dot products must be divided by `√d_k`. It never plots it. Drag the
slider and watch the unscaled attention weight collapse onto 1.0 while the scaled one holds
steady. The slider **starts at the paper's value, marks it on the track and the chart, and
warns you the moment you leave the region the paper actually verified**.

![Interactive playground](docs/images/playground.jpg)

### Predict first, then look

Seeing a curve teaches less than guessing it first. Before a playground shows its chart, Trace asks
what each curve will do as the slider moves (rise, fall, stay flat, rise then fall, fall then rise)
and, when there are two, whether they cross. The answers are not written by a model: Trace sweeps the
playground's own formula over the slider's range, so the key point of the attention paper comes back
as a question (the unscaled weight rises towards 1, the scaled one stays flat; the two costs of Table 1
cross at n = d = 512). A derivation works the same way: before the next step appears, you pick it from
the true next step and later steps of the same derivation, all true statements, only one of which
follows from here. You can always just look instead.

![Predict before the chart](docs/images/predict.jpg)

### Learn what the paper assumes and never explains

Prerequisites ordered so that nothing depends on something you have not read yet. Each one says
why *this* paper needs it — not a generic definition. LaTeX renders as native MathML.

![Primer](docs/images/primer.jpg)

### Check whether you actually understood it

Every question is linked to evidence. Get one wrong and Trace does not give the answer away: it
says why the option you picked is wrong and links to the part of the story where the paper settles
it. Try again, or ask for the answer and its page and quote. The score counts what you got right on
the first try.

**Read it like a reviewer** adds questions no model writes: what kind of statement a claim is (a
measurement, the authors' interpretation, background, method or a limitation), which sentence of the
paper it rests on, and which number the paper reports. They are made from the evidence itself, so
every project has them, even one without a learning layer, and every answer can be checked on its
page.

![Evidence-linked quiz](docs/images/quiz.jpg)

### See through the common misreadings

Every paper has conclusions that are easy to draw and wrong. The attention paper does not show that
training breaks down without the `√d_k` scaling; the authors suspect it and scale as a precaution.
Sinusoidal position encodings do not beat learned ones; the two came out nearly identical.
Self-attention is not faster at every length; only while the sequence is shorter than the
representation. **Common misreadings** lists these for each paper, each labelled with the kind of
mistake (an interpretation read as a result, a claim beyond what was tested, a misread number, a
misunderstood mechanism) and corrected from the claims it cites. The correction stays hidden until
you ask why the sentence is wrong, so you get to spot the problem yourself first. The block is part
of the learning layer at standard and deep depth, is checked like the rest (existing claims, a
correction that says something new, at least two kinds of mistake), and the Anki export turns each
item into a "Does the paper show this?" card.

![Common misreadings](docs/images/misreadings.jpg)

### Study it step by step

**Study** turns the paper into a path you walk in order: the question it asks and its thesis, the
concepts it assumes (each one after the concepts it builds on), every section of the story followed
by one question on the same claims, the derivations and playgrounds, a final check with the questions
no section has asked yet, and the application guide. The question after a section comes from the
quiz; where the quiz has none on those claims, it comes from **Read it like a reviewer**, so a
project without a learning layer gets a path too.

At the end, **How it went** lists what to read again: for every question that took more than one
try, the section it belongs to and the primer concepts resting on the same claims, one click away.
Trace remembers where you stopped. In the studio the progress is kept in your library, next to the
paper, and never in the project file, so exports and published pages do not carry your answers. The
published site and the exported page have **Study** too, and keep progress in the reader's own
browser. To continue on another device, **Save progress to a file** and **Load progress from a file**
there: on the published page, the exported page or in the studio. Loading merges instead of
replacing: every step done on either device, the latest answer to each question and the most
advanced state of each review card are kept, and a file for another paper changes nothing.

![Study mode](docs/images/study.jpg)

### Explain it back in your own words

Recognising the right answer in a quiz is easier than recalling it, and recalling it is easier than
explaining it. At the end of every section in **Study**, **Explain it in your own words** lets you
write what the section says, as you would to a friend. A model that sees only the collected evidence,
not the paper, then shows which of the section's claims you conveyed, which you left out, where you
said something the evidence contradicts (a hypothesis stated as a measured result, a changed number, a
result stretched beyond what was tested) and what you added that no claim supports. Each point links
to its claim and page.

It is a model's reading, and the page says so, but the parts that can be checked are checked by code:
every claim must exist, "left out" can only name the claims the section rests on, and every phrase it
quotes back to you must be your own words, verbatim.

Explaining a section once says less than explaining it again a week later. Every explanation you check
is kept with your study progress, in your library and never in the project, so the next time you
explain the same section Trace shows what changed: the claims you conveyed this time and not last
time, the ones you conveyed before and dropped, and the ones you left out both times, with the count
going from, say, 1 of 2 to 2 of 2. The comparison is done by code on the claims each check found, not
by a model. **Your earlier explanations** lists the last five for each section, newest first, and
**Forget these** removes them. An explanation written for an earlier version of a section says so.
Your agent can do the same with the active model, and when the paper is in your library its checks
land in the same history:

```text
I'll explain the scaling section of my Trace project in my own words; check it against the evidence using the Trace plugin.
```

![Explain it back](docs/images/explain.jpg)

![What you added since your last explanation](docs/images/explain-history.jpg)

### Remember it weeks later

Understanding a paper on Monday does not mean you can explain it next month. Everything you answer
and read in **Study** becomes a card: a question you got right on the first try comes back in three
days, one you missed and each concept you read come back the next day. Remember it and the gap grows
to 7, 16, 35 and 90 days; miss it and it starts again from tomorrow.

The library shows how many cards are due, and **Review** asks them one at a time, from every paper at
once, alternating between papers so one answer does not give away the next. A question counts as
remembered only when it is right on the first try. A concept card shows the term, you try to recall
what it means and why the paper needs it, then open it and say honestly whether you did. The Lab has
the same queue for a single paper. Nothing is generated: a card is the project's own question or
concept, so a rewritten question or a deleted paper simply drops out of the queue. The schedule is
kept next to your study progress, never in the project file.

![Review across the library](docs/images/review.jpg)

### See what you have learned

**Progress** in the library header adds up your study: papers finished and in progress, how many of
your reviews you remembered, how many questions you got right on the first try, and how many cards you
keep long-term (the ones that now come back after sixteen days or more). It shows where your cards are
on the schedule, what comes due each day of the week ahead, the cards you forget most (with the paper
they come from, because rereading helps them more than another review), what explaining a section
again added, and a table of every paper you have studied.

All of it is counted from your study progress, nothing is estimated, and a share is shown as a
percentage only from ten counts up: three reviews say little. Your agent reads the same numbers:

```text
How is my studying going across my Trace papers, and what should I review? Use the Trace plugin.
```

![Your learning](docs/images/progress.jpg)

### Work in focused rounds, with breaks

**Focus** in the header of every screen opens a work timer. Work in rounds with a short break after
each one and a long break every few rounds (25, 5 and 15 minutes to begin with, every length yours
to change), for as many rounds as you choose or until you stop: breaks and rounds start on their own,
or wait for you. Beside it are a **Timer** that counts down, a **Stopwatch** with laps, and **Alarms**
for a time of day, once or on the days you pick. Each has its own colour among the studio's eleven:
yellow, blue, red, green, orange, purple, lilac, light blue, navy, burgundy and pink.

The timer keeps running while you read a paper: the header shows the time left, the browser tab
shows it too, and when a round ends a note says what comes next, with a chime (and a desktop
notification if you allow it). Only focus time counts as work, never a break; a countdown or the
stopwatch count if you want them to. A tab in the background keeps counting and rings on time, even
when the browser slows its timers or freezes the tab to save energy. Only when the tab is closed or
the computer sleeps does the timer pause at that moment, and say so, instead of adding the night to
your day.

![The work timer](docs/images/focus.jpg)

### Your profile, and a calendar of the days you worked

The round button next to it is your **profile**: your name, role, institution, field of study, an
email and a photo, all editable. Below them is a calendar like a contribution graph, one square per
day, darker the closer you came to your daily goal, in the colour you choose; show the last twelve
months or any past year, and choose a day to see its sessions. Around it are today against your
goal, this week and month, your streak and longest streak, your daily average and your best day.
Add time you worked without the timer, or delete a session started by mistake.

Every minute is kept on your computer, in `~/.trace/profile.json` and `~/.trace/focus-log.json`, never
in a paper and never sent anywhere. Writes are atomic, a damaged file is set aside rather than
overwritten, and a copy of the last seven days is kept in `~/.trace/backups`. **Download my data**
puts everything in one file; importing it on another computer adds its sessions and removes none.

![Your profile and work calendar](docs/images/profile.jpg)

### Connect what you learn across papers

Every paper explains the concepts it assumes from scratch, so the tenth paper you read teaches you
softmax for the tenth time. Trace remembers where you already learned it. **Concepts** in the Lab
lists what this paper assumes and, for each one, whether you studied it here, studied it in another
paper of your library (with a link to that paper), or can find it explained in a paper you have not
studied yet. The primer and the study path say the same thing where the concept appears: *you
studied this in …, skim it here or move on*.

For the concepts you have not studied anywhere, **Look in the references** goes through the works the
paper cites (the 50 most-cited, from OpenAlex) for a title that names them, then for an abstract that
does, and offers each with **Analyze it**; a work already in your library opens instead of being
analysed twice. A title is rarely enough: none of the references OpenAlex lists for the attention paper
names one of its concepts in the title, while their abstracts name three (residual connections, and
encoder-decoder models twice). An abstract match is shown with the sentence it rests on, quoted as
OpenAlex has it, because OpenAlex occasionally attaches an abstract to the wrong work and the sentence
lets you see that. **Concepts** in
the library header is the map across all of it: every concept more than one paper explains, with the
papers that explain it and a check mark where you studied it.

**A reading order.** A paper's primer is what it assumes; its glossary is what it uses and defines. When
one paper defines a concept that another assumes, reading the first one first makes the second easier.
So the concept map opens with a reading order for your library: each paper after the papers that define
what it assumes, the older paper first where nothing decides, and the first paper you have not finished
marked **Next**. Each step says why it comes where it does ("after *Attention Is All You Need*: it
assumes multi-head attention, which that paper defines"). Two papers that each define something the
other assumes are shown as a pair to read side by side, not put in an invented order, and papers nothing
connects are left out. In the Lab, **Read first** names the papers of your library that define what
this one assumes, and whether you have studied them.

![A reading order for the library](docs/images/reading-order.jpg)

**One idea, two names.** Matching by name keeps "scalar product" and "dot product" apart. **Names for
the same concept** on the concept map lets you link them: type the two names, or ask a model which names
in your library may mean the same thing. The model sees only the names and the definitions their papers
give; it proposes pairs with a reason, and each pair waits for you to say **Same concept** or
**Different**. A pair you call different is not proposed again. A large library's names are asked in
parts that fit one request, names with similar definitions in the same part, and the panel says if a
part could not be read. Linked names then count as one concept
everywhere: the concept notes, the map (where a paper's own name for it is shown), the reading order and
the reference suggestions. The links live in your library, not in any paper, and **Unlink** undoes one.

![Names for the same concept](docs/images/concept-aliases.jpg)

Nothing here is generated. Concepts are matched by name, from each paper's primer and glossary, with
case, hyphens, British and American spellings and plurals folded, never by meaning: two names for one
idea stay apart rather than risk joining two different ideas under one name. A suggested reference is
a match on its words, not a judgement of the work. Your study progress stays in your library, never
in a project file. Your agent reads the same links from your library:

```text
Which concepts in this Trace project have I already studied in my other papers, and what should I read next? Use the Trace plugin.
```

![Concepts across the library](docs/images/concepts.jpg)

### Read it as a narrative, with the source one click away

The paper's own figures sit beside the paragraph that argues them — the join is the claims they
share, not a guess about where a picture belongs.

Terms from the glossary and the primer open where they are used: click one and its definition, and
for a primer concept why this paper needs it, opens under the paragraph. Each section starts with
the concepts to know before reading it, taken from the claims it shares with the primer. The deep
report does the same. Nothing is generated for this; it all comes from the project.

![Visual story](docs/images/story.jpg)

### See where the evidence is thin

Trace's whole claim is that every sentence ties back to a page. The evidence health panel makes
that auditable instead of asking you to trust it: how many claims are verified rather than
needs-review, which pages between the first and last citation nothing ever reaches, which
collected claims the narrative never used, and which sections rest on a single claim. All of it
is computed from the project's own data — no model is asked, so a shared `.trace.json` reports
the same numbers offline.

In the studio, every thin section has a **Strengthen** button. It rewrites that section so it
cites at least two existing claims, one of them verified. If the rewrite is still thin, it is
refused. Where the evidence does not back a sentence, the model narrows the sentence instead.

![Strengthen a thin section](docs/images/strengthen.jpg)

```text
Strengthen the thin sections of my Trace project using the Trace plugin.
```

### See what a reader cannot learn from

Evidence health asks whether every sentence is tied to a page. **Learning health** asks whether a
reader can learn from the result, and like evidence health it is computed from the project alone:
which story sections no quiz question checks, whether the quiz asks about measured results, the
authors' interpretations and the paper's limitations (or only about the method), which playgrounds
show the same thing whatever the sliders say (every slider is swept over its range), which derivation
steps only restate their own formula, and which primer concepts nothing in the story, the report or
the quiz needs.

Each finding opens its fix with the request already written: **Point a question here** rewrites a
question that another question already duplicates so that it tests the unchecked section,
**Rewrite derivation** asks for rationales that say why each step follows, **Tie it to the paper**
rewrites a concept around the claims the paper relies on. The request is visible and editable in the
regenerate dialog, and the evidence stays locked. The shipped example has one honest finding: no
question asks about the training recipe. The screenshot adds two defects to show the other checks.

![Learning health](docs/images/learning-health.jpg)

### Check every quote against its page

`verified` is what the model says about its own claim. Trace also checks it mechanically: the text
of every page is extracted from the PDF (`pdftotext`), and each quote is searched for on the page it
cites, or the page next to it. Differences in spacing, hyphenation, ligatures and punctuation are
ignored; different words are not. A verified claim none of whose quotes can be found is kept and
marked needs-review. Nothing is ever upgraded, because a program can tell that a quote is there, not
that it supports the claim.

The result is written into the project, so a shared `.trace.json` shows that its quotes were checked
and which ones were not found, without the PDF. A project that was never checked says so instead of
showing a pass. A missing quote is not always an invented one: tables, equations and scanned pages
do not survive text extraction, which is why the claim is kept for you to look at.

**Show on the page** in the evidence drawer goes one step further: it renders the cited page and
marks the quoted words on it, so you read the sentence in its place instead of searching a page for
it. When the words are not on that page it says so and shows the page anyway.

It runs during every new analysis. For a project you imported, **Check the quotes against the PDF**
in the evidence health panel asks for the PDF; if almost nothing matches, it assumes the wrong file
and changes nothing. The shipped *Attention Is All You Need* example was checked against the arXiv
PDF: all 75 quotes were found.

```text
Verify the quotes of my Trace project against the PDF using the Trace plugin.
```

### See how each model's quotes held up

Every project records which model wrote it and which of its quotes were found on their page, so your
library already measures your models. **Model record** in the library adds that up per model: how many
quotes were found out of how many were checked, across how many papers, and how many of its claims a
reviewer approved or rejected. In a model team, each quote goes to the model that wrote it: the
technical model writes the method and results evidence, the evidence model the rest.

A rate from three quotes is not a rate from three hundred. Each rate shows the range the evidence is
consistent with, and models are sorted by the low end of it. Different models read different papers,
and a scanned or table-heavy paper lowers anyone's rate. So when the same paper was analysed with two
models, the two are lined up side by side: same PDF, same tables in the way. A project whose quotes were
never checked, whose evidence changed after the check, or that does not say which model wrote it is
listed with that reason, not counted. When you pick a model for a new analysis, its record appears
under the picker.

```text
Show me how each model's quotes held up in my Trace library using the Trace plugin.
```

### Let a person review the claims

A model says how sure it is, and a program can check that a quote is on its page. Neither can say
that the quote actually supports the claim. **Review** in the studio is where a person does that. The
queue puts first the claims whose quote was not found, then the ones the model was unsure about, then
the ones the narrative uses. You approve or reject each under your name, with an optional note.

A decision never changes the model's own `confidence`; it is stored next to it, so "the model was
sure" and "someone looked at the page" stay two different things. A rejected claim stays in the
ledger. Trace shows which sections still rest on it, and a rewrite of those sections is not allowed
to cite it again. Reviews are part of the `.trace.json`, so they travel with the project. An agent
cannot write them.

### Ask the evidence

Ask a question in the **Ask** tab. The model answering has not read the paper: it sees only the
claims, metrics and glossary collected in the project, must list the claims it used, and each one
opens its quote and page. When the collected evidence does not cover the question, the answer says
that instead of filling the gap from general knowledge. Claims a reviewer rejected are not shown to
the model. Because no PDF is sent, a local model can answer too. Nothing is saved.

### Take it with you

**Export** in the studio writes the project in the form you need next. All of it is computed from
the `.trace.json` alone, with no network and no model, and every claim carries its quote and page
wherever it goes.

- **Markdown report**: the deep report, method, equations, reported numbers, limitations and the
  full evidence ledger. Obsidian, Notion and GitHub import it as it is. Each claim shows all three
  trust marks separately: what the model said, whether the quote was found on its page, and what a
  reviewer decided.
- **Printable report (PDF)**: the same report as one page without scripts, laid out for paper.
  Print it and choose *Save as PDF*.
- **Slides**: one slide per story section with its first two sentences, the quotes behind it and
  the paper's figure when the section shares a claim with it. Arrow keys move, **N** shows the full
  text, printing gives one slide per page.
- **Jupyter notebook**: each formula playground as NumPy functions that start at the paper's own
  configuration, plus the sweep the playground draws. The code is generated from the parsed
  formula, so a project file cannot put arbitrary code into the notebook. A formula that cannot be
  translated exactly is left out and the notebook says so.
- **BibTeX / RIS** for Zotero, Mendeley, EndNote and LaTeX.
- **Anki flashcards** and the **interactive site**.

```text
Export my Trace project as slides using the Trace plugin.
```

### Study it with Anki

**Export → Anki flashcards** in the studio downloads an import file with one card per primer concept,
quiz question and glossary term, and a "Does the paper show this?" card for every common misreading.
The back of every card carries the quote and the page it rests on. In Anki, choose File → Import; the
file sets the deck, the note type and the tags itself.

```text
Make Anki flashcards from my Trace project using the Trace plugin.
```

### Compare two papers without being told which one wins

Pick two projects from the library and Trace lines them up: the same benchmark under the same
unit, the same term defined twice, each side's limitations. It never says which paper is right —
that would be interpretation. Every number carries the page it came from and both sources stay
visible.

### Line up more than two papers

Pick three to six projects and the comparison becomes a literature map. The papers are put in year
order and lettered. A benchmark that two or more of them report under the same name and unit is
tracked across them, each value with its page. Terms that recur with different definitions are shown
side by side, and so is what each paper says it cannot do. A value that grows over the years is not
presented as progress: the dataset, the setup and which direction is better are things the papers
say. Like the two-paper view, it is computed from the `.trace.json` files alone.

### Search what your papers claim

Switch the library search from **Papers** to **Claims** and it goes through every claim of every
paper you have analysed, together with their quotes. Ask which of your papers says anything about
layer normalization, and the answer is the claims themselves, each with its paper, page and quote.
Each one also shows the same three trust marks as in the project: what the model said, whether the
quote was found on its page, and what a reviewer decided. A rejected claim is still listed, last.
Every word you type must appear in the claim or its quote. Nothing but the claims is searched, and
no model is asked. Click a result and the project opens on that claim.

![Search the claims of every paper](docs/images/library.jpg)

### Group papers with tags

Give a paper a tag from its library card and the tag becomes a collection. Pick it to see only those
papers, search only their claims, or compare and map them in one click. Typing "nlp" joins an
existing "NLP" tag instead of starting a second one. Tags belong to your library, not to the paper:
they are kept in `~/.trace/library/tags.json`. So tagging a paper does not add a version to its
history, does not change its `.trace.json`, and never goes out with a published link or an export.

### Keep a growing library in order

Sort the library by when a paper was last updated, by title, or by the paper's own year, newest or
oldest first. The year is read from how it is written ("2017", "NeurIPS 2017"); papers without one go
last. **List** turns the tall cards into one line each, so a long library fits on a screen. Both
choices are kept in this browser.

Deleting a paper asks for no confirmation. The card goes at once, and **Undo** (or Ctrl/⌘+Z) brings
it back for eight seconds, with its history, tags and published links. Nothing is deleted on the
server until then. Leaving the library or closing the page completes the deletion.

### See what a paper builds on, and what built on it

**Citations** in the studio opens the paper's citation graph: the most-cited works it references on
one side, the most-cited works that cite it on the other, from OpenAlex. This is context, not
evidence. None of it comes from the paper's pages and the counts change, so it is fetched when you
open it, shown with the date, and never written into the project. A paper that OpenAlex cannot match
by DOI is matched by exact title only; a graph for the wrong paper would be worse than none.

**Analyse** on any work looks it up and loads its PDF into the upload screen. From an agent, the
same graph is in `context.json` after `prepare`, and on its own:

```text
Show me the citation graph of my Trace project using the Trace plugin.
```

### Rewrite one section without touching the evidence

Don't like one section of the story or the deep report? Regenerate just that section. The
evidence stays locked. By default the new version must cite exactly the claims the old one
did, so only the wording changes. You can also let it choose again from the claims already
collected, but it can never add a new fact. It goes through the same integrity checks as a
full generation, and you see the current and proposed versions side by side before anything
is replaced. The section request carries only the locked evidence, never the PDF, so a local
model can do this too. **Test model** sends a short request first and tells you how long a section
would take on that model, and whether it fits the time limit, before you wait for it. The
analysis screen has the same check for a whole analysis: **Test models** estimates the longest
step of every model you assigned, before the PDF is sent.

The same lock works on the learning layer. A primer concept, a quiz question, a derivation or an
equation in the technical appendix can each be rewritten on its own. Each keeps its own rules: a
quiz question needs the right number of correct options, a derivation stays attached to its
equation, and a concept other concepts build on keeps its subject.

Not sure how to ask for a better version? **Explain it differently** fills the request in one
click: *Simpler*, *With an analogy*, *With a worked example*, *More technical* or *Shorter* for a
section; *Harder*, *Easier* or *Test a misconception* for a quiz question; *Smaller steps* or
*Intuition first* for a derivation; *Explain each symbol* for an equation. Requests combine, and
opposite ones replace each other. Each one lands in the text box as a plain sentence, so you see
and can edit exactly what the model receives, and none of them loosens the evidence lock: a worked
example uses the paper's numbers, or says that its numbers are only illustrative.

![Regenerate a section](docs/images/regenerate.jpg)

```text
Rewrite the limitations section of my Trace project, shorter, using the Trace plugin.
Make the first quiz question of my Trace project harder using the Trace plugin.
```

### Go back to any earlier version

Every regenerated section, restore and import keeps the version it replaced. While you edit,
Trace keeps a snapshot every ten minutes. You can also name a version yourself. The history panel
shows what has changed since each version: which story and report sections, which claims, and
which primer concepts, quiz questions, derivations and equations. Open **Show the text** on a
change to see it word by word, with the older version struck through and the current one
highlighted. Restoring is itself a change, so a restore can be undone too. Changes an
agent makes through the plugin land in the same history.

![Version history](docs/images/history.jpg)

### Reuse a structure that worked

Save a story's structure as a template: the order of its sections, the visual each one uses and
the kinds of claims it rests on, plus the order of the deep report. The template carries no text.
Pick it when you analyse the next paper, or ask your agent to use it. Two templates are built in:
*Method walkthrough* and *Results briefing*. A template is checked against the integrity rules
before anything is generated, so a structure that could never pass is refused up front.
Saved templates can be edited later: add, remove or reorder sections, and change each one's
purpose, visual and claim kinds. The rules are checked as you edit. Built-in templates stay as
they are, and **Customize a copy** saves your own version. Projects already analysed with a
template keep their own copy of it.

![Edit a narrative template](docs/images/templates.jpg)

```text
Explain Denoising Diffusion Probabilistic Models as a results briefing using the Trace plugin.
```

### Publish a story with a link you control

**Publish** freezes a copy of the project behind an unguessable link that the Trace server itself
serves at `/p/<id>`. Later edits stay private until you update the link. You choose whether the
deep report, the technical appendix, the learning layer and the paper's own figures go out. The
evidence quotes always do, because a claim without its page is not something a reader can check.
You can unpublish a link, publish it again, let it expire after 7, 30 or 90 days, or delete it.
Removing the project closes its links too. An unpublished, expired and never-existing link all
return the same page, and the page asks search engines not to index it.

The link works for anyone who can reach that server. When the studio runs on your machine, that is
only you. When it is deployed somewhere public, it is everyone who has the link.

![Publish a story](docs/images/publish.jpg)

### Send someone a link to one claim

Every claim and every story section has its own anchor, in the studio and in the portable
single-file copy alike. The address bar tracks what is open, so the link is always there to copy.

### Read it the way you like

**Aa** in the header of the analysis screen, the library and a project sets the text size and the
theme.

- **Text size**: compact, default, large or larger (93.75% to 125%). Every size in the studio is on
  one type scale in `rem`, so this choice and your browser's own font size setting both enlarge
  everything together. The smallest text is 12 px.
- **Theme**: light, dark, or **System**, which follows your device and changes when it does. The
  choice is applied while the page loads, so a dark page never flashes white first. The standalone
  site and published links stay light: a shared story looks the same for every reader.
- **A readable colour for every paper.** Each paper has its own accent colour, and many of the
  palette's colours are pale. Fills and icons use the colour as it is. Text uses the same hue at a
  lightness that can be read: darker on the light theme, lighter on the dark one.
- **On a phone**, the Lab's sections (up to sixteen) are a labelled menu at the top instead of a
  row of unlabelled icons.

In both themes, text reaches at least 4.5:1 against its background (3:1 for large headings), the
WCAG AA level. Tests check the colour values, every paper colour as the browser draws it, and every
visible text on eight screens in both themes. Both choices are kept in this browser.

![The dark theme](docs/images/dark.jpg)

---

## Install in under a minute

Pick your agent. Two commands, then restart — the plugin is the same on all three.

<a id="claude-code"></a>

### Claude Code

```bash
claude plugin marketplace add Ahmet-Ruchan/trace-research-paper-studio --scope user
claude plugin install trace-paper-studio@trace-research-tools --scope user
```

Restart Claude Code. That is it.

<a id="codex"></a>

### Codex

```bash
codex plugin marketplace add Ahmet-Ruchan/trace-research-paper-studio --ref main
codex plugin add trace-paper-studio@trace-research-tools
```

Restart Codex or open a new session. You can also invoke the skill explicitly with
`$trace-paper-studio`.

<a id="antigravity-cli"></a>

### Antigravity CLI

Antigravity installs plugins from a directory, so clone first:

```bash
git clone https://github.com/Ahmet-Ruchan/trace-research-paper-studio.git
agy plugin install trace-research-paper-studio/plugins/trace-paper-studio
```

Confirm with `agy plugin list`, then restart the CLI or open a new session.
Do not have the CLI yet? `curl -fsSL https://antigravity.google/cli/install.sh | bash`

### Already installed? Update

```bash
# Claude Code
claude plugin marketplace update trace-research-tools
claude plugin update trace-paper-studio@trace-research-tools --scope user

# Codex
codex plugin marketplace upgrade trace-research-tools

# Antigravity CLI: pull, then reinstall from the same directory
git -C trace-research-paper-studio pull
agy plugin install trace-research-paper-studio/plugins/trace-paper-studio
```

Restart the agent afterwards so it loads the new skill.

**Requirements:** Node.js 20+, and `pdftotext` (from Poppler) for page-accurate extraction.
Without it the agent falls back to its own PDF reader.

```bash
brew install poppler        # macOS
sudo apt install poppler-utils   # Debian / Ubuntu
```

### Then ask

```text
Explain Attention Is All You Need using the Trace plugin.
```

```text
Take this paper and give me the output using the Trace plugin: ./paper.pdf
```

```text
Rewrite section 4 of that Trace project so it names the quadratic cost plainly.
```

```text
Here is how I understand section 2 of that Trace project: … Did I get it right?
```

```text
Which concepts of that paper have I already studied in my other Trace papers, and what should I read next?
```

```text
Publish a link to it without the paper's figures, expiring in 30 days.
```

When it finishes, the browser is already open — both the self-contained site and the full
application, with the project sitting in your Library. Nothing to export, nothing to import,
no server to start. The same folder keeps a portable `.trace.json` you can archive or share.

---

## Why it is different

| | Typical AI summary | Trace |
| --- | --- | --- |
| Provenance | Prose you have to trust | Page + exact quote per claim |
| Claim types | Blended together | Measured result / interpretation / background, labelled |
| Uncertainty | Hidden | Unsupported statements stay `needs-review` |
| Your role | Read | Predict, run the equations, test yourself, explain it back |
| Afterwards | Forgotten | Reviewed at growing intervals, linked to your other papers |
| Missing data | Plausible guess | Source dropped rather than guessed |
| Cost | Another API key | The model your agent already runs |

Three decisions do most of the work:

**Wrong data is worse than no data.** While building this, a metadata source returned another
paper's citation count for LoRA — 2,516 instead of 22,087. Rather than patch around it, that
lookup path is disabled entirely. If a source cannot answer reliably, it is omitted.

**Near misses get flagged, not guessed.** Ask for "denoising diffusion probabilistic models"
and arXiv will happily hand you *Improved* Denoising Diffusion Probabilistic Models. Resolution
searches the title field first, then requires a near-exact match with a clear margin over the
runner-up — otherwise it reports the candidates and asks.

**Imported projects are untrusted input.** A `.trace.json` can come from anywhere, so the
interactive maths is declarative: parsed by a restricted grammar and evaluated on a pure AST
with length, node and depth limits. Never `eval`, never `new Function`.

---

## The evidence chain

```mermaid
flowchart TD
    PDF["PDF · page-aware text"] --> EV["Evidence graph"]
    WEB["arXiv · publication data"] --> EV
    EV --> C["Claims<br/>page + exact quote"]
    EV --> M["Metrics<br/>value + context"]
    C --> R["Deep report"]
    C --> T["Technical appendix"]
    C --> S["Visual story"]
    C --> L["Learning layer"]
    M --> S
    M --> L
    R --> V{"Validation"}
    T --> V
    S --> V
    L --> V
    V -->|"fails"| X["Rejected · regenerate"]
    V -->|"passes"| OUT["Site + .trace.json"]

    style EV fill:#191b18,stroke:#191b18,color:#ffffff
    style V fill:#8c5c18,stroke:#8c5c18,color:#ffffff
    style X fill:#e75b37,stroke:#e75b37,color:#ffffff
    style OUT fill:#2e7254,stroke:#2e7254,color:#ffffff
```

Validation is not advisory. A story cannot cite a claim that does not exist, a comparison chart
cannot show a number absent from the evidence, and a playground cannot ship unless its formula
parses, references only declared parameters, and returns a finite value at the paper's own
configuration.

---

## The full application

The plugin is one way in. The web app adds generation with your own provider keys, an editable
narrative, and a local library. Projects are stored as files under `~/.trace/library`, shared by
Codex, Claude Code, Antigravity and every Trace Studio launch directory. Existing browser-only
projects migrate there automatically; removing a Library item removes its stored file, its
version history, its tags and your study progress on it, after an eight-second window to undo it.
Earlier versions live under `~/.trace/library/revisions`, tags in `~/.trace/library/tags.json`,
study progress and review cards in `~/.trace/library/study.json`, saved templates under
`~/.trace/templates`.

```bash
git clone https://github.com/Ahmet-Ruchan/trace-research-paper-studio.git
cd trace-research-paper-studio
npm install
npm run dev
```

Open `http://localhost:3000`. The built-in demo **is** the flagship project: press *Open the
example project* (or add `?sample=1`) and the fully enriched *Attention Is All You Need* loads —
English or Turkish, chosen from your browser language. Both files also ship as plain downloads
at `/examples/`, and any `.trace.json` imports through **Library → Trace JSON**.

**Workspaces:** `Lab` inspects the evidence and holds **Study**, **Concepts** and the learning
blocks, `Story` edits the narrative, `Preview` is the reading experience. The library header opens
**Review** (the cards due today, from every paper) and **Concepts** (the map of what your papers
share). **Regenerate** on a story section, or on a deep report section in `Lab`,
rewrites only that section against the locked evidence. The same button appears on primer
concepts, quiz questions, derivations and equations, and **Strengthen** in the evidence health
panel rewrites a thin section with more evidence. The history button in the header opens
earlier versions of the project. **Save as template** in `Story` keeps the structure for the next
paper. **Aa** sets the text size and the theme ([Read it the way you like](#read-it-the-way-you-like)).

**The analysis screen remembers you.** Reader, depth, language, the model or the model team, and the
narrative template of your last analysis come back for the next paper, in this browser. API keys are
never kept: the stored record has no place for one, and a test checks that a key typed into the form
is not in the browser's storage. Supporting sources and the template are under **More options**,
which opens by itself when your last analysis used a template.

<details>
<summary><b>Model providers</b></summary>

<br>

![Google](https://img.shields.io/badge/Gemini-8E75B2?style=flat-square&logo=googlegemini&logoColor=fff)
![OpenAI](https://img.shields.io/badge/OpenAI-412991?style=flat-square&logo=openai&logoColor=fff)
![Anthropic](https://img.shields.io/badge/Anthropic-191B18?style=flat-square&logo=anthropic&logoColor=fff)
![OpenRouter](https://img.shields.io/badge/OpenRouter-6566F1?style=flat-square&logo=openrouter&logoColor=fff)

Run everything on one model, or split the work across five roles — Evidence, Technical, Report,
Visual and Teaching — each with its own provider and key. Only Evidence and Technical read the PDF;
the other three work from the extracted evidence, so any of them can be a local model. Keys are used for the active request only;
they are never written to local storage or included in exports. The rest of the setup is
remembered in this browser for the next paper.

The plugin path needs none of this: it uses whatever model your agent is already running.

</details>

<details>
<summary><b>Manual bridge commands</b></summary>

<br>

Agents run these automatically; they are documented for debugging.

```bash
# Resolve from a name, download, collect published context
npm run trace:agent -- prepare --title "attention is all you need" --language en --depth deep

# Or by arXiv id, or from a local file
npm run trace:agent -- prepare --arxiv 1706.03762 --language en --depth deep
npm run trace:agent -- prepare --paper "paper.pdf" --language en --depth deep

# Or from a DOI, or a bioRxiv / medRxiv / PubMed Central / ACL Anthology / OpenReview link or id
npm run trace:agent -- prepare --doi 10.1101/2021.10.04.463034 --language en
npm run trace:agent -- prepare --source https://aclanthology.org/2020.acl-main.1 --language en

# Check every quote against its page and record the result in the project
npm run trace:agent -- verify --project "paper.trace.json" --paper "paper.pdf"

# Another form of the project: md, html (print to PDF), slides, ipynb, bib, ris, anki
npm run trace:agent -- export --project "paper.trace.json" --format slides

# The citation graph of a project, a DOI or a title
npm run trace:agent -- graph --project "paper.trace.json"

# How each model's quotes held up across the library, and what was left out
npm run trace:agent -- record

# Check a reader's own explanation of a section against the evidence: write a brief, let the agent
# write the feedback, then check it with the app's own rules
npm run trace:agent -- explain --project "paper.trace.json" --target story:<section-id> --text "<explanation>"
npm run trace:agent -- explain-check --brief "explanations/story-<section-id>.brief.json"

# Which of a project's concepts the reader studied in other papers, and the library's concept map;
# --suggest looks through the paper's references for works that teach the rest
npm run trace:agent -- concepts --project "paper.trace.json" --suggest
npm run trace:agent -- concepts

# The reader's learning statistics: reviews remembered, cards kept, the week ahead
npm run trace:agent -- progress

# Concept names across the library (in parts for a large one: --part 2), and the reader's decision that two of them are one concept
npm run trace:agent -- concepts --names
npm run trace:agent -- alias --a "Dot product" --b "Scalar product"

# --strict also requires the learning blocks the depth mandates
npm run trace:agent -- validate --strict --project ".trace/jobs/paper/paper.trace.json"
npm run trace:agent -- deliver --project ".trace/jobs/paper/paper.trace.json"

# Rewrite one section with the evidence locked: write a brief, let the agent
# write the section, then splice it in with the app's own checks
npm run trace:agent -- section --project ".trace/jobs/paper/paper.trace.json" --target story:<section-id>
npm run trace:agent -- splice --brief ".trace/jobs/paper/revisions/story-<section-id>.brief.json"
# Targets also cover primer:<id>, quiz:<id>, derivation:<id> and equation:<id>.
# validate lists thinSections; --goal strengthen rewrites one with more evidence
npm run trace:agent -- section --project ".trace/jobs/paper/paper.trace.json" --target story:<section-id> --goal strengthen

# Narrative templates: list them, generate with one, save one from a project
npm run trace:agent -- templates
npm run trace:agent -- prepare --arxiv 1706.03762 --language en --depth deep --template method-walkthrough
npm run trace:agent -- save-template --project ".trace/jobs/paper/paper.trace.json" --name "Reading group"

# Publish a shareable link, served by the studio at /p/<id>
npm run trace:agent -- publish --project ".trace/jobs/paper/paper.trace.json" --no-figures --expires-days 30
```

With `--title`, the command reports which paper it matched, the runner-up candidates and a
`confident` flag. Re-run with `--pick <n>` or `--arxiv <id>` to switch.

`deliver` brings up everything in one shot: the portable JSON, the self-contained site on a
loopback-only server, and the studio — reused if already running, otherwise started — with the
project handed straight into its Library. Once a studio has been started successfully its
location is remembered, so later deliveries find it from any directory.

Each paper also receives one accent from a 20-color palette. Trace shuffles the palette once,
uses every color before repeating, and remembers a paper by its PDF fingerprint so regenerating
the same paper keeps the same visual identity.

If no studio can be started, the delivery still succeeds and the agent asks whether to set one
up. Say no and the standalone site still carries a **Show me the command** strip: one click
gives the terminal command, with a copy button. That happens when no copy
of the repository has its dependencies installed — the plugin's own clone ships without them.
`--install-app` installs them once. `--no-app` limits delivery to the standalone site,
`--no-open` suits headless environments, and `stop --site <dir>` shuts down what it started.

</details>

---

## Development

```bash
npm run dev              # development server
npm run lint             # eslint
npm run test             # vitest
npm run build            # production build
npm run build:artifacts  # regenerate the committed viewer + validator
npm run check            # everything above, in order
npm run test:e2e         # browser tests against the production build (run after build)
npm run version:set -- 0.24.0  # write one version into the package and every plugin manifest
npm run test:plugins -- --codex "$(which codex)" --claude "$(which claude)" --agy "$(which agy)" [--live]
```

`test:plugins` installs the plugin into each agent CLI you pass, in a throwaway home directory, the
way a user would. It then asks the agent how it sees the plugin (version, skill, description,
starter prompts) and treats any warning that names the plugin as a failure, because an agent that
cuts a description short or drops a field says so only in a log line. Finally it runs the bridge
from the installed copy, outside the repository, so a copy that depends on a repository file fails
there. The `plugins` workflow runs it on every push with pinned CLI versions (Antigravity's installer
always takes the latest, so its pinned release is downloaded directly and checked against its
SHA-512), and weekly with the latest ones; the job summary lists the versions tried.

Add `--live` to also open a real model session: the agent is asked to export the example project
with the skill, and the file must be byte for byte what the bridge writes, so a model that wrote it
by hand fails. It needs `OPENAI_API_KEY` for Codex and `ANTHROPIC_API_KEY` for Claude Code, and
reports `skip` without them; the weekly and manual runs pass `--live` with the repository secrets of
those names. Antigravity CLI is not tried live: `agy -p` needs a Google sign-in, not a key. There
the check stops at what can be verified without one: the plugin installs, its skill is processed and
the bridge runs from the installed copy.

<details>
<summary><b>Architecture notes worth knowing before contributing</b></summary>

<br>

**Colours and type sizes are tokens, and tests hold them.** `src/visuals/tokens.css` is the one
source for the studio, the standalone viewer and published pages: the type scale, the colours and
their dark values. `src/lib/type-scale.test.ts` fails on a font size in `px` or below 12 px, on a
paper colour used raw as text, on a text and background pair under 4.5:1 in either theme, and on
the two copies of the dark values (chosen, and from the device) drifting apart. Add a colour as a
token with a dark value rather than as a literal in a rule.

**One render source, two runtimes.** The visual grammars and interactive components live in
`src/visuals/` and are compiled twice — as real React for the app, and through preact for the
standalone viewer. A grammar is written once instead of three times. `src/visuals/**` is an
eslint-restricted zone: no `next/*`, no `lucide-react`, no `node:*`.

**The plugin validator is the schema, not a copy of it.** `plugins/.../scripts/generated/validator.mjs`
is a bundle of the application's actual Zod schema and integrity rules. A rule cannot pass one
side and fail the other.

**Two files are generated but committed**, because the plugin must stay dependency-free at run
time:

| Artifact | Source | Rebuild |
| --- | --- | --- |
| `plugins/.../assets/viewer.html` | `viewer/` + `src/visuals/` | `npm run build:viewer` |
| `plugins/.../scripts/generated/validator.mjs` | `src/lib/schema.ts` + integrity rules | `npm run build:validator` |

Never edit them by hand. `npm run check` rebuilds both and fails if the committed copies drifted.

</details>

<details>
<summary><b>Project structure</b></summary>

<br>

```text
src/
├── app/                        # Next.js app router, generation API, design system
├── components/                 # Workspace shell, Lab, Story editor, Preview, Library
├── visuals/                    # SHARED render layer — compiled for both hosts
│   ├── tokens.css              #   type scale, colours and the dark theme
│   ├── visual-renderer.tsx     #   eleven visual grammars
│   ├── interactive/            #   playground · simulation · data explorer
│   ├── teaching/               #   primer · derivations · quiz · misreadings · study path · guide
│   ├── math.tsx                #   LaTeX → MathML with an output allowlist
│   └── chart.ts                #   dependency-free SVG scales and paths
└── lib/
    ├── schema.ts               # Evidence, report, story and learning contracts
    ├── formula.ts              # Restricted grammar + pure AST evaluator
    ├── generation-validation.ts# Cross-contract integrity checks
    ├── plugin-validator-entry.ts# Bundled into the plugin — no mirrored rules
    └── ...

viewer/                         # Standalone viewer app (preact build target)
scripts/                        # build-viewer · build-plugin-validator · drift check
public/examples/                # Flagship project: built-in demo, download, test fixture
plugins/trace-paper-studio/     # Plugin for all three agents: skill, contract, bridge
```

Keep local PDFs under `ML Research Papers/`; that directory is git-ignored.

</details>

---

## Run it on a server

```bash
docker compose up --build        # http://localhost:3000, library kept in a volume
```

The image includes Poppler, so the quote check and local-model reading work out of the box. The
library, templates and published links live in `/data` (`TRACE_DATA_DIR`); mount a volume there.
`railway.json` builds the same Dockerfile on Railway with `/api/health` as the health check; any
host that runs a Dockerfile works the same way.

Trace has no accounts. On your own machine that is fine. On a server anyone can reach, set
`TRACE_ACCESS_PASSWORD`: the studio and its API then ask for that password (HTTP Basic, any user
name), while `/p/<id>` published links and the health check stay open. Use HTTPS in front of it.
Provider keys are still typed into the browser by whoever uses the studio and are never stored on
the server.

## Security and trust model

- Imported `.trace.json` files are untrusted input. Interactive maths is declarative and
  evaluated on a restricted AST — never `eval` or `new Function`.
- Paper resolution reaches an allowlisted set of hosts over HTTPS only, verifies every redirect
  against that allowlist, caps the download while streaming, and checks the `%PDF-` signature.
  Downloaded files are never executed. The list holds arXiv, the metadata APIs and a few
  open-access repositories, and no publisher sites. The studio's paper search goes through the same
  module, so a PDF address sent by a browser passes the same checks.
- A repository that asks for a browser check is not worked around. The PubMed Central archive is
  unpacked in memory with its uncompressed size capped.
- Every quote is searched for on the page it cites, for every provider. A claim whose quotes are not
  found cannot stay verified, and the check never upgrades a claim. A PDF uploaded for a re-check is
  read in a temporary directory and deleted; if almost no quote matches, nothing is changed.
- Exports escape project text in Markdown, HTML and BibTeX. The printable report has no scripts; the
  slide deck's only script is fixed navigation code. Notebook code is generated from the parsed
  formula tree: numbers, declared parameters, arithmetic and a fixed table of NumPy functions.
- A reviewer's decision lives at the project root, not inside the claim, so no model output schema
  can produce an "approved" claim. The question in **Ask** is passed to the model as data, and an
  answer that cites an unknown or rejected claim is refused.
- `TRACE_ACCESS_PASSWORD` puts the studio and its API behind one shared password, compared in
  constant time. It is not an account system: published links and the health check stay open.
- A context source that returns an unreliable record is dropped rather than trusted.
- LaTeX is rendered to MathML and passed through a tag and attribute allowlist.
- Supplementary URLs are restricted by protocol, DNS/IP range, redirect count, response type,
  timeout and payload size.
- PDF and web content are treated as source material, never as instructions.
- Provider keys are used only for the active request. They never appear in exports or in the
  browser's storage: the remembered analysis setup has no field for a key.
- The profile and the work log live in `~/.trace`, behind the same password as the rest of the API.
  A photo is accepted only as a small JPEG, PNG or WebP image (the browser crops it to 192 pixels),
  a session cannot end in the future, and an import adds sessions without removing any; a profile
  in an imported file is taken only into an empty one.
- Verified paper claims require an excerpt and a visible page number.
- Comparison visuals may only use numeric values already recorded in evidence.
- A publication is a filtered copy: blocks the author leaves out are removed from the served file,
  not hidden. Pages are sent with a strict Content-Security-Policy, `frame-ancestors 'none'`,
  `no-store` and `noindex`, and a missing, unpublished or expired link is indistinguishable.

> No extraction system replaces reading the original paper. Trace makes checking it faster and
> more visible; it does not remove the need for it.

---

## Status

Working today: evidence contracts, deep report, technical appendix, eleven visual grammars, the
learning layer (primer, derivations, playgrounds, simulations, quiz, common misreadings, application
guide), predictions before every chart and derivation step, a guided study path with saved
progress, explanations in the reader's own words checked against the evidence, spaced review across
the library, concepts linked across papers with reading suggestions from the references and a reading order for
the library, learning statistics, a work timer (focus rounds with breaks, countdown, stopwatch,
alarms) with a profile and a calendar of the days worked, a learning
health panel, a reading drill made from the evidence, terms defined where they are used, the
paper's own figures placed beside the prose that argues them, the evidence health panel, a
mechanical check of every quote against its page with the quote marked on the page image, a claim
review queue, questions answered from the collected evidence only, exports (Markdown and printable
reports, slides, Jupyter notebook, BibTeX/RIS, Anki flashcards), a Docker image with optional password protection,
side-by-side comparison of two projects, section-level regeneration with evidence locking (story, report and learning items),
strengthening thin sections, project version history with word-level diffs, editable narrative
templates, model speed tests before generation, shareable publications with
publication controls,
per-claim and per-section permalinks, resolution from a paper's name, DOI or repository link
(arXiv, bioRxiv, medRxiv, PubMed Central, ACL Anthology), literature maps of up to six projects,
citation graphs, a local library with claim search across papers, tags, sorting, a list view and
undoable deletion, a per-model record of how quotes held up, a dark theme and an adjustable text
size, the native plugin for Codex / Claude Code / Antigravity CLI, and generation through Gemini, OpenAI, Claude, OpenRouter and a local model
server (Ollama, LM Studio, llama.cpp).

A local model can run every stage, so an analysis can stay on your machine from start to finish.
Local servers have no file-upload endpoint and most open-weight models cannot see a document, so in
the two stages that read the paper a local model gets the text extracted from the PDF (`pdftotext`,
from Poppler), with page boundaries kept. If the paper does not fit the model's context, each stage
gets the pages that matter to it and is told which pages it did not see. Because the text is at
hand, every quote is searched for on the page it cites; a claim whose quote cannot be found is kept
but marked needs-review. Figures, layout and some equations are lost on this path, and a scanned PDF
is refused. A cloud provider still gets the PDF itself. Give the model a 32K context or more; set
`TRACE_LOCAL_PAPER_CHARS` to change how much text a stage may receive (default 60,000 characters).
Only a loopback address is accepted — the request leaves the Trace server, and "local model" means
this machine.

Not there yet: accounts, access control beyond an unguessable link, or cloud-synced persistence.

*Attention Is All You Need* ships fully enriched in `public/examples/`, in English and Turkish,
serving at once as the built-in demo, a downloadable artifact and the test fixture — covered
by tests so neither can silently fall behind the schema.

The interface is always English. The analysis is not: **it comes back in the language you wrote
to your agent in** — any language, identified by its BCP-47 tag, with `pt-BR` kept distinct from
`pt-PT`. Nothing is guessed: the bridge cannot see your conversation, so `--language` is required
and fails loudly rather than picking a default that would be wrong for somebody. Quoted evidence
is the one exception; an excerpt stays verbatim in the source's own language, because translating
a quotation breaks the chain back to the page. Content still sorts and uppercases by its own
locale — casing follows the text, not the chrome — and a test scans the interface layer to keep
the two from mixing.

## Roadmap

- [x] Local and open-weight provider adapters
- [x] Side-by-side paper comparison
- [x] Section-level regeneration with evidence locking
- [x] Project revisions and reusable narrative templates
- [x] Shareable hosted stories with publication controls
- [x] Papers beyond arXiv, literature maps, citation graphs and fully local analysis
- [x] Quotes checked against the page text; Docker image and password protection
- [x] Claim review by a person, quotes shown on the page, evidence-locked questions, Anki export
- [x] Exports: reports, slides, runnable notebook, citations
- [x] Claim search across the library, tags, and a per-model quote record
- [x] Dark theme, adjustable text size, contrast-checked colours
- [x] Learning in the studio: a teaching model, traced numbers, a quiz that teaches, terms in place, a guided study path, spaced review
- [x] Learning that sticks: predictions first, common misreadings, learning health, explaining it back, concepts across papers
- [x] Study across the library: reading order, confirmed concept aliases, learning statistics, progress carried between devices
- [x] A work timer and a profile: focus rounds with breaks, countdown, stopwatch, alarms, and a calendar of the days worked
- [ ] Team review with accounts and shared annotations

---

## Star history

<a href="https://star-history.com/#Ahmet-Ruchan/trace-research-paper-studio&Date">
  <img src="https://api.star-history.com/svg?repos=Ahmet-Ruchan/trace-research-paper-studio&type=Date" alt="Star history chart" width="640">
</a>

## Contributing

Issues and pull requests are welcome. Run `npm run check` before opening a PR — it rebuilds the
generated artifacts, lints, tests and builds, and will tell you if a committed artifact drifted.

## License

[MIT](LICENSE) © Ahmet Ruçhan Avcı

<div align="center">
<br>
<sub>If Trace saved you an afternoon of cross-checking, a star helps other people find it.</sub>
</div>
