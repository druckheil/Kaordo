-- Preserves CSV retry identity while separating field boundaries from allowed multiline text
BEGIN;

UPDATE lingvo_cards
SET source_key = 'csv:v2:' || encode(sha256(
    convert_to(kind, 'UTF8') || '\x00'::bytea ||
    convert_to(lower(term), 'UTF8') || '\x00'::bytea ||
    convert_to(lower(translation), 'UTF8')
), 'hex')
WHERE source_key ~ '^csv:[0-9a-f]{64}$';

COMMIT;
