# Lingvo browser helpers

- Main entry: card content projection, German term formatting, answer comparison,
  stable phrase tiles and owned browser speech synthesis.
- `./scheduler`: FSRS-6 interval previews using **ts-fsrs 5.4.2**.
- `./csv`: bounded Papa Parse imports and formula-escaped exports, loaded on demand.
- `./ai-input`: native-language prompts and bounded `||` templates for external
  AI-assisted entry. Papa Parse handles quoted fields; content validation is
  shared with CSV. Existing folder names resolve to IDs before applying a card.

The editor owns clipboard feedback and draft updates. Applying a validated
template fills the form without saving; Kerno validates the eventual save.

Kerno is authoritative for due dates and history. The browser only previews the
four possible intervals. Both implementations use the published FSRS-6 default
weights, retention `0.9`, maximum interval `36500` days, learning steps `1m, 10m`,
relearning step `10m`, short-term scheduling enabled and fuzz disabled.

The contract stores `learningSteps` as a zero-based index, matching ts-fsrs.
Kerno adapts that index to Go FSRS's remaining-step count. Dates are ISO timestamps;
an untouched card has `lastReview: null`. Review requests carry a stable UUID,
card revision and direction. Clients cannot set saved schedule parameters.

Upgrade the pinned browser scheduler and server scheduler together. Revisit
configuration, step representation and UTC day-boundary behaviour when upgrading.
Never compensate for a library change with a second handwritten scheduling formula.
See [Lingvo's ownership and workflows](../../apps/lingvo/README.md).
