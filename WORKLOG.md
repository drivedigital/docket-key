# WORKLOG

Per BUILD_SPEC v3 §10, each external-repo research task must produce a findings note here
**before** the corresponding milestone is marked started. All three tasks are now complete
(researched 2026-10-03 with live repo + web access).

---

## 2026-10-03 — Milestone ledger audit

The spec marks M1–M5 complete. Verified against the working tree at `670e18e`:

| MS | Claim | Actual state | Verdict |
|----|-------|--------------|---------|
| M1 | Next.js + Tailwind + CF Pages static export scaffold | Present and coherent (`output: 'export'`, `wrangler.jsonc`, Tailwind 3) | **Done**, but see caveats below |
| M2 | Supabase schema v1 | `001_initial_schema.sql` exists: 7 tables in `public`, Realtime on 3 of them | **Done** |
| M3 | `nlm` NotebookLM connector, export-only, wrapped | `mcp/notebooklm_connector.py` **does not exist**. Zero references to `nlm`/`notebooklm` anywhere in the repo. `mcp/server.py` has none of the 5 tools in §7 | **Not started** |
| M4 | Seed 27 cases from Notion | `002_seed_notion_lawsuits.sql` **does not exist**. `scripts/seed_supabase.py` **does not exist**. `mockData.ts` has **3** hardcoded cases, never written to any DB | **Not started** |
| M5 | BUILD_SPEC v3 (this document) | `BUILD_SPEC.md` **does not exist** in the repo. Also missing: `ROADMAP.md`, `AGENTS.md`, `WORKLOG.md` (this file) | **Not committed** |

M1 caveats worth recording:
- `src/lib/supabase.ts` is **dead code** — nothing imports it. The entire UI runs on `mockData.ts`.
- `typescript.ignoreBuildErrors: true` and `eslint.ignoreDuringBuilds: true` are set, so `npm run build`
  will succeed regardless of correctness. No tests, no CI, no lint gate.
- No Python dependency manifest of any kind (`requirements.txt` / `pyproject.toml` absent), despite
  `mcp/server.py` and `scraper/nyscef_engine.py` importing `mcp`, `requests`, `bs4`, `playwright`.
- A live Supabase publishable key is hardcoded as a fallback in `src/lib/supabase.ts`.

---

## 2026-10-03 — Research Task #1: `drivedigital/notebooklm` (gates M7 / §2.1)

**Verdict: do not port anything. The repo does not contain the pattern §2.1 assumes exists.**

Spec asked whether it predates and was superseded by `nlm`. It does not.

- **Age**: created `2026-10-02T23:42Z`, last push `2026-10-03T00:02Z` — roughly 24 hours old at time of
  research. `jacob-bd/gemini-notebook-mcp-cli` was created `2025-12-23`, has 6,212 stars, and was pushed
  `2026-10-02`. So `drivedigital/notebooklm` cannot be an abandoned predecessor, and its existence carries
  **no signal** about the durability of the `nlm` approach. §2.1's investigative framing is based on a
  false premise and should be rewritten.
- **What it actually is**: a Google AI Studio "applet" export — Vite + React 19 + Express (`tsx server.ts`),
  `firebase-applet-config.json`, root `index.html`. Its own `.env.example` says "AI Studio automatically
  injects this at runtime… with the Cloud Run service URL." It is a hosted web app, **not** a local,
  user-launched process. It is the opposite of our deployment constraint.
- **OAuth flow type**: Firebase Auth `signInWithPopup(GoogleAuthProvider)` in the browser, with a
  Google Identity Services path using a hardcoded client ID. **Not** a server-side auth-code exchange.
- **Token storage — the critical finding**: `src/services/auth.ts` holds
  `let cachedAccessToken: string | null = null`, commented "Cache the access token strictly in memory."
  **There is no refresh token and no persistence at all.** So the answer to §2.1's question
  "if it already solves encrypted token storage for a local-only tool, reuse that pattern" is:
  it does not solve it, and its pattern is *actively unusable* for a not-always-on Agent — every launch
  would need an interactive popup, and the token dies in ~1h and on process exit.
- **Scopes — FLAGGED, broader than `drive.file`**: it requests four scopes simultaneously —
  full `auth/drive`, `drive.file`, `drive.readonly`, `drive.metadata.readonly`. Full `drive` subsumes the
  other three, so this is redundant *and* is a Google **restricted scope**, which triggers OAuth
  verification / annual third-party security assessment for production apps. §2.1 said to flag this.
  Flagged: do not copy.
- **License**: `null`. No license = all rights reserved. No grant to copy code.
- Incidental: a real GCP OAuth client ID is committed in public source. Not a secret per se, but it belongs
  to a different project than docket-key would use.

**Decision for M7**: build the OAuth flow fresh. Requirements the repo does not meet and we must design for:
server-side auth-code exchange with `access_type=offline` + `prompt=consent` to obtain a refresh token,
`drive.file` scope only, loopback-redirect (`http://127.0.0.1:<port>`) since the Agent is local, and
persistent token storage that survives Agent restarts.

---

## 2026-10-03 — Research Task #2: `apark2020/nyscef-downloader` (gates M11 / §3.1)

**Verdict: no code to extract — but its README contains two operational facts that materially change the
NYSCEF design, and §3.1 currently contradicts both.**

- **Age / maturity**: created `2022-09-04`, last push `2022-09-05`. A two-day-old project abandoned
  **four years ago**. 2 stars. No license. Ships committed `__pycache__/*.cpython-37.pyc`.
- **Contents**: `docket_id_fetcher.py`, `case_data_fetcher.py`, `json-to-sql.py`, `utils/courts.py`,
  `ids.txt`, and a committed 4.2 MB `data/child_victims_act_data.db`.
- **There is no DocumentList selector logic and no PDF download code** — §3.1's M11 asks to extract
  "selector logic for the DocumentList table." It is not there. The repo aggregates *case lists*, not
  filings or documents.
- **There is no anti-bot / fingerprinting code** — §3.1's M11 asks for "anti-bot-detection patterns already
  solved." Not there either. Its entire approach is a human pasting a `JSESSIONID` from DevTools, which is
  exactly the supervised model we already have. Nothing to learn beyond confirmation.

Two findings that *do* matter:

1. **CAPTCHA is only required for Case Search, not for direct docket-ID access.** README, verbatim:
   *"if you have a set of docket ids, there is no captcha requirement for going directly to the docket ids
   case information, so the other scripts run much faster."*
   This inverts §2.4, which frames all of NYSCEF as CAPTCHA-bound behind a 30–120 min `JSESSIONID`.
   Consequence: for cases we already track, routine refreshes may need **no live supervised session at all**.
   The correct architecture is two-phase — (a) resolve index number → internal docket/case ID once,
   under a supervised session; (b) refresh by internal ID thereafter, unattended. This also explains why
   `scraper/nyscef_engine.py` is broken: it passes the **index number** where NYSCEF expects the **internal
   case ID** (`ViewDocket?caseId={index_number}`), i.e. it skips phase (a) entirely.
2. **A `JSESSIONID` is good for fewer than ~100 requests; the author used 60 to be safe.** §3.1 mentions a
   750 ms backoff but never mentions a **per-session query budget**, which is the actual binding constraint.
   At 27 monitored cases, one full refresh pass ≈ 27 queries → roughly **two passes per CAPTCHA solve**.
   The Agent must count queries per session, prioritise which cases get refreshed, and re-prompt before
   exhaustion. The current UI already displays "Valid for ~60 queries", so this number was known and then
   dropped out of the spec.

**Caution**: the committed database is Child Victims Act litigation data (child abuse victims). Do not copy,
mirror, or vendor anything from `data/` or `ids.txt`. §3.1's "don't vendor wholesale" was justified on
schema grounds; the stronger reason is sensitivity plus the absence of a license.

---

## 2026-10-03 — Research Task #3: `kshidenko/rag-memory-pg-mcp` (gates M8 / §3.4)

**Verdict: naive chunking → per §3.4's own decision rule, do not use as a base. Steal one idea: hybrid
retrieval.**

- **Chunking strategy — the question §3.4 asked**: **naive fixed-size character splitting**, not
  structure-aware. `src/tools.js` exposes `maxChunkSize` (default **500 characters**) and `chunkOverlap`
  (default **50 characters**). Character-counted, no heading/paragraph/clause awareness. At 500 chars a
  single numbered affidavit paragraph would routinely be split mid-sentence.
- **Wrong language**: JavaScript/Node (`src/*.js`, `package.json`). Our Agent and MCP server are Python.
  Adopting it would add a second runtime to a local Mac process for no benefit.
- **Wrong shape**: it is a *memory/note* store (entities + relationships + documents), not a document
  ingestion pipeline. Embeddings are 384-dim via `text-embedding-3-small` or a local HuggingFace model —
  unrelated to our Gemini/pgvector plan.
- **Traction / staleness**: 0 stars, created `2026-01-05`, last push `2026-05-13` (~5 months stale).
- **License**: `null`. No grant to copy.
- **The one idea worth taking**: its `supabase-fts-setup.sql` + `hybridSearch` tool pair a `tsvector`
  column with a GIN index alongside pgvector, and merge the two result sets. §3.4 is **vector-only**, which
  is the wrong choice for legal text: queries hinge on exact tokens — index numbers (`150428/2024`),
  doc numbers, party and attorney names, dates, statute cites. Recommend M8 ship **hybrid retrieval**
  (pgvector cosine + Postgres FTS, fused by reciprocal rank) rather than semantic alone.

---

## 2026-10-03 — Verification of external platform claims in BUILD_SPEC v3

Checked against primary sources on 2026-10-03. Four claims in the spec are no longer true:

| Spec § | Claim | Status | Correction |
|--------|-------|--------|-----------|
| §2.2, §3.4 | `text-embedding-004`, 768-dim | **Shut down 2026-01-14** (Gemini API changelog) | Use `gemini-embedding-001`; MRL lets you pin output to 768 or 1536 dims. Keep ≤2000 dims for pgvector HNSW. Note its 2048-token input cap constrains chunk size. |
| §5.4 | "mixing 1.5 Pro / 1.5 Flash per latency needs" | **`gemini-1.5-pro`, `-flash`, `-flash-8b` all shut down 2025-09-29** | Use the current Gemini 2.5 family. `agents.model` default `'gemini-1.5-pro'` in `001_initial_schema.sql` is also stale, as is the README's "Claude 3.5 Sonnet, GPT-4o". |
| §4 | "Supabase Vault / `pgsodium`" | Supabase **does not recommend pgsodium**; it is pending deprecation. Vault is *not* deprecated and stays API-stable. | Say **Vault only**. Never use pgsodium / Transparent Column Encryption directly. Separately: Vault is reachable only via SQL with service-role privileges, so the *web* app can never read it — which is consistent with our topology, but the spec never states which component holds which credential. |
| §2.5 | "PCL API … instead of scraping ECF HTML"; "$0.10/page, capped at $3.00/document" | Partially misleading | Per the PCL API User Guide, PCL is a **case/party search index only** — it returns neither docket sheets nor PDFs. Document retrieval still goes through per-court ECF, i.e. the HTML path. So "official API, not scraping" holds for *discovery* only. Also: production PCL searches are billable; auth uses an `X-NEXT-GEN-CSO` header token that **expires and is re-issued in response headers**, so the Agent must persist and rotate it — unmentioned in §2.5. And the cost model is wrong in a way that matters: since 2020-01-01, **quarterly usage of $30 or less is waived entirely** (~75% of users pay nothing), while *docket reports themselves* are billable. For one pro se user the real guard is "stay under $30/quarter," not "$3/document." Finally, as a **party of record** the user gets one free copy of each newly filed document via the CM/ECF notification email link — for the user's own cases, harvesting those emails may be cheaper and more reliable than any API. |

Also confirmed: **`drivedigital/casevault` and `drivedigital/converge` do not exist** (not in the org repo
list; not resolvable under the org token). §9's instruction to "read enough of" them is not executable, and
§9's premise — that their entity representations must be checked for compatibility with `shared.entities` —
is checking compatibility against nothing.

---

## 2026-10-03 — Research Task #4 (added): sibling repos `casevault`, `converge`, `510W42`

`drivedigital/casevault` and `drivedigital/converge` were made public after the initial review; §9 is
therefore executable and its conclusion **reverses the recommendation in `SPEC_V3_REVIEW.md` §1.5.**

### `drivedigital/casevault` — "Legal Matter Intelligence Workspace"

Planning-artifact repo: `README.md` + five specs (PRD, Roadmap, Technical Spec, UX Spec, Database Schema
Draft). No code yet. The schema draft is **1,713 lines, ~55 tables**, PostgreSQL / SQLAlchemy 2.x / Alembic /
pgvector, UUID PKs, `pgcrypto` + `vector` + `citext`.

**It already designs, properly, most of what docket-key §4 tries to invent:**

| docket-key proposal | CaseVault already has | Delta |
|---|---|---|
| `docket.jobs` queue | `system_jobs` (job_type, target_type/id, status default `'queued'`, payload_json, result_json, error_text, created/started/completed_at) | Same shape; **also missing lease/heartbeat/attempts/priority** — fix once, not twice. `agent_run_status_enum` adds `partial`/`canceled` over docket-key's `pending\|running\|done\|failed`. |
| §4 `shared.entities` + `entity_relations` | `actors` (+ `normalized_name` "useful dedupe field"), `actor_aliases` (nickname/spelling), `matter_actor_roles` | CaseVault uses a **`role_label VARCHAR(64)` join table**, not a hardcoded enum — exactly the fix recommended in Tier 3. `actor_type_enum` is `person\|entity\|court\|agency\|other`; it has no `property`/`lien`/`event` actor types (`events` is its own table). |
| §3.4 `docket.vector_embeddings` (vector-only) | §7 "Full-Text and Vector Search Strategy": tsvector on `source_pages.ocr_text` + `source_excerpts.excerpt_text`, vector on the same two | **CaseVault already specifies hybrid FTS+vector** — the 2.4 recommendation, already designed. |
| *1.1's proposed* `document_pages` / `text_spans` | `source_pages` (page_number, page_label, ocr_text, **`layout_json` = "bounding boxes/layout"**, image_path, `VECTOR(1536)`, unique `(source_id,page_number)`) and `source_excerpts` (page_start/end, **`locator_text` = "paragraph/timestamp/Bates"**, `anchor_json` = "bbox/time ranges", excerpt_type, embedding) | The positional layer **already exists and is better specified** (Bates support, page labels, rendered page images). |
| `ocr_status` on `docket_entries` | `sources.ocr_status`, `sources.processing_status`, plus `evidence_review_status_enum` incl. **`privileged`, `settlement_restricted`, `impeachment_only`, `duplicate`**, and `included_flag`/`excluded_flag`/`exclusion_reason`/`authentication_notes`/`restrictions_notes` | docket-key has **no concept of evidentiary restriction or admissibility state** at all. |
| Tier-3 "add `content_sha256` for dedupe" | `sources.sha256` + index; `source_metadata.text_simhash` for **near**-duplicate fingerprinting | Already designed, and further (near-dup, not just exact). |
| §6 `ProviderConfig`/`AgentRoleConfig` | `ai_provider_configs`, `agent_personas`, `agent_runs`, `agent_run_steps`, `agent_run_dispositions`, `agent_run_artifacts` | Don't build a second provider layer. |
| §7 MCP server | `connector_configs` (`connector_type_enum` incl. `mcp`), `connector_runs`, `connector_results` | Don't build a parallel connector model. |
| §5.4 Proof Graph Auditor / contradiction | `proposals` (`proposal_type_enum` incl. **`contradiction`**, `date_normalization`, `duplicate_merge`, `claim_mapping`, `verification_task`, `restriction`; `review_state_enum`), `fact_assertions`, `fact_support_links` (`support_type: supports\|contradicts\|mentions\|background`), `claim_support_status_enum` (`conflicted`) | **This is CaseVault's core, already designed.** docket-key's Auditor role would duplicate it. |
| §5.5 mind map | `matters` + `matter_links` (`link_type VARCHAR(64)`, e.g. `overlays`/`related`, unique `(from,to,link_type)`) + `events` | Free-text link type again, not the `ground_lease\|nuisance_action\|mortgage_lien` enum. |
| §4 "no audit log" | `audit_log_entries` (actor_user_id null for system jobs, before_json/after_json, target_type/id) | Already designed. |

**Decisive**: Technical Spec §14.5 "Recommended initial connector categories → Later possibilities:
**docket systems**, email archives, transcript libraries, e-discovery exports." §14.4's flow ends
"user chooses import/reject/defer → import creates `source` or `authority` → normal ingest/OCR/review chain
begins." §14.6 requires provenance for every connector result (connector name, run id, external item id,
external URI, snippet, raw payload, import decision, imported local object id) — which `connector_results`
implements (`external_id`, `external_uri`, `provenance_json`, `raw_payload_json`, `review_state`,
`imported_source_id`).

Its closing summary: "modular **local-first** full-stack system with a typed frontend, **Python API**, async
evidence-processing workers, relational proof model, **hybrid retrieval**, **provider-agnostic AI layer**,
**MCP-based external connector framework**, and **strict review/audit controls** around factual record
creation."

→ **CaseVault already casts docket-key in the role of a connector, not a co-equal pillar with its own
`shared` schema.** Design principle #2 is explicit: *"Relational clarity over premature graph complexity —
use explicit join tables for core legal-analysis relationships."*

### `drivedigital/converge`

MIT, TypeScript, **TanStack Start + SQLite** — "unified iMessage + WhatsApp messaging viewer mapped to
Contacts" (threads, reactions, media, imports). Multiple `arena/*` branches. Note the stack mismatch:
SQLite + TS, versus CaseVault's Postgres + Python. Sharing a Supabase project implies a SQLite→Postgres
migration. Its data maps onto CaseVault `sources` (`source_type` email/text/image, `source_status:
testimony`), `actors` (contacts), `events` (message timeline), and `fact_support_links.support_origin_type:
user_memory`.

### `drivedigital/510W42` — ⚠️ PUBLIC

**`visibility=public`.** 269 files: 157 PDFs, 62 Markdown working papers, 9 CSV, 9 XML, images, a PPTX.
Contents include real litigation work product and sensitive material — e.g.
`DG_Settlement_Talks_Harvest.md`, `DG_UR_CGL_Tender_Working_Draft.md`, `DG_UR_Insurance_Working_Note.md`,
`Email_1318_Balance_Sheet_06_30_2024.pdf`, `Email_1318_P&L_Jan_-_June_2024.pdf`,
`DG_Part19_Affirmation_Working_Draft.md`, `DG_Part19_Exhibit_Ledger_2026-08-24.md`,
`DG_Overlapping_Dockets.md`, `DG_Claims_Triage.md`, `DG_CPLR_215_204_SOL_Working_Note.md`, plus bulk
`Email_*.pdf` exports of third-party correspondence.

This sits **outside every control CaseVault's own schema defines** — `sharing_policy_enum`
(`no_ai`/`local_only`/`external_excerpts_only`/`external_selected_full_documents`, workspace default
*conservatively* `external_excerpts_only`), `matters.ai_sharing_policy`, and `evidence_review_status_enum`'s
`privileged` / `settlement_restricted` / `impeachment_only` states. Flagged for the user's decision; not a
docket-key build issue, but directly relevant to §4's threat model and to where canonical files should live.

Useful as a **real fixture corpus** for the OCR/citation spike (1.1) and for `DG_Overlapping_Dockets.md` as
the likely true source of the cross-case relation data behind §5.5 and the "27 cases" in M4.
