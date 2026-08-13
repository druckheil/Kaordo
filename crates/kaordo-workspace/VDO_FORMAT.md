# VDO object format (internal draft 0.x)

A basic knowledge object is stored at
`objects/<h0h1>/<h2h3>/<64-character-hash>.vdo`, where `hash` is the lowercase
BLAKE3 digest of the object's 16 UUID bytes. Object identifiers are UUIDv7.

All multi-byte integers in the fixed header and section table are big-endian:

| Offset | Size | Meaning |
| ---: | ---: | --- |
| 0 | 4 | Magic `VDO\0` |
| 4 | 2 | Format version (`1`) |
| 6 | 2 | Section count (`1` initially, `2` after editor content is saved) |
| 8 | 2 | Section kind (`1`, metadata) |
| 10 | 2 | Section version (`1`) |
| 12 | 2 | Flags (`1`, required) |
| 14 | 2 | Reserved (`0`) |
| 16 | 4 | Section payload offset (`56`) |
| 20 | 4 | Section payload byte length |
| 24 | 32 | BLAKE3 checksum of the section payload |
| 56 | N | Deterministic CBOR metadata payload |

The 48-byte descriptor beginning at offset 8 repeats for each section, and
payload offsets begin after the complete table. Readers accept at most 32
sections. Unknown optional sections are bounds- and checksum-validated and then
skipped; an unknown required section makes the object unsupported.

The required metadata section is a fixed CBOR array:

`["kaordo.knowledge-object", 1, uuid-bytes, title, created-at-unix-ms]`

Edited objects also contain an optional kind `2`, version `1` document section:

`["kaordo.object-document", 1, document-json]`

The JSON is a versioned editor document capped at 192 KiB. Version `1`
preserves legacy object-local rectangles and rich text for migration. New
canvas elements live in the workspace canvas document instead. An optional
`frame` stores the object's resizable width and height. Older objects without
this section open with an empty document and the default frame.

Workspace canvas state is stored separately at `.kaordo/canvas.json`.
Its version `1` envelope contains `elements` and `placements`. Rectangle and
rich-text elements without `parentObjectId` use workspace coordinates. An
element with `parentObjectId` uses coordinates local to that object's tray, so
moving the object moves its attached elements without rewriting each element.
Text stores sanitized inline formatting, base font size, alignment, color, and
its editable frame. Removing an element from the tray clears the relationship
and converts it back to workspace coordinates. Placements persist object
position and frame size. The document is capped at 4 MiB and committed with a
synced same-directory temporary file followed by an atomic rename.

Readers reject unknown versions, trailing data, bad checksums, objects larger
than 256 KiB, metadata larger than 16 KiB, non-deterministic CBOR,
non-RFC-compatible UUIDv7 identifiers, and paths that do not match the
identifier hash. Titles are stored trimmed, may not be blank or contain control
characters, and are limited to 200 UTF-8 bytes. Writers commit through a
same-directory temporary file and an exclusive rename so an existing object is
never replaced during creation. Editor updates use a synced same-directory
temporary file followed by an atomic rename. This format is not yet stable.
