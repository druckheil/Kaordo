# Lingvo

Lingvo is Kaordo's private language-learning application at `/lingvo/`.
German is the initial learning language. Users choose Russian or English as their
native language. Each `(user, learning language, native language)` combination
has a separate dictionary, card collection, preferences and review history,
stored on the server as opaque encrypted records and opened on approved devices.

## Learning

- Words: reveal the translation, practise in both directions or listen before
  revealing. Swipe left/right or use the four FSRS grades: Again, Hard, Good, Easy.
- Phrases: arrange shuffled word tiles or write the German answer. Hints and
  answer comparison help users choose an honest recall grade.
- German nouns have coloured articles and plural forms. Verbs and phrases can
  include grammar, example sentences, translations and personal notes.
- Browser speech synthesis plays German pronunciation where available. Voice
  availability and pronunciation quality depend on the browser and installed voices.
- Undo restores the last saved answer within ten minutes, provided that card has
  not changed since the answer. Card creation and review saves have stable
  request IDs for retries.
- Daily goals, streaks and a 28-day activity view use the dictionary's chosen
  time zone. Goals count reviews of both words and phrases and do not cap practice.

## Dictionary and library

Search, edit, delete and organise cards into folders. Known and paused cards stay
outside the due queue; returning them to practice preserves their schedule.
Deleting a folder keeps its cards. Deleting a card removes its schedule while
retaining historical review totals.

The compact language-pair menu keeps dictionary selection and adding another
pair secondary to learning. Card editors show the essential fields first;
grammar, plurals, examples and notes live under More details. Article selection
uses a native Radio Group, and selecting der/die/das identifies a noun without
requiring a separate word-type choice. On constrained screens or with expanded
details, only the form body scrolls; its header and save actions remain visible.

### AI-assisted card entry

The editor's AI input copies a prompt for the selected word/phrase, native
language and folder. Give it to ChatGPT, paste the returned record and choose
Apply. Apply validates and fills the form, including More details; review the
result before choosing Add card or Save card. It does not save automatically.

The prompt specifies every content field in this order:

```text
kind||german||translation||folder||partOfSpeech||article||plural||grammar||example||exampleTranslation||notes||status
```

Empty fields retain their separators. Fields containing `||`, quotes or newlines
use CSV quoting. A folder must match an existing folder name or remain empty;
applying a template does not create folders. The input accepts one record of
at most 8,192 characters, with an optional matching header or Markdown code
fence. Invalid replies leave the current form unchanged. Clipboard failures
expose the prompt for manual copying. This workflow uses an external AI chosen
by the user; Lingvo makes no AI service requests.

The original A1–A2 starter library contains **8 sets and 76 cards**: 44 words and
32 phrases. Add a complete set or select individual cards, including marking
already familiar content as known. Reimporting a set preserves existing cards
and their progress.

CSV import accepts up to 500 cards and 1 MiB. Required headers are `term` and
`translation`. Optional headers are `kind`, `partOfSpeech`, `article`, `plural`,
`grammar`, `example`, `exampleTranslation`, `notes` and `status`. An article implies
`noun` when part of speech is omitted. Imported duplicates use stable content keys.
CSV export includes card content and status; it is not an export of learning
history or folder membership. Spreadsheet formulas are escaped during export.
A dictionary is bounded to 10,000 cards and 100 folders.

## Ownership

`packages/api-client` owns typed, authenticated requests and TanStack Query
options. `packages/lingvo-client` owns German presentation, phrase comparison,
pronunciation, CSV handling and AI template generation/parsing. CSV and AI input
share content validation and Papa Parse. Its separate scheduler entry loads `ts-fsrs`
only during practice. Views, editors and transfers are lazy Svelte components.
`packages/ui` supplies Rhea/Bits UI Dialog, Alert Dialog, Radio Group, Toggle Group,
Dropdown Menu, Slider, Progress and shared Lucide icons. Card turns, word-tile
movement and feedback respect reduced-motion preferences.

`study-state` owns the due queue, stable review request IDs, revision recovery,
undo and request cancellation. `Study` owns card presentation, pronunciation,
keyboard/drag interaction and focus. Interval previews and saved schedules use
the same pinned ts-fsrs configuration on the device.

`private-dictionary` owns encrypted card/review transactions, history, timezone
regrouping and authoritative FSRS-6 scheduling through ts-fsrs. Kerno owns access
and revision-checked opaque storage; it cannot schedule unreadable cards.
Kerno serves only the static German starter catalog. Server ciphertext keeps the dictionary
available on other approved/recovered devices; the browser is not its only copy.

URL parameters select dictionary, view, study kind and optional folder. SvelteKit
navigation keeps those choices compatible with reload and Back/Forward.
Account teardown cancels requests, clears this application's query cache and
stops owned speech playback.

## Research and boundaries

The learning flows were informed by the official [DuoCards learning guide](https://app.duocards.com/library/s/how-to-make-language-learning-with-flashcards-as-effective-as-possible)
and [DuoCards FAQ](https://www.duocards.com/en/faqs/). Lingvo uses its own interface
and starter content. It uses FSRS instead of copying DuoCards' proprietary review
intervals. See the [ts-fsrs project](https://github.com/open-spaced-repetition/ts-fsrs)
and [Go FSRS project](https://github.com/open-spaced-repetition/go-fsrs).

This implementation covers personal vocabulary and phrase practice. DuoCards'
AI tutor, automated translation, video/article ingestion, community content,
offline synchronisation and mobile subscriptions are not implemented here.
Other learning languages and native-language catalogues require content and
contract additions. All application UI remains English.

## Local development

Run `pnpm dev` from the repository root, sign into Kaordo and open
`http://localhost:8765/lingvo/`. The shared launcher applies migration 016 and
starts Lingvo's Vite server on loopback port 18770. Encryption storage also needs
migrations 020–025 and an approved device; see [encryption and recovery](../../docs/encryption.md). Restart an older running
launcher after adding this module. `pnpm build:pages` includes Lingvo in the
combined static artifact; production release checks require its page and API.

`pnpm --filter @kaordo/lingvo check` checks Svelte and TypeScript;
`pnpm --filter @kaordo/lingvo build` compiles the static app. Functional tests
are a separate verification step; compilation alone does not establish browser behaviour.
