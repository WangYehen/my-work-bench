# Vault integration data contracts

This document records the contract between the Workbench UI, the local Vault
index, and the checked-in example Vault. It is intentionally descriptive: it
does not create missing values and it does not turn unavailable metrics into
zeroes.

## Canonical index document

`server/vault-index.mjs` is the adapter boundary. It reads files under the
configured Vault root and emits a public document shape:

```text
id, path, fileName, extension, previewKind, title, excerpt,
layer, section, kind, type, status, createdAt, updatedAt,
frontmatter, wikiLinks, backlinks, isArchived
```

The adapter preserves `null` for unknown scalar values, uses empty arrays for
missing collections, sanitizes absolute Vault paths before returning data, and
skips private/system directories. Document IDs are derived from the relative
path, so the source path remains the stable join key.

## Page contracts

| Route/page | Read API | Required response shape | Vault mapping |
| --- | --- | --- | --- |
| `/` Overview | `/api/overview`, `/api/graph`, `/api/tasks`, calendar status/events, Outlook status | `data.metrics`, `data.wikiStatus` (`active`, `needsReview`, `deprecated`, `unlabeled`, `total`), `data.recent[]`, `data.qualityNotices[]`; graph has `nodes[]`, `edges[]`, `stats` | `wiki/*` knowledge pages, `10_raw/*`, `40_topics/*`; tasks/calendar/mail are separate local/integration stores |
| `/wiki` | `/api/collections/wiki` | `total`, `groups[]`, `items[]` of indexed documents | `wiki/<formal-section>/*.md`, where formal sections are `sources`, `entities`, `concepts`, `topics`, `analyses`, `comparisons`, `questions`, `conflicts`, `cases`, `diagnoses`, `frameworks` |
| `/materials` | `/api/materials`, `/api/materials/folder`, `/api/material-reading-queue` | folder metadata, `folders[]`, `recent[]`, `items[]`, queue state | `10_raw/**` except books and social-insight reports; folder names are data, not inferred categories |
| `/books` | `/api/books` | `books[]`, each with `chapters.zh[]/en[]`, `chapterCount`, `languages[]`, optional `original` and cover | `10_raw/books/<book>/**`; chapter order comes from filenames; book/author/language only come from frontmatter when present |
| `/topics` | `/api/collections/content` | `total`, `groups[]`, `items[]` with topic pipeline fields | `40_topics/**/*.md`; `pipelineStage`, filming and publication flags are derived only from explicit frontmatter/content markers already implemented by the indexer |
| `/graph` | `/api/graph` | `nodes[]`, `edges[]`, `stats` | formal `wiki` pages and resolved Obsidian `[[links]]`; unresolved links are not fabricated into nodes |
| Search palette | `/api/search` | `query`, `total`, `items[]` | indexed title, excerpt, path, section, tags, and links |
| Document reader | `/api/documents/:id` | document metadata plus readable body/reader fields | ID/path lookup into the same indexed document; source Markdown remains unchanged |
| Social insights pages | `/api/social-insights*` | report/trend-specific arrays and provenance | only `10_raw/social-insights/**` documents matching their explicit report types |
| Douyin pages | `/api/douyin*` | stable `current.json` contract | `30_self_media/douyin/current.json`, only when it passes `schemaVersion`, quality, availability, and works-array gates |
| Daily hot | AI HOT loader | explicit unavailable/live contract | external anonymous source; not derived from the Vault |
| `/todos`, `/weekly-focus`, reports | task/report APIs | task/focus/report contracts | local SQLite/team server; no Vault field mapping |
| `/meetings`, `/outlook` | DingTalk/Outlook APIs | integration-specific status/items | external integrations; no Vault field mapping |

## Source-to-contract mapping

| Existing Vault shape | Workbench field | Conversion rule |
| --- | --- | --- |
| relative file path | `id`, `path`, `relativePath` | path-derived ID; no content-based identity |
| first H1 or filename | `title` | filename is the only fallback; no title generated from prose |
| Markdown body | `excerpt`, reader body | Markdown is parsed/read-only; excerpt strips presentation syntax |
| frontmatter `type` | `type` and wiki grouping | used when present; absent values remain absent |
| frontmatter `status` | `status`, wiki health counts | explicit `active`, `needs-review`, and `deprecated` values are counted by status; missing or unknown values are counted as `unlabeled` |
| frontmatter `created`/`updated` | `createdAt`/`updatedAt` | parsed when valid; filesystem timestamps are fallback metadata, not invented content |
| frontmatter `sources`, `tags` | searchable metadata/provenance | arrays preserved; empty means no declared entries |
| `[[target]]` links | graph edges/backlinks | resolve against relative path/basename; unresolved targets stay unresolved |
| `30_self_media/douyin/current.json` | Douyin analytics | accepted only through the documented JSON gates; missing metrics stay `null` |

## Current Vault audit

The configured example Vault contains:

- `wiki/concepts` and `wiki/frameworks`: valid formal knowledge pages with
  explicit `type`, `status`, `created`, `updated`, `sources`, and `tags` in the
  files inspected.
- `10_raw/articles`, `10_raw/books`, and `10_raw/social-insights`: readable
  Markdown sources. Books already expose `book`, `author`, and `language` on
  the chapter files where the Books page needs them.
- `40_topics/ideas`: topic notes with explicit `topic-idea`/`idea` metadata.
- `50_scripts`: workflow material, intentionally not promoted to formal Wiki.
- `30_self_media/douyin/current.json`: a synthetic/demo store marked with
  `demoMode: true`; it is not treated as personal production analytics.

No conversion file is needed for this Vault. The existing indexer is the
mapping layer. A future Vault with different names should add an explicit
adapter or migration and preserve the same null/empty-array rules; it should
not be handled by title guessing or placeholder rows.
