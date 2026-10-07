-- Stores private language dictionaries, cards and transactional FSRS review history
BEGIN;

CREATE TABLE IF NOT EXISTS lingvo_dictionaries (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    learning_language text NOT NULL CHECK (learning_language = 'de'),
    native_language text NOT NULL CHECK (native_language IN ('en', 'ru')),
    daily_goal integer NOT NULL DEFAULT 20 CHECK (daily_goal BETWEEN 5 AND 200),
    time_zone text NOT NULL DEFAULT 'UTC' CHECK (char_length(time_zone) BETWEEN 1 AND 100),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (user_id, learning_language, native_language)
);

CREATE TABLE IF NOT EXISTS lingvo_folders (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    dictionary_id uuid NOT NULL REFERENCES lingvo_dictionaries(id) ON DELETE CASCADE,
    name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (id, dictionary_id),
    UNIQUE (dictionary_id, name)
);

CREATE TABLE IF NOT EXISTS lingvo_cards (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    dictionary_id uuid NOT NULL REFERENCES lingvo_dictionaries(id) ON DELETE CASCADE,
    folder_id uuid,
    kind text NOT NULL CHECK (kind IN ('word', 'phrase')),
    term text NOT NULL CHECK (char_length(term) BETWEEN 1 AND 300),
    translation text NOT NULL CHECK (char_length(translation) BETWEEN 1 AND 500),
    part_of_speech text NOT NULL DEFAULT '' CHECK (part_of_speech IN ('', 'noun', 'verb', 'adjective', 'adverb', 'other')),
    article text NOT NULL DEFAULT '' CHECK (article IN ('', 'der', 'die', 'das')),
    plural text NOT NULL DEFAULT '' CHECK (char_length(plural) <= 100),
    grammar text NOT NULL DEFAULT '' CHECK (char_length(grammar) <= 500),
    example text NOT NULL DEFAULT '' CHECK (char_length(example) <= 500),
    example_translation text NOT NULL DEFAULT '' CHECK (char_length(example_translation) <= 500),
    notes text NOT NULL DEFAULT '' CHECK (char_length(notes) <= 1000),
    source_key text CHECK (char_length(source_key) <= 100),
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'known', 'suspended')),
    schedule jsonb NOT NULL CHECK (jsonb_typeof(schedule) = 'object'),
    due_at timestamptz NOT NULL,
    revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CHECK (article = '' OR (kind = 'word' AND part_of_speech = 'noun')),
    FOREIGN KEY (folder_id, dictionary_id) REFERENCES lingvo_folders(id, dictionary_id),
    UNIQUE (dictionary_id, source_key)
);
CREATE INDEX IF NOT EXISTS lingvo_cards_dictionary_idx ON lingvo_cards (dictionary_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS lingvo_cards_due_idx ON lingvo_cards (dictionary_id, kind, due_at, id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS lingvo_cards_folder_idx ON lingvo_cards (folder_id) WHERE folder_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS lingvo_cards_term_search_idx ON lingvo_cards USING gin (lower(term) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS lingvo_cards_translation_search_idx ON lingvo_cards USING gin (lower(translation) gin_trgm_ops);

CREATE TABLE IF NOT EXISTS lingvo_reviews (
    id uuid PRIMARY KEY,
    dictionary_id uuid NOT NULL REFERENCES lingvo_dictionaries(id) ON DELETE CASCADE,
    card_id uuid REFERENCES lingvo_cards(id) ON DELETE SET NULL,
    rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 4),
    direction text NOT NULL CHECK (direction IN ('recognition', 'recall', 'listening', 'phrase')),
    previous_schedule jsonb NOT NULL,
    resulting_revision bigint NOT NULL CHECK (resulting_revision > 1),
    reviewed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    undone_at timestamptz
);
CREATE INDEX IF NOT EXISTS lingvo_reviews_activity_idx ON lingvo_reviews (dictionary_id, reviewed_at DESC) WHERE undone_at IS NULL;
CREATE INDEX IF NOT EXISTS lingvo_reviews_card_idx ON lingvo_reviews (card_id, resulting_revision DESC) WHERE undone_at IS NULL;

COMMIT;
