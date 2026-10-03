# Docket-Key — Build Specification

**Version**: 4.0
**Supersedes**: v3.0 (2026-10-02)
**Repository**: `drivedigital/docket-key`
**Last updated**: 2026-10-03
**Companion documents**: `WORKLOG.md` (external-repo research findings), `docs/SPEC_V3_REVIEW.md` (review history), `docs/DECISIONS.md` (decision record)

> **Why v4.0 and not v3.1.** v3.0 rested on four premises that no longer hold: that Docket-Key owns its own
> schema, that OCR must run locally, that there is no server tier, and that Supabase Storage is the canonical
> document store. All four changed. This is a re-architecture, not a revision.

---

## 1. Executive Summary

**Docket-Key** is a litigation-intelligence tool for formal court records (NYSCEF, PACER, municipal dockets).
It is the acquisition-and-reading layer of a three-part suite:

1. **Docket-Key** — formal court dockets, filings, affidavits, orders.
2. **Converge** — informal communications (iMessage, WhatsApp, SMS, call logs).
3. **CaseVault** — the matter/proof workspace: reviewed facts, claim-element mapping, contradiction audit.

**The central architectural decision in v4.0: Docket-Key is a CaseVault *connector*, not a co-equal pillar
with its own schema.** `drivedigital/casevault` contains a 1,713-line, ~55-table PostgreSQL schema draft that
already designs — properly — most of what v3.0 proposed to build crudely: the job queue (`system_jobs`),
entities and relations (`actors` / `actor_aliases` / `matter_actor_roles`), hybrid retrieval (its §7), the
positional citation layer (`source_pages.layout_json`, `source_excerpts.anchor_json`), content dedupe
(`sources.sha256` + `source_metadata.text_simhash`), the provider/agent layer, the connector layer, and an
audit log. Its Technical Spec §14.5 explicitly lists **"docket systems" as a future connector category**, and
§14.4 defines the import flow Docket-Key plugs into.

So Docket-Key owns exactly three things and delegates the rest:

- **Acquisition** — NYSCEF (two-phase, supervised CAPTCHA) and PACER (NextGen CSO / PCL).
- **Positional OCR** — turning filings into page-and-bbox-addressable text.
- **Court-record UI** — docket table, pinpoint-citation PDF viewer, cross-case mind map, job visibility.

Everything else — matters, actors, sources, spans, proposals, jobs, providers, audit — is CaseVault's schema
in a shared Supabase Postgres.

### 1.1 Design principles

1. **Postgres is the system of record.** Everything else (R2, AI Search, Drive) is derived, rebuildable, or
   a mirror. If a downstream store is lost, it is re-derived from Postgres — never the reverse.
2. **One canonical text layer.** OCR happens once, positionally, and every consumer reads that same output.
   Never two OCR passes over one document.
3. **Cloud-canonical, laptop-optional.** Agents keep working with the laptop closed. The Mac is required only
   where a human must be present — the NYSCEF CAPTCHA.
4. **Derived data is not backed up; source data is.** Vectors, indexes, mirrors, and caches are rebuildable.
   Documents and relational records are not.
5. **The UI never asserts a false success.** Connection state is measured, not hardcoded; every long-running
   action reports its true outcome.

---

## 2. System Topology

v3.0 described two cooperating systems. v4.0 has **three tiers**, split along one question: *what physically
requires the Mac?*

```
┌─────────────────────────────┐
│  1. WEB — Cloudflare Pages  │  static export (output: 'export')
│     Next.js dashboard       │  Supabase Auth session → RLS-scoped reads
│                             │  PDF render: pdfjs-dist ← Worker/R2 signed read
│                             │  Search UI ← AI Search embeddable components
└──────────────┬──────────────┘
               │ Supabase (RLS) · Worker endpoints · AI Search
               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  2. CLOUD AGENTS — Cloudflare Workers + Cron Triggers  (ALWAYS ON)  │
│                                                                     │
│   • Sentinel: staleness scan → enqueue refresh jobs (cron)          │
│   • Council of Experts: analysis, synthesis, drafting               │
│   • Retrieval: AI Search hybrid query → resolve citations in PG     │
│   • Document proxy: R2 binding → bytes to pdf.js (JWT-authorised)   │
│   • Supabase keep-alive ping (defeats free-tier 7-day pause)        │
│   • pg_dump → R2 (relational backup; free tier has none)            │
│                                                                     │
│   Cannot run: Playwright, Tesseract, long CPU work.                 │
│   Anything heavy is an API call (Document AI, Gemini), never in-proc│
└──────────────┬──────────────────────────────────────┬───────────────┘
               │ docket.jobs / system_jobs (queue)    │
               ▼                                      │
┌──────────────────────────────────────────┐          │
│  3. LOCAL INGESTION DAEMON — Mac, Python │          │
│     USER-LAUNCHED, not always-on         │          │
│                                          │          │
│   • NYSCEF: headed Playwright, human     │          │
│     solves CAPTCHA, ~60-query budget     │          │
│   • PACER: NextGen CSO / PCL client      │          │
│   • text-layer audit                     │          │
│   • upload bytes → R2 (canonical)        │          │
│   • call Document AI for scanned PDFs    │          │
│   • write text/ spans → R2 + Postgres    │          │
│   • mirror → Drive (best-effort)         │          │
│   • local backup copy                    │          │
└──────────────────────────────────────────┘          │
                                                      ▼
                    ┌──────────────────────────────────────────────┐
                    │  SUPABASE POSTGRES — system of record        │
                    │  CaseVault schema + docket extension tables  │
                    │  pgvector VECTOR(1536) · RLS · Realtime      │
                    ├──────────────────────────────────────────────┤
                    │  CLOUDFLARE R2 — canonical document bytes    │
                    │  CLOUDFLARE AI SEARCH — retrieval index      │
                    │  GOOGLE DRIVE — human/NotebookLM mirror      │
                    └──────────────────────────────────────────────┘
```

### 2.1 What changed from v3.0

| v3.0 | v4.0 | Why |
|---|---|---|
| "Nothing in Docket-Key Web assumes a server exists" | A Workers tier exists and is central | Enables always-on Sentinel, retrieval, drafting, and the document proxy without a laptop |
| Job queue is the **only** Web↔Agent channel | Queue carries **acquisition only**; Workers do analysis directly | Don't queue work that can just run |
| Agent = one local Mac process | Split: cloud agents (always-on) + local daemon (user-launched) | OCR and embeddings no longer need the Mac |
| OCR "always runs locally" | **Document AI primary**, local `ocrmypdf` fallback | A laptop-off agent cannot run `ocrmypdf`; the local machine is underpowered |
| Supabase Storage canonical | **R2 canonical**, Supabase = relational only | No egress fees, 10 GB free, Worker binding needs no OAuth |
| Own `docket.*` + speculative `shared.*` schema | CaseVault schema + narrow docket extension | See §1 and §6 |
| No RLS | **RLS + Supabase Auth, single user** | Public `pages.dev` + anon key in bundle + writable queue = strangers could drive the Mac |
| `text-embedding-004`, Gemini 1.5 Pro/Flash | `gemini-embedding-001` @1536, current Gemini 2.5-family | Both v3.0 choices are **shut down** (2026-01-14 and 2025-09-29) |

---

## 3. Storage Architecture

| Layer | Store | Role | Rebuildable? |
|---|---|---|---|
| **Canonical bytes** | **Cloudflare R2** | Every acquired PDF, one object per filing | No — source data |
| **System of record** | **Supabase Postgres** | Matters, actors, sources, pages, spans, bboxes, docket entries, jobs, proposals, audit | No — source data |
| **Retrieval index** | **Cloudflare AI Search** | Hybrid (vector + BM25) search over extracted text | **Yes** — re-embed from Postgres |
| **Vector copy** | **pgvector in Supabase** | `VECTOR(1536)`, shared space with AI Search and CaseVault | **Yes** — re-embed |
| **Human/NotebookLM mirror** | **Google Drive** | Browsable copy; NotebookLM ingests Drive natively | **Yes** — re-upload |
| **Offline copy** | **Local Mac** | Backup; lets the daemon re-OCR without re-downloading | **Yes** — re-download |

### 3.1 R2 layout and AI Search data source

Use **your own R2 bucket** as the AI Search data source (not AI Search built-in storage), so the canonical
bytes stay directly readable by the Worker through an R2 binding for the PDF viewer, and AI Search indexes on
a sync schedule with **no ingestion code**. Separate the two concerns with AI Search **path filtering**:

```
r2://docket-key/
  raw/{matter_slug}/{doc_number}.pdf     canonical bytes
                                         EXCLUDED from indexing
                                         served to pdf.js via Worker binding
  text/{matter_slug}/{doc_number}.md     extracted paragraphs w/ page markers
                                         INCLUDED, auto-indexed by AI Search
  backup/pg/{date}.dump                  pg_dump output (§11.3)
```

**Why index extracted text rather than the raw PDF:** one canonical text layer instead of two disagreeing OCR
outputs for the same page; AI Search's **10 MiB PDF-with-OCR cap stops mattering** (markdown chunks are tiny);
the **5-metadata-field** limit is spent where it counts; and positions stay in Postgres, where citations
resolve them. See §7.

### 3.2 Document proxy

The web app is a static export with no server, and R2 objects are private. A Worker endpoint serves them:

```
GET /api/doc/{source_id}?page=n     → R2 binding read, streamed to pdf.js
   authorised by the Supabase JWT (decision: RLS identity, §11.1)
   → confirms the JWT's user may read that source row, then streams bytes
```

No Google credentials anywhere in this path. This Worker is the **same deployment** as the cron keep-alive
and the agent tier (§2) — one Worker, several triggers.

### 3.3 Supabase free-tier budget

Free tier: 500 MB database, 1 GB file storage (**now unused**), 5 GB egress, 2 projects, **no automatic
backups**, **pauses after 7 days of inactivity**.

- **Database** — comfortable, because the two things that would have eaten it are elsewhere: bytes in R2,
  vectors in AI Search *and* pgvector. Budget check: `source_pages` text at ~4 KB/page × ~20,000 pages ≈
  80 MB; pgvector at 1,536 dims ≈ 6 KB/vector plus ~1.3–1.8× HNSW overhead. **Embed at paragraph/excerpt
  level, not page level** (§7.2) — that keeps vectors to a few tens of MB instead of 250–300 MB.
- **Pause** — defeated by the daily cron keep-alive in the agent Worker. No Pro subscription required.
- **Backups** — free tier has none, so `pg_dump` → R2 on the same cron (§11.3). R2 and Drive give document
  redundancy; this closes the *relational* gap.
- **Pro ($25/mo) is optional**, wanted only if you prefer managed daily backups over the cron `pg_dump`.

---

## 4. Authentication & Credentials

Four credential systems, each with one job. **No browser-side Google OAuth.**

| Credential | Held by | Scope | Storage |
|---|---|---|---|
| **Supabase Auth session** | Browser | Single user; RLS policies key on `auth.uid()` | supabase-js, persisted |
| **Supabase service-role key** | Local daemon **and** Workers | Full DB + Storage | macOS Keychain / Worker secret. **Never in the web bundle.** |
| **Cloudflare API token** | Local daemon | R2 write, AI Search ingest | macOS Keychain |
| **Google service account** | Local daemon (+ Worker if mirroring) | Drive, via **one shared folder** | Keychain / Worker secret |
| **PACER credentials** | Local daemon | NextGen CSO | macOS Keychain — **never in any database** |
| **Gemini API key** | Workers, daemon | Inference + embeddings | Worker secret / Keychain |

### 4.1 Google — service account, not OAuth

v3.0 §2.1 specified a server-side OAuth auth-code exchange with a refresh token. **Replaced.** Findings in
`WORKLOG.md` and §I1 of the review:

- A **`web`** OAuth client secret was exposed in chat and **must be reset**; it is not used by this design.
- The credential's project (`gen-lang-client-0885961933`) is an **AI Studio auto-generated project**, unsuitable
  for hosting a properly configured consent screen. Use a **dedicated GCP project**.
- `https://www.googleapis.com/auth/drive` is a **restricted** scope. `drive.file` is **non-sensitive**.
- A personal Gmail account forces **External** user type, which starts in **Testing** status where
  **refresh tokens expire 7 days after consent** — requiring weekly interactive re-consent. Staying in
  Testing to avoid verification *is what causes* the expiry; you cannot have both.

**Decision: service account.** No consent screen, no publishing status, no verification, no expiry, no public
audience, and identical usage from a Worker and from Python (`google-auth` signs the JWT in both). Access is
granted by **sharing one Drive folder** with the service-account email — which also sidesteps `drive.file`
per-client-ID scoping entirely.

Ownership nuance: files the service account creates are owned by *it*, appearing in your Drive through the
shared folder. NotebookLM running as you can still ingest them, and the folder stays human-browsable, so
v3.0 §3.3's intent is preserved.

> If OAuth is ever wanted instead: use **`drive.file` only** and publish to Production. Non-sensitive scopes
> need no restricted verification and no CASA audit; tokens then stop expiring. The only cost is that any
> Google account could authorise the client — acceptable at `drive.file` blast radius, but strictly more
> machinery than the service account.

### 4.2 NYSCEF — supervised, two-phase

Two-phase design, per the operational findings in `WORKLOG.md` (Research Task #2):

- **Phase 1 — resolve (captcha'd).** Case Search requires a human-solved CAPTCHA and yields a `JSESSIONID`
  plus the **internal docket/case ID**. Run headed Playwright; the user solves the challenge; capture both.
- **Phase 2 — refresh (uncaptcha'd).** *"If you have a set of docket ids, there is no captcha requirement for
  going directly to the docket ids case information."* So once phase 1 has run for a matter, routine refreshes
  need **no live supervised session**.

**The binding constraint is a query budget, not a TTL**: a `JSESSIONID` supports **fewer than ~100 requests;
60 is the safe figure**. At 27 monitored matters a full refresh pass ≈ 27 queries → roughly **two passes per
CAPTCHA solve**. Therefore the daemon must:

- maintain a per-session query counter and stop before exhaustion;
- refresh in a defined priority order (stalest first, active matters ahead of disposed);
- persist the session and its remaining budget so a restart doesn't waste it;
- re-prompt for CAPTCHA only when the budget is spent or the session is rejected.

No background daemon, and **no CAPTCHA-solving service of any kind** — ruled out on ToS/ethics grounds against
a government system (v3.0 §2.4, unchanged).

### 4.3 PACER

- **NextGen CSO** auth; the `X-NEXT-GEN-CSO` token is 128 chars, **expires, and is re-issued in response
  headers** — so the client must persist and rotate it.
- **PCL API is a case/party *search index* only** — it returns neither docket sheets nor PDFs. Document
  retrieval still goes through per-court ECF. v3.0 §2.5's "official API, not scraping" holds for *discovery*
  and **not** for retrieval; scope M10 accordingly.
- **Cost model, corrected.** $0.10/page capped at $3.00/document, but since 2020-01-01 **quarterly usage of
  $30 or less is waived outright** (~75% of users pay nothing). For one pro se user the meaningful guard is
  *"stay under $30/quarter,"* not "$3/document." Docket reports are themselves billable, and production PCL
  searches are billable (a separate non-billable QA environment exists with its own account).
- **Free-copy path.** As a **party of record** you receive one free copy of each newly filed document via the
  CM/ECF notification email link. For matters where you are a party, harvesting that mailbox may be cheaper
  and more reliable than any API. **Evaluate before building the PCL/ECF client** — it may shrink M10
  substantially.
- PACER credentials live in the **macOS Keychain only**. They are federal-judiciary credentials and are never
  written to any database, Vault included.

### 4.4 NotebookLM

Unchanged in role from v3.0 §2.3: **export-only, best-effort, one-way**, for Audio Overview / Study Guide.
Not a source of OCR, not a source of entities, not required for Q&A. Engine: `jacob-bd/gemini-notebook-mcp-cli`
(**MIT** — the only one of the researched repos with a usable licence), wrapped behind one module so it can be
disabled without touching core code. Pin the tested version; it is unofficial and will break.

Simplification available now that Drive is a mirror: **NotebookLM ingests Google Drive files natively**, so
`nlm source add` can reference the mirrored Drive file rather than re-uploading bytes.

---

## 5. Ingestion Pipeline

```
        NYSCEF (2-phase, supervised)          PACER (NextGen CSO / PCL + ECF)
                    │                                     │
                    └──────────────┬──────────────────────┘
                                   ▼
              LOCAL DAEMON: acquire bytes, compute sha256
                                   ▼
                        upload → R2 raw/{matter}/{doc}.pdf
                        local backup copy
                                   ▼
                    ┌──── text-layer audit (pdfminer/pypdf) ────┐
                    │  <100 chars/page or garbled font mapping? │
                    └───────┬───────────────────────┬───────────┘
                     native │                       │ scanned
                            ▼                       ▼
                  PyMuPDF: text +        GOOGLE DOCUMENT AI
                  page/bbox/offsets      Enterprise Document OCR
                            │            pages[].pageNumber
                            │            tokens/lines/paragraphs[]
                            │            layout.boundingPoly.normalizedVertices
                            │            layout.textAnchor{startIndex,endIndex}
                            │            layout.confidence, imageQualityScores
                            └───────────────┬───────────────┘
                                            ▼
                    ONE canonical text layer, with positions
                                            ▼
                    POSTGRES (system of record):
                      sources, source_pages.layout_json,
                      source_excerpts.anchor_json, docket_entries
                                            ▼
                    write text/{matter}/{doc}.md → R2
                                            ▼
                    AI Search auto-indexes (path filter: include text/**)
                                            ▼
                    pgvector copy (same model, same 1536 dims)
                                            ▼
                    mirror → Google Drive (best-effort, non-blocking)
                                            ▼
                    embed into AI Search / pgvector, ready for §7 retrieval
```

### 5.1 OCR — Document AI primary, local fallback

v3.0 §3.2 made local OCR "PRIMARY and ONLY." **Inverted**, because the cloud agent tier must operate with the
laptop closed and the local machine is underpowered.

**Google Document AI, Enterprise Document OCR processor** is primary. Verified response structure:

- `Document.text` — full raw text
- `pages[]` — `pageNumber` (1-based), `dimension`, `image` (pre-rendered deskewed/de-rotated so boxes are
  axis-aligned), `transforms[]` (matrices applied — **required to map coordinates back to the original page**)
- per page: `blocks[]`, `paragraphs[]`, `lines[]`, `tokens[]`, `symbols[]`, each with
  `layout { textAnchor{ textSegments[{startIndex,endIndex}] }, confidence ∈ [0,1],
  boundingPoly{ vertices[], normalizedVertices[] }, orientation }`
- `pageAnchor.pageRefs[]` for elements spanning pages; `imageQualityScores`; `detectedLanguages`

It also supplies `paragraphs[]` and `lines[]`, which **is** the structure-aware chunking v3.0 §3.4 wanted and
the researched RAG repo could not provide (it split naively at 500 *characters*, shredding affidavit
paragraphs).

**Cost**: $1.50 per 1,000 pages sync; ~$0.60 per 1,000 async batch via GCS. The text-layer audit means only
the scanned minority is OCR'd at all — realistically 2,000–4,000 pages ≈ **$3–6 for the entire back catalog**.
Use **sync `:process`** for filings under ~15 pages / 20 MB (avoids needing a GCS bucket); **batch** for large
exhibits.

**`ocrmypdf` + Tesseract 5 demoted to fallback** — free, offline, for zero-spend or no-network operation.
Expect 80–90% accuracy versus Document AI's ~95–99%, and no reliable positional output.

**Why not Drive's or OneDrive's built-in OCR** (both were considered): they OCR only to populate their own
search indexes and expose no positionally faithful text via API. The only Drive route to text is PDF→Google
Docs export, which reflows with no page or bbox mapping — the exact failure mode v3.0 §3 correctly rejected.
Same conclusion for **Cloudflare AI Search's OCR**: real and cheap, but it yields *searchable* text, not
*locatable* text, so it cannot power pinpoint citations. AI Search and Document AI are **complements**.

### 5.2 Dedupe and idempotency

- `sources.sha256` — skip re-OCR and re-upload on an exact match. The same exhibit is filed in several related
  matters.
- `source_metadata.text_simhash` — near-duplicate detection (CaseVault already designs this).
- Upsert docket entries on the natural key `(matter_id, doc_number)` so a **re-pull corrects a mis-parse
  instead of duplicating it**.

### 5.3 No human review gate — but keep the machinery

Per decision: **docket pulls are not staged for human review.** Scraped filings are written straight through.
The provenance machinery is retained anyway, because it costs nothing and makes bad scrapes fixable by
re-running rather than hand-editing canonical rows:

- rows still land in `connector_results` with `review_state` set automatically to `'accepted'`;
- preserve `external_id`, `external_uri`, `provenance_json`, `raw_payload_json`, `imported_source_id`
  (CaseVault §14.6's provenance requirements);
- route only genuine **parse failures** to a `failed` state, surfaced in the Jobs panel.

### 5.4 No AI-sharing gate — but populate the column

Per decision: **no sharing-policy enforcement in Docket-Key.** However `matters.ai_sharing_policy` is
`NOT NULL` in CaseVault's schema, so **populate it** with the permissive value rather than building
enforcement. Zero cost, and CaseVault's future enforcement never encounters nulls or has to backfill.

---

## 6. Database Schema

**CaseVault owns the schema.** Docket-Key creates no parallel tables where CaseVault already has one.

### 6.1 CaseVault tables Docket-Key writes to

| CaseVault table | Docket-Key uses it for |
|---|---|
| `workspaces`, `users`, `workspace_memberships` | Single fixed workspace row; single user. `workspace_id` is **required on every row** — CaseVault is multi-workspace, so v3.0's "no auth scoping" cannot coexist with a shared project. |
| `matters`, `matter_links` | One matter per tracked case; `matter_links.link_type` (free-text, e.g. `overlays`, `related`) powers the cross-case mind map |
| `actors`, `actor_aliases`, `matter_actor_roles` | Parties, attorneys, judges. **Converge is the primary identity feeder**; Docket-Key proposes aliases, it does not own dedup (§8.4) |
| `sources`, `source_matter_links`, `source_metadata` | One source per filing: `sha256`, `page_count`, `ocr_status`, `processing_status`, `storage_path` = R2 URI, `external_provenance_json` for NYSCEF/PACER provenance |
| `source_pages` | `page_number`, `ocr_text`, **`layout_json`** ← Document AI `boundingPoly.normalizedVertices` |
| `source_excerpts` | `page_start/end`, `locator_text`, **`anchor_json`** ← bboxes + char offsets. The citation→pixel bridge |
| `system_jobs` | The acquisition queue (§6.4) |
| `connector_configs`, `connector_runs`, `connector_results` | Docket-Key registers as an MCP/native connector (§5.3) |
| `ai_provider_configs`, `agent_personas`, `agent_runs`, `agent_run_steps`, `agent_run_dispositions`, `agent_run_artifacts` | Council of Experts. **Do not build v3.0 §6's provider abstraction** — this exists |
| `proposals`, `fact_assertions`, `fact_support_links` | What Sentinel/Auditor *emit* — `proposal_type: fact \| event \| contradiction \| date_normalization \| duplicate_merge` |
| `events`, `event_fact_links`, `event_actor_links` | Chronology |
| `audit_log_entries` | v3.0 §4 deferred this; CaseVault designs it. Write to it |

### 6.2 Tables Docket-Key must **not** create

`shared.entities`, `shared.entity_relations` (v3.0 §4), `docket.jobs`, `docket.vector_embeddings`,
`docket.cases`, and any second provider/agent/connector model. Each duplicates a CaseVault table, usually
less well: v3.0's `shared.entities` dropped `primary_case_id` and typed provenance; its `entity_relations`
traded `case_id` + `evidence_doc_number` for an opaque `source_record_id`; and its `relation_type` enum baked
one matter's facts (`ground_lease`, `nuisance_action`, `mortgage_lien`) into a permanent vocabulary.
CaseVault uses a free-text `role_label` / `link_type` instead, which is correct.

### 6.3 Docket-specific extension (the only new DDL)

`ledger_entries` is a *fact* ledger (`fact_statement`, `confidence_level`, `authentication_or_witness`), not
a filing register — do not overload it. Docket-Key keeps one narrow extension:

```sql
CREATE TABLE docket.entries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES workspaces(id),
  matter_id       uuid NOT NULL REFERENCES matters(id),
  source_id       uuid          REFERENCES sources(id),      -- the PDF, once acquired
  source_system   text NOT NULL,        -- 'nyscef' | 'pacer' | 'manual'
  court_id        text,                 -- PACER court code
  source_case_id  text,                 -- NYSCEF internal docket ID (phase 1 output, §4.2)
  index_number    text NOT NULL,        -- '150428/2024' or '24-10892'
  doc_number      integer NOT NULL,
  entry_date      date,
  date_start      date,                 -- CaseVault date handling: exact / range /
  date_end        date,                 --   approximate / unresolved raw text
  date_text_raw   text,
  date_precision  text,                 -- 'exact'|'range'|'approximate'|'unknown'
  doc_type        text NOT NULL,
  description     text NOT NULL,
  filed_by        text,
  pdf_url         text,                 -- acquisition URL, kept for provenance/re-fetch
  content_sha256  char(64),
  ocr_status      text NOT NULL DEFAULT 'not_needed',
                                        -- 'not_needed'|'pending'|'done'|'failed'
  ocr_confidence  numeric(4,3),
  text_layer_source text,               -- 'native'|'document_ai'|'ocrmypdf'
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_docket_entries__system_matter_doc
    UNIQUE (source_system, matter_id, doc_number)
);
CREATE INDEX ix_docket_entries__matter_id ON docket.entries (matter_id, doc_number);
CREATE INDEX ix_docket_entries__source_case_id ON docket.entries (source_case_id);
```

Notes:
- **`source_system` is required.** v3.0's `cases` had `index_number UNIQUE` and no source system, yet the
  mock data already contained a **S.D.N.Y. bankruptcy matter (`24-10892`) with a `nyscef_url`**. A NYSCEF
  index and a federal case number are different namespaces and can collide.
- **`source_case_id`** holds the NYSCEF internal docket ID from phase 1 — the key that makes uncaptcha'd
  refresh possible (§4.2).
- **Adopt CaseVault's date handling.** NYSCEF dates are sometimes ambiguous; a bare `entry_date DATE` loses
  that. `date_precision` preserves the uncertainty instead of silently guessing.
- **`ocr_status` vocabulary is unified** to `not_needed | pending | done | failed`, with provenance moved to
  `text_layer_source`. This supersedes both v3.0 §4 and `001_initial_schema.sql`'s
  `pending | digital_text | cloud_ocr | failed`, and replaces the `has_text_layer` boolean.
- **Follow CaseVault conventions**: `workspace_id` everywhere, `citext` for names, `pgcrypto`, `updated_at`
  on every table, soft delete via `archived_at`, and named constraints (`pk_`, `fk_`, `uq_`, `ix_`, `ck_`).
  `001_initial_schema.sql` follows none of these.

### 6.4 The job queue — `system_jobs`, hardened

Use CaseVault's `system_jobs`. Its vocabulary (`status` default `'queued'`, `payload_json`, `result_json`,
`error_text`, `created_at`/`started_at`/`completed_at`) is close to v3.0's `docket.jobs`, and
`agent_run_status_enum` is richer (`queued|running|completed|failed|partial|canceled`).

Both versions share the same defects, so fix them **once**, here:

| Add | Why it matters for a user-launched daemon |
|---|---|
| `claimed_at`, `lease_expires_at` + requeue | The daemon **gets killed** — laptop sleeps, ⌘C, `ocrmypdf` crash. Without a lease a job sits in `running` forever and the UI spins indefinitely. |
| `attempt_count`, `max_attempts`, `next_retry_at` | NYSCEF sessions expire mid-batch; Drive and Document AI rate-limit. |
| **`priority`** | v3.0 §3.3 called NotebookLM export "a lower-priority job type" while defining **no priority column**. |
| `idempotency_key` + unique | Double-clicking "Pull Docket" must not burn two of ~60 session queries (§4.2). |
| `agent_id` / `locked_by` | Cheap insurance if the daemon ever runs on two machines. |
| Atomic claim | `SELECT … LIMIT 1` then `UPDATE` is racy. Wrap in a `claim_next_job()` SQL function using `FOR UPDATE SKIP LOCKED`. |

**Realtime**: `ALTER PUBLICATION supabase_realtime ADD TABLE system_jobs;` — v3.0 §1 promised Realtime job
status and §5/M15 promised a live Jobs panel, but neither v3.0 §4 nor `001_initial_schema.sql` published the
queue. Also publish `sources`, `source_pages`, `docket.entries`. `postgres_changes` honours RLS, so this is
safe once §11.1 lands.

### 6.5 Migration path

`001_initial_schema.sql` created seven unnamespaced tables in `public` (`cases`, `docket_entries`, `entities`,
`entity_relations`, `mind_maps`, `agents`, `queries`). Migration `002` must be an explicit delta, not a
rewrite — state what is **renamed, folded into a CaseVault table, or dropped**:

- `cases` → `matters` + `docket.entries` (source-system fields)
- `docket_entries` → `docket.entries` + `sources`
- `entities` / `entity_relations` → `actors` / `actor_aliases` / `matter_actor_roles` / `matter_links`
- `mind_maps` → keep, but read `layout_data` against `actors`/`matter_links`
- `agents` → `agent_personas` + `ai_provider_configs`
- `queries` → keep as the Q&A log; add retrieval provenance (matched chunks, scores, `source_excerpts` IDs)
  so an answer's citations are auditable
- add `CREATE EXTENSION vector;` (v3.0 enabled only `uuid-ossp`, which is unnecessary — `gen_random_uuid()`
  is core since PG13), plus `citext` and `pgcrypto`
- add RLS policies (§11.1), Storage-free (no buckets needed), and the Realtime publications above

---

## 7. Retrieval & Pinpoint Citations

### 7.1 Two indexes, one vector space

Configure the AI Search instance with **`google-ai-studio/gemini-embedding-001`, 1,536 dims, cosine**.

This is the load-bearing choice. It is **exactly CaseVault's declared `VECTOR(1536)`** and exactly the
replacement for the shut-down `text-embedding-004`. Consequences:

- AI Search's vectors and pgvector's vectors come from **the same model, dimension, and metric** → directly
  comparable and **cross-queryable**. CaseVault can search Docket-Key's embeddings in pgvector while AI
  Search serves the fast hybrid path, from one shared space.
- Any vector is **regenerable** by calling Gemini directly, so the pgvector copy is a deterministic
  re-derivation, not a fragile export.

Caveats:
1. **Portability is chosen at instance creation, not inherited.** AI Search's default is
   `@cf/qwen/qwen3-embedding-0.6b` at **1,024 dims** — Cloudflare-internal, unreproducible elsewhere, and
   dimensionally incompatible with CaseVault. Do not accept the default.
2. **External embedding providers bill to your own Google account via AI Gateway**, outside AI Search's
   included ingestion allowance (which covers Workers AI embedding and reranking). A few dollars at ~16M
   tokens — verify the current rate.
3. **Do not plan on exporting from AI Search; plan on regenerating.** Its index is managed ("built-in storage
   powered by R2 and Vectorize"); Vectorize exposes `list`/`get_by_ids`, but the docs do not state that an
   AI Search instance's internal index is enumerable in your account, and AI Search no longer writes to an
   R2 bucket you own. Treat it as opaque.

**Vectors are derived data.** A vector is a pure function of (chunk text, model). Postgres holds the canonical
text and spans. So the backup that matters is the text — already kept — and "restore the index" means
"re-embed" (~$14, minutes). The pgvector copy exists for **CaseVault convergence and cross-pillar search**,
not for disaster recovery.

Alternative worth confirming against CaseVault: **`google-ai-studio/gemini-embedding-2`** — same 1,536 dims
but **8,192 input tokens** (vs 2,048) and native image support. The larger window suits long affidavit
sections without aggressive splitting. CaseVault's draft names a dimension, not a model, so this is open.

### 7.2 Chunking

Chunk on **Document AI's `paragraphs[]` / `lines[]`**, not on character count and not per page. This is the
structure-aware chunking v3.0 §3.4 asked for (headings, numbered paragraphs, affidavit clauses) and the
researched repo could not deliver.

- **Embed paragraphs/excerpts, not pages.** Better retrieval units for legal text, and far fewer vectors —
  which is what keeps the 500 MB database budget comfortable (§3.3).
- Bound chunk size by the embedding model's input cap (2,048 tokens for `-001`; 8,192 for `-2`). v3.0
  specified "200-token overlap" with **no chunk size** — specify both.
- Every chunk carries `source_id`, `page_number`, and char offsets, resolving to `source_excerpts.anchor_json`.

### 7.3 AI Search limits to design around

| Limit | Value | Mitigation |
|---|---|---|
| Max PDF with OCR | **10 MiB** (4 MiB without) | Moot — index `text/**` markdown, never the raw PDF (§3.1) |
| **Custom metadata fields** | **5 per instance** | Spend them on `source_id`, `page_number`, `doc_number`, `matter_id` + one filter. Everything else lives in Postgres |
| Filterable string data | first 64 UTF-8 bytes | Don't filter on long captions |
| Included queries/month | **1,000 semantic + 1,000 full-text** | See §12 — daily per-matter monitoring alone is ~810/month |
| Files per instance | 100,000 | Fine (~675 filings) |

**AI Search points back; Postgres owns the citation.** It is a retrieval index, not a system of record.

### 7.4 Citation resolution path

```
user question
  → AI Search hybrid query (vector + BM25 fused, reranked)
  → top chunks with {source_id, page_number, doc_number, matter_id} + score
  → Postgres lookup: source_excerpts.anchor_json → page + bbox + char offsets
  → answer cites [Doc #N, p.M] with the exact excerpt
  → UI click → Worker streams raw/{...}.pdf from R2
  → pdfjs-dist renders page M, overlay draws the bbox → highlight
```

**PDF renderer: `pdfjs-dist`** (or `react-pdf`). v3.0 never named one, and there is none today — the current
`PdfViewerPanel.tsx` renders a `<div>` with a fake court letterhead around a text dump. Overlaying bboxes on
a specific page at correct scale requires a real renderer with an annotation layer. Verify the pdf.js worker
cooperates with `output: 'export'` **during the spike**, not during the mind-map milestone.

**Coordinate fidelity is the open risk.** Document AI returns `transforms[]` — the matrices applied to produce
its deskewed `page.image`. Bounding boxes must be mapped back through them before they will land correctly on
a pdf.js render of the *original* PDF. This is the single question the spike (§14, M-Spike) must answer.

---

## 8. Agents

### 8.1 Two tiers

| Tier | Runs | Owns |
|---|---|---|
| **Cloud agents** | Cloudflare Workers + Cron Triggers | Sentinel staleness scan and scheduling, retrieval, Council of Experts, drafting, document proxy, keep-alive, `pg_dump` backup |
| **Local ingestion daemon** | Mac, Python, user-launched | **Only** acquisition: NYSCEF (headed Playwright + CAPTCHA + budget), PACER, upload to R2, Document AI calls, mirroring |

With OCR (§5.1) and embeddings (§7.1) in the cloud, **NYSCEF scraping is the only work that needs the Mac** —
because a human must solve the CAPTCHA. That is the daemon's entire justification.

**Decision: the daemon idles rather than exits**, with session-expiry awareness. Idling preserves a precious
~60-query CAPTCHA session (§4.2); since the constraint is a query *count* rather than a fixed TTL, idling is
safe as long as the budget is tracked.

### 8.2 Scheduling — Sentinel gets a real trigger

v3.0 had no scheduler: work entered the queue only when a human clicked, so "monitored cases" were not
monitored. **Resolved**: a Cloudflare **Cron Trigger** runs a staleness scan over `matters` /
`docket.entries.last_synced_at` and enqueues refresh jobs daily. The daemon drains them whenever the user next
runs it, in priority order, subject to the session budget.

The cron Worker is the **same deployment** as the keep-alive ping and the document proxy.

### 8.3 Council of Experts

Four roles, unchanged in intent: Sentinel, Proof Graph Auditor, Cross-Case Synthesizer, Brief Drafter.
Implemented as CaseVault `agent_personas` + `agent_runs` (+ `agent_run_steps`, `_dispositions`, `_artifacts`),
configured through `ai_provider_configs`. **Do not build v3.0 §6's separate `ProviderConfig` /
`AgentRoleConfig` abstraction** — v3.0 itself said to launch everything on one provider and defer the others,
which means the abstraction would have exactly one implementation on day one.

What the roles **emit**: `proposals` (`fact`, `event`, `contradiction`, `date_normalization`,
`duplicate_merge`, `claim_mapping`, `verification_task`) into CaseVault's review model — not a parallel
graph. Contradiction detection is CaseVault's core (`proposal_type: contradiction`,
`fact_support_links.support_type: contradicts`, `claim_support_status: conflicted`); Docket-Key must not
reimplement it.

**Models**: v3.0 §5.4 specified "mixing 1.5 Pro / 1.5 Flash." **`gemini-1.5-pro`, `-flash`, and `-flash-8b`
were shut down 2025-09-29.** Use the current Gemini 2.5-family and **verify the live model list at
implementation time** — this spec has already caught two dead model choices, so do not hardcode names. Store
model identifiers in `ai_provider_configs`, never in source.

### 8.4 Converge owns actor identity

Converge uses SQLite **because iMessage stores are SQLite** — an ingestion artifact, not an architectural
commitment; once extracted, its data can land in the same Postgres. Nothing here is designed around Converge's
current shape.

The important consequence: **Converge is the authority on actor identity resolution**, and Docket-Key is the
worst place to invent one. Scraped dockets yield `"JOHN SMITH ESQ"`, firm names where individuals are meant,
abbreviated captions, inconsistent party ordering. Converge has a real contacts database with identity
resolution.

So: `actors` + `actor_aliases` + `matter_actor_roles` form the **shared identity spine**, with **Converge as
primary feeder** and Docket-Key as a **secondary proposer** — scraped names enter as `actor_aliases`
candidates (`alias_type` is documented for "nickname/spelling/etc.") and as `proposals` with
`proposal_type: duplicate_merge`. v3.0's `shared.entities` had no alias or dedup concept at all.

The three-tier value proposition then lands in existing tables: Converge's communications become `sources`
(`source_status: testimony`) feeding `fact_support_links` with `support_type: supports | contradicts` and
`support_origin_type: user_memory | source_excerpt` — the informal record corroborating or contradicting the
formal docket record. **No new tables required.**

---

## 9. MCP Surface

**Mostly provided by AI Search.** Every instance includes a **built-in MCP endpoint**, plus embeddable search
UI components for the dashboard. That replaces the hand-rolled read/search tools in v3.0 §7.

Keep only what AI Search cannot provide:

```python
# Acquisition bridge (web / external agents → local daemon)
docket_request_job(job_type: str, params: dict) -> str      # writes system_jobs
docket_get_job_status(job_id: str) -> str
docket_get_ocr_status(source_id: str) -> str

# Positional citation (AI Search returns text; Postgres returns position)
docket_get_citation_anchor(source_id: str, excerpt_id: str) -> str   # page + bbox

# NotebookLM (export-only, best-effort, one module, easy to disable)
notebooklm_check_status() / _list_notebooks() / _sync_case_filings()
notebooklm_ask_case() / _generate_audio_overview()
```

Two corrections to carry forward:

- The current `mcp/server.py` is a **hardcoded mock** with no database access, and its `except ImportError`
  fallback silently defines a fake `FastMCP` that prints and returns mocks. **Make that import hard-fail** —
  a missing dependency must not look like a working server.
- v3.0's UI advertised `https://docket-key.pages.dev/api/mcp`. **That endpoint cannot exist** under
  `output: 'export'`, and the MCP server is a local stdio process. Replace the Settings panel's copy button
  with the real configuration (a `claude_desktop_config.json` snippet, or the AI Search MCP URL).
- Do **not** wire LLM agents that ingest untrusted scraped filings to the **Google Drive MCP server**
  (`drivemcp.googleapis.com`). It is gated behind the Workspace Developer Preview Program, offers no OCR or
  positional data, still requires your own GCP project and consent screen, and Google explicitly warns it
  enables **indirect prompt injection** against your whole Drive. If adopted at all: read-only, and away from
  the ingestion path.

---

## 10. User Interface

```
┌────────────────────────────────────────────────────────────────────────────┐
│                          DOCKET-KEY DASHBOARD                              │
├──────────────┬─────────────────────────────────────────────────────────────┤
│  NAVIGATION  │  ACTIVE VIEW                                                │
│  [Cases]     │  • Monitored matters grid (staleness, filing counts)        │
│  [Dockets]   │  • Split pane: filterable docket table │ PDF viewer         │
│  [Mind Map]  │  • @xyflow/react graph over actors + matter_links           │
│  [Agents]    │  • Council of Experts (agent_personas / agent_runs)         │
│  [Q&A]       │  • AI Search hybrid retrieval, pinpoint citations           │
│  [Jobs]      │  • system_jobs, Realtime; session budget remaining          │
│  [Settings]  │  • Provider/model config, Drive + nlm + daemon status       │
└──────────────┴─────────────────────────────────────────────────────────────┘
```

### 10.1 Honest state — non-negotiable

The current UI asserts success it does not have. For a tool used in filings, this is a correctness issue, not
cosmetics. Fix all of it:

| Today | Must become |
|---|---|
| Sidebar shows **"Supabase — Connected"** in green as **hardcoded text** | Real connection state from a live query |
| Scraper modal runs three `setTimeout` messages, then `alert("Docket pull complete… Synced with Supabase")` having contacted nothing | Submits a `system_jobs` row; shows real status via Realtime |
| **"PDF Preview"** renders a fake NYSCEF letterhead around a text dump | `pdfjs-dist` rendering the actual R2 object |
| In-document search box filters nothing | Wired to AI Search full-text within the source |
| Settings advertises `/api/mcp`, which cannot exist | Real MCP configuration |
| `src/lib/supabase.ts` is imported nowhere; all data comes from `mockData.ts` | Real queries; mock data only behind an explicit dev flag, visibly labelled |

**The NYSCEF session budget belongs in the Jobs panel** — remaining queries out of ~60 is the single most
useful operational number in the product (§4.2).

### 10.2 Mind map

**`@xyflow/react`** (v12+), not the legacy `reactflow` package name v3.0 implied, and not the current
hand-rolled absolutely-positioned divs with a manual `scale` variable. This is a full rewrite; budget it as
one. Node taxonomy from `actors.actor_type`; edges from `matter_actor_roles` (free-text `role_label`) and
`matter_links` (free-text `link_type`). **Do not** carry over v3.0's `ground_lease | nuisance_action |
mortgage_lien` enum — those are facts about one matter, not an ontology.

---

## 11. Security

### 11.1 RLS + Supabase Auth

**Decision: enable RLS on every table**, with a single-user policy keyed on `auth.uid()`, and sign in via
Supabase Auth (email magic link is sufficient). The **daemon and Workers hold the service-role key**; the
browser never does.

Why this was not optional: the web app is a static export on a **public** `pages.dev` URL, so the anon key
ships inside a world-readable JS bundle — and `src/lib/supabase.ts` already **hardcodes a live publishable
key as a fallback**. With RLS off, that key grants full read/write on every table, including `system_jobs`,
whose rows the daemon **executes** with your Google and PACER credentials attached. "Single-tenant, pro se,
private" describes the intended audience, not the exposed surface of a public deployment.

Also: **rotate that hardcoded key out of source** and read it from `NEXT_PUBLIC_*` env only.

### 11.2 The queue is untrusted input

RLS stops strangers; it does not stop malformed input. Regardless of §11.1:

- an **allowlist** of `job_type` values, enforced in the daemon's dispatcher;
- a `jsonb` schema check per job type;
- **no `params` value ever reaches a shell unquoted**;
- a hard rule that **no job type may specify a filesystem path or a command**.

This applies to MCP-originated jobs too — `docket_request_job` makes any connected agent a queue producer.

### 11.3 Backups

Supabase free tier has **none**. `pg_dump` → `r2://docket-key/backup/pg/` on the daily cron. R2 and Drive
provide document redundancy; this closes the relational gap.

### 11.4 Secrets

- OAuth refresh tokens, PACER credentials, the Supabase service-role key, and the Google service-account key
  live in the **macOS Keychain** or **Worker secrets** — never in the database.
- v3.0 §4 said "Supabase Vault / `pgsodium`." Correction: Supabase **does not recommend pgsodium** and it is
  pending deprecation; **Vault is supported and stays API-stable**. Say **Vault only** if Vault is used at
  all — but for a local daemon plus Workers, Keychain and Worker secrets are the better home, and Vault
  becomes optional rather than load-bearing. Note Vault is reachable only via SQL with service-role
  privileges, so the browser could never read it anyway.

---

## 12. Cost & Limits Budget

| Item | Cost | Notes |
|---|---|---|
| **AI Search backfill** (one-time) | **~$14** | ~20,000 pages × ~800 tokens ≈ 16M tokens × $0.75/M, plus ~$1.60 OCR on the scanned minority |
| AI Search ongoing ingest | **$0** | 5M tokens/month included; new filings are ~40k–160k tokens/month |
| AI Search storage | **$0** | 10 GB-month included |
| **AI Search queries** | **~$0–1/month** | ⚠ 1,000 semantic + 1,000 full-text included. Daily per-matter monitoring across 27 matters ≈ **810/month before you ask a single question.** Overage $0.75/1,000 ≈ $0.61 |
| AI Search billing starts | **1 Nov 2026** | Free until then; reminder email the week before |
| **Document AI OCR** (one-time) | **~$3–6** | Scanned minority only, thanks to the text-layer audit. $1.50/1k sync, ~$0.60/1k batch |
| R2 | **$0** | 10 GB free; ~675 filings × ~1 MB ≈ 675 MB. **No egress fees** |
| Supabase | **$0** | 500 MB DB comfortable once bytes are in R2 and vectors are paragraph-level. Pro ($25/mo) optional, only for managed backups |
| Gemini embedding | **a few $** | Billed via AI Gateway to your Google account, outside AI Search's allowance — verify current rate |
| Gemini generation | usage | Council of Experts; use AI Gateway for caching/observability |
| PACER | **likely $0** | Usage ≤ **$30/quarter is waived outright**. Track a running quarterly total, not per-document caps |
| Cloudflare Workers | $0 | Free tier covers cron + proxy at this volume |
| **Total** | **~$17 one-time, ~$0–2/month** | Versus $25/month for the Supabase-Pro-only alternative |

---

## 13. Repository Layout

```
docket-key/
├── BUILD_SPEC.md                      # this file
├── README.md                          # rewrite: current one advertises dead models
├── WORKLOG.md                         # research findings + milestone ledger
├── ROADMAP.md
├── docs/
│   ├── SPEC_V3_REVIEW.md              # review history (contains reversals — see §16)
│   └── DECISIONS.md                   # condensed decision record
├── package.json                       # add @xyflow/react, pdfjs-dist; drop nothing yet
├── next.config.mjs                    # REMOVE ignoreBuildErrors / ignoreDuringBuilds
├── wrangler.jsonc                     # + Worker (cron, proxy, agents) config
├── tsconfig.json                      # target: es5 → es2022
├── pyproject.toml                     # NEW — no Python manifest exists today
├── .env.example                       # remove SUPABASE_SERVICE_ROLE_KEY from the web app
│
├── worker/                            # NEW — cloud agent tier (always-on)
│   ├── index.ts                       #   document proxy, agent endpoints
│   ├── cron.ts                        #   keep-alive, Sentinel staleness scan, pg_dump
│   └── agents/                        #   Council of Experts orchestration
│
├── docket_agent/                      # NEW — one installable Python package
│   ├── __init__.py                    #   (replaces four sibling dirs needing sys.path hacks)
│   ├── cli.py                         #   `docket-agent run` — idle-with-budget, §8.1
│   ├── queue.py                       #   claim/heartbeat/lease/complete against system_jobs
│   ├── allowlist.py                   #   job_type allowlist + params schema (§11.2)
│   ├── scrapers/nyscef.py             #   two-phase; internal ID; ~60-query budget
│   ├── scrapers/pacer.py              #   NextGen CSO / PCL; token rotation
│   ├── ocr.py                         #   text-layer audit → Document AI | ocrmypdf fallback
│   ├── extract.py                     #   PyMuPDF text+bbox for native PDFs
│   ├── store/r2.py                    #   canonical bytes + text/ markdown
│   ├── store/postgres.py              #   sources, source_pages, source_excerpts, docket.entries
│   ├── exports/drive.py               #   service account; mirror, best-effort
│   ├── exports/notebooklm.py          #   wraps `nlm`; isolated, easy to disable
│   └── credentials.py                 #   macOS Keychain access
│
├── mcp_server/
│   └── server.py                      # §9 tools; hard-fail on missing `mcp`
│
├── scripts/
│   ├── seed_matters.py                # 27 matters from Notion → matters + docket.entries
│   └── reindex_search.py              # rebuild AI Search / pgvector from Postgres
│
├── supabase/migrations/
│   ├── 001_initial_schema.sql         # existing
│   ├── 002_casevault_alignment.sql    # §6.5 delta: renames/folds/drops, vector+citext+pgcrypto
│   ├── 003_rls_and_auth.sql           # §11.1
│   ├── 004_docket_extension.sql       # §6.3
│   ├── 005_system_jobs_hardening.sql  # §6.4 + claim_next_job() + Realtime publications
│   └── 006_seed_matters.sql
│
├── tests/
│   ├── fixtures/                      # golden set (§14.2)
│   └── test_citation_fidelity.py
│
└── src/                               # Next.js static export
    ├── app/{layout,page,globals.css}
    ├── components/
    │   ├── CasesView.tsx              # NEW
    │   ├── DocketTable.tsx
    │   ├── PdfViewerPanel.tsx         # REWRITE on pdfjs-dist + bbox overlay
    │   ├── MindMapCanvas.tsx          # REWRITE on @xyflow/react
    │   ├── NyscefScraperModal.tsx     # → job-submission form
    │   └── JobsPanel.tsx              # NEW; Realtime + session budget
    └── lib/{types,supabase,api}.ts
```

**Remove `next.config.mjs`'s `typescript.ignoreBuildErrors` and `eslint.ignoreDuringBuilds`.** Both are
`true` today, so `npm run build` succeeds regardless of correctness — for a ground-up rebuild they hide
exactly the errors you want caught. Flip them off early; they are cheap to fix now and expensive after
sixteen milestones of accumulated errors.

---

## 14. Verification

v3.0 had no test strategy. For a product whose promise is *verified pinpoint citations* used in filings, that
is the most conspicuous omission.

### 14.1 The citation spike (do this before M8/M9)

Time-boxed, one question: **do Document AI bounding boxes, mapped back through `transforms[]`, land correctly
on a `pdfjs-dist` render of the original PDF?**

1. One **image-only** PDF and one **native-text** PDF through both paths (Document AI; PyMuPDF).
2. Confirm both yield one uniform span format — native and OCR'd pages must be indistinguishable downstream.
   This is the likeliest failure.
3. Load into the **CaseVault shape** (`source_pages.layout_json`, `source_excerpts.anchor_json`), not a
   bespoke table, so the spike validates the shared schema simultaneously.
4. Render with `pdfjs-dist` under `output: 'export'`; click a citation → correct page, correct box, correct
   scale, in a `lg:col-span-5` panel.
5. **Decide**: good fidelity on both → full precision. Native clean but OCR'd drifts → page-level citation for
   OCR'd documents, box-level for native, recorded per entry. pdf.js fights static export → surface it now,
   not during the mind-map milestone.

Record the outcome in `WORKLOG.md` before M8/M9 start.

### 14.2 Golden fixture set

A handful of real filings — at least one scanned, one native-text — with expected OCR text, expected page/bbox
for known phrases, and expected answers plus citations for 10–20 known questions. Run on every change to OCR,
chunking, or retrieval. This is the only way to know §7 actually works, and it makes M8/M9 reviewable instead
of vibes-based.

---

## 15. Milestones

```
☑ M1  Project scaffold (Next.js, Tailwind, Cloudflare Pages static export)
☑ M2  Supabase schema v1 (001_initial_schema.sql)
☒ M3  nlm NotebookLM connector          — NOT STARTED (v3.0 marked done; no such file exists)
☒ M4  Seed 27 cases from Notion         — NOT STARTED (no seed migration; 3 mock cases, never written to a DB)
☑ M5  BUILD_SPEC                        — this file (v4.0)

☐ M0  SECURITY (gates everything, blocks nothing else)
       RLS migration + single-user Supabase Auth · rotate the hardcoded key out of
       src/lib/supabase.ts · service-role key to Keychain/Worker secrets ·
       job_type allowlist + params validation · pg_dump → R2 cron

☐ M-Spike  Citation fidelity spike (§14.1) — decides §7.4 and the shape of M8/M9

☐ M6  Schema alignment to CaseVault
       002 delta (renames/folds/drops) · workspace_id everywhere · citext/pgcrypto/vector ·
       CaseVault naming conventions · 004 docket.entries · 005 system_jobs hardening +
       claim_next_job() + Realtime publications · ocr_status unification

☐ M7  Credentials (was: Google OAuth + Drive export)
       Dedicated GCP project · service account · one shared Drive folder ·
       Cloudflare API token · macOS Keychain layer · best-effort mirror to Drive

☐ M8  Retrieval (was: build a native RAG engine — now mostly configuration)
       R2 bucket + path filtering (raw/ excluded, text/ included) ·
       AI Search instance on google-ai-studio/gemini-embedding-001 @1536 ·
       paragraph-level chunking from Document AI output · pgvector copy ·
       citation-resolution path to source_excerpts.anchor_json

☐ M9  OCR pipeline
       text-layer audit · Document AI primary (sync <15pp, batch above) ·
       ocrmypdf fallback · transforms[] → bbox mapping · source_pages/source_excerpts writes ·
       sha256 + simhash dedupe

☐ M10 Acquisition: NYSCEF
       two-phase (resolve internal ID under CAPTCHA, then refresh uncaptcha'd) ·
       ~60-query session budget with counter + priority order · pdf_url extraction (missing today) ·
       rate limiting (missing today) · int/date parsing · 750ms backoff

☐ M11 Acquisition: PACER
       FIRST evaluate the NEF free-copy email path for matters where you are a party —
       it may shrink this milestone substantially · NextGen CSO with X-NEXT-GEN-CSO rotation ·
       PCL for discovery only (it returns no documents) · ECF for retrieval ·
       $30/quarter running total

☐ M12 Cloud agent tier (NEW — did not exist in v3.0)
       Worker: cron keep-alive · Sentinel staleness scan → enqueue · document proxy
       (R2 binding, JWT-authorised) · Council of Experts on agent_personas/agent_runs ·
       AI Gateway for generation

☐ M13 Local ingestion daemon
       pyproject.toml + one installable package · claim/lease/heartbeat loop ·
       dispatch allowlist · idle-with-budget lifecycle · LaunchAgent or .command launcher

☐ M14 Mind map rewrite on @xyflow/react over actors + matter_links

☐ M15 UI: honest state (§10.1) + JobsPanel (Realtime + session budget) +
       NyscefScraperModal → job-submission form + pdfjs-dist viewer with bbox overlay +
       remove ignoreBuildErrors/ignoreDuringBuilds

☐ M16 Seed 27 matters from Notion → matters + docket.entries + actors

☐ M17 Golden fixture set + CI (§14.2)

☐ M18 (Later) Converge/CaseVault convergence: actor identity spine, cross-pillar
       search over the shared 1536-dim space, fact_support_links from Converge sources
```

**Ordering note**: M10 (NYSCEF) is promoted well above its v3.0 position. It is the only source that works
today, its two-phase design is now known, and it is what makes the product real. PACER (M11) is demoted below
it and should not start until the NEF free-copy question is answered.

---

## 16. Deferred, open, and cross-repo

### 16.1 Raise with CaseVault, do not decide unilaterally

1. **Embedding standard.** Docket-Key proposes `gemini-embedding-001` @ 1536 to match CaseVault's declared
   `VECTOR(1536)`. But CaseVault §7 recommends tsvector + pgvector **in Postgres**, whereas Docket-Key puts
   the fast hybrid path in AI Search. Now that both use the same model/dimension/metric the vector spaces are
   compatible — but if CaseVault wants **one index spanning docket + converge + casevault sources**, decide
   deliberately: CaseVault adopts AI Search, Docket-Key dual-writes to pgvector (the current plan), or you
   federate at query time.
2. **`system_jobs` hardening** (§6.4) — CaseVault's version has the same missing lease/priority/attempts.
   Fix once, in the shared table.
3. **`gemini-embedding-2`** (8,192 tokens, image support, same 1536 dims) vs `-001`. CaseVault's draft names
   a dimension, not a model.
4. **Who runs CaseVault's "Python API"?** CaseVault assumes a typed frontend + Python API + async workers.
   The natural answer is that **the Workers tier plus the local daemon serve both projects** — they already
   own OCR, the queue, and MCP. Confirm, because it determines whether `system_jobs` has one worker or two.
5. **Local-first vs cloud-canonical.** CaseVault's principle #6 says *"store file metadata and storage keys,
   but do not assume cloud storage."* Docket-Key uses R2 as canonical. This is **compatible** — `storage_path`
   is a TEXT key, so `r2://…` is a legal value, and principle #6 says don't *assume* a cloud, not don't *use*
   one — but CaseVault should know its docket connector is cloud-canonical.

### 16.2 Converge

Converge's SQLite is an ingestion artifact, not a commitment; once extracted its data can land in the same
Postgres. Converge is the **primary feeder for actor identity** (§8.4). Its communications become `sources`
(`source_status: testimony`) feeding `fact_support_links`. **Do not design Docket-Key around Converge's
current SQLite shape.**

### 16.3 Explicitly out of scope

- Proof Graph Auditor contradiction logic — CaseVault's, not ours.
- Any federation layer or cross-pillar runtime reads.
- Multi-user, multi-workspace UI — the schema carries `workspace_id`, the product does not expose it.
- CAPTCHA-solving services of any kind — ruled out on ToS/ethics grounds against a government system.
- AI-sharing policy enforcement in Docket-Key — populate `ai_sharing_policy`, do not enforce.
- Human review gate on docket pulls — keep the provenance machinery, auto-accept.

### 16.4 Corrected external facts

Recorded in full in `WORKLOG.md`; summarised here because v3.0 stated otherwise:

| v3.0 claim | Reality |
|---|---|
| `text-embedding-004`, 768-dim | **Shut down 2026-01-14.** → `gemini-embedding-001` @1536 |
| "mixing 1.5 Pro / 1.5 Flash" | **All shut down 2025-09-29.** → current Gemini 2.5-family, verified at build time |
| "Supabase Vault / `pgsodium`" | pgsodium **not recommended, pending deprecation**; Vault supported. → Vault only, or Keychain |
| PCL API replaces ECF scraping | PCL is **search-index only**; retrieval is still ECF. CSO token expires and rotates |
| "$0.10/page, capped at $3.00/document" | Correct but incomplete: **≤$30/quarter is waived outright**; docket reports are billable; parties of record get a free copy by NEF email |
| `drivedigital/notebooklm` may be an abandoned pre-`nlm` implementation | Created **~24 h before this review**; an AI Studio applet; **in-memory token, no refresh token**; requests full `auth/drive`; unlicensed |
| `apark2020/nyscef-downloader` has DocumentList selectors and anti-bot patterns | **Neither exists.** Abandoned after two days in 2022. Its *README* supplies the two-phase insight and the ~60-query budget |
| `kshidenko/rag-memory-pg-mcp` may be a structure-aware RAG base | **Naive 500-character chunking**, JavaScript, 0 stars, unlicensed. Worth stealing one idea: hybrid FTS + vector |
| `drivedigital/casevault` / `converge` need reconnaissance | Both now public. CaseVault **already designs ~55 tables** and casts docket systems as a connector (§1) |
| §3.1 "unchanged field extraction (`…pdf_url`), 750ms backoff" | The code extracts **five** fields, **never** `pdf_url`, and has **no** rate limiting, backoff, or retry |

---

## 17. Changelog

**v4.0 (2026-10-03)**

- **Architecture**: Docket-Key reframed as a **CaseVault connector**; CaseVault's schema adopted; v3.0's
  `shared.*`, `docket.jobs`, `docket.vector_embeddings`, `docket.cases` and its provider/agent abstraction
  all withdrawn (§1, §6).
- **Topology**: three tiers. New always-on **Cloudflare Workers** agent tier; the local component is reduced
  to acquisition only (§2, §8).
- **Storage**: **R2 canonical** (was Supabase Storage); Drive demoted back to mirror; local backup retained
  (§3).
- **Retrieval**: **Cloudflare AI Search** for hybrid retrieval + built-in MCP; pgvector copy in the **same
  1536-dim Gemini space** as CaseVault (§7, §9).
- **OCR**: **Document AI primary**, `ocrmypdf` fallback — inverting v3.0 §3.2 (§5.1).
- **NYSCEF**: two-phase design; **~60-query session budget** as the binding constraint (§4.2).
- **PACER**: PCL is discovery-only; NEF free-copy path to be evaluated first; $30/quarter waiver (§4.3).
- **Security**: RLS + Supabase Auth; queue treated as untrusted input; `pg_dump` → R2 (§11).
- **Credentials**: Google **service account** replaces the OAuth auth-code flow (§4.1).
- **Models**: dead `text-embedding-004` and Gemini 1.5 replaced (§7.1, §8.3, §16.4).
- **Citations**: positional layer added (`source_pages.layout_json`, `source_excerpts.anchor_json`), a
  renderer named (`pdfjs-dist`), and a spike defined (§7.4, §14.1).
- **Verification**: golden fixture set, CI, and removal of the build blinders (§14, §13).
- **Milestones**: M0 and M-Spike added; M3/M4 reset to not-started; M8 largely deleted; M7/M9 reduced;
  NYSCEF promoted above PACER (§15).
- **UI**: honest-state requirement made explicit (§10.1).
- Decisions taken *against* this review's recommendations, and honoured here: **no human review gate** on
  docket pulls (§5.3), **no AI-sharing gate** (§5.4).

> `docs/SPEC_V3_REVIEW.md` is a **review history**, not guidance. It accretes over five rounds and contains
> explicit reversals — §1.5 is reversed by §B, §G6 is superseded by §H3, and §H1 is corrected by §I1. Read
> `docs/DECISIONS.md` for the current position.
