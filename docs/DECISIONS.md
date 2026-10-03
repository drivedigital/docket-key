# Docket-Key — Condensed Decision Record

**Covers**: five rounds of plan review, 2026-10-03.
**Authoritative spec**: `BUILD_SPEC.md` v4.0. **Research evidence**: `WORKLOG.md`.
**`SPEC_V3_REVIEW.md` is history, not guidance** — it contains reversals (see §4 below).

---

## 1. Where the plan landed

**Docket-Key is a CaseVault *connector*, not a co-equal pillar with its own schema.** It owns three things —
acquisition (NYSCEF/PACER), positional OCR, and the court-record UI — and delegates matters, actors, sources,
spans, jobs, providers, proposals, and audit to CaseVault's existing ~55-table PostgreSQL schema.

```
WEB (Cloudflare Pages, static)          Supabase Auth + RLS; pdfjs-dist; AI Search UI
        │
CLOUD AGENTS (Workers + Cron, ALWAYS ON) Sentinel scheduling · retrieval · Council of Experts
        │                                document proxy (R2 binding) · keep-alive · pg_dump→R2
        │  system_jobs queue (acquisition only)
        ▼
LOCAL DAEMON (Mac, user-launched)        NYSCEF only: headed Playwright + human CAPTCHA
                                         + ~60-query budget · PACER · upload · Document AI
        ▼
R2 (canonical bytes) · Supabase Postgres (system of record) · AI Search (retrieval index)
pgvector @1536 (shared space) · Google Drive (mirror) · local Mac (backup)
```

Pipeline: acquire → sha256 → R2 `raw/` → text-layer audit → **native?** PyMuPDF : **scanned?** Document AI →
one canonical positional text layer → Postgres (`sources`, `source_pages.layout_json`,
`source_excerpts.anchor_json`, `docket.entries`) → R2 `text/` → AI Search auto-indexes → pgvector copy →
Drive mirror (best-effort). Citation: AI Search hybrid hit → Postgres resolves page + bbox → Worker streams
the PDF → pdf.js draws the box.

---

## 2. Decisions

| # | Decision | Note |
|---|---|---|
| D1 | **RLS + Supabase Auth**, single user; service-role key to daemon/Workers only | Non-negotiable: public `pages.dev` + anon key in bundle + RLS-off + writable queue = strangers could enqueue work the Mac executes with your Google/PACER credentials |
| D2 | **Adopt CaseVault's schema**; create no `shared.*`, no `docket.jobs`, no `docket.vector_embeddings`, no second provider/agent model | CaseVault already designs all of them, better. Only new DDL: `docket.entries` |
| D3 | **Cloud agent tier (Workers, always-on) + local daemon (acquisition only)** | Replaces v3.0's single local Agent and its "no server exists" premise |
| D4 | **Agent self-enqueues via cron**; Sentinel scans staleness daily, daemon drains by priority within the session budget | Fixes v3.0's missing scheduler — "monitored cases" were not monitored |
| D5 | **R2 canonical**; Supabase relational only; Drive = mirror; local copy = backup | Worker reads R2 via a binding → **no Google OAuth on any critical path** |
| D6 | **Cloudflare AI Search** for retrieval; **`google-ai-studio/gemini-embedding-001` @1536, cosine** | 1536 matches CaseVault's `VECTOR(1536)` exactly → one shared vector space, cross-queryable, regenerable. **Do not accept the 1024-dim qwen3 default** |
| D7 | **Google Document AI primary** for OCR; `ocrmypdf`/Tesseract demoted to offline fallback | Inverts v3.0 §3.2. A laptop-off cloud agent cannot run `ocrmypdf`; the local machine is underpowered |
| D8 | **Index extracted text into AI Search, never the raw PDF** | One canonical text layer; sidesteps AI Search's 10 MiB OCR cap; spends the 5-metadata-field limit well |
| D9 | **Google service account**, one shared Drive folder, dedicated GCP project | No consent screen, no verification, no expiry, no public audience; sidesteps `drive.file` per-client-ID scoping |
| D10 | **No human review gate** on docket pulls *(against recommendation — user's call)* | Keep the provenance machinery anyway: land in `connector_results` with `review_state='accepted'`, upsert on `(matter_id, doc_number)` so a re-pull corrects rather than duplicates |
| D11 | **No AI-sharing gate** *(against recommendation — user's call)* | Still populate `matters.ai_sharing_policy` (NOT NULL) so CaseVault's future enforcement sees no nulls |
| D12 | **Daily Cloudflare cron keep-alive** | Defeats Supabase free tier's 7-day inactivity pause; makes Pro unnecessary |
| D13 | **`pg_dump` → R2 on the same cron** | Free tier has no backups; this closes the relational gap |
| D14 | **Converge is the authority on actor identity** | Docket-Key proposes `actor_aliases` + `duplicate_merge` proposals; it does not own dedup. Converge's SQLite is an ingestion artifact, not a commitment |
| D15 | **Time-boxed citation spike before M8/M9** | One question: do Document AI bboxes, mapped back through `transforms[]`, land correctly on a pdf.js render? |
| D16 | **Daemon idles rather than exits**, with budget awareness | Preserves a precious ~60-query CAPTCHA session |

---

## 3. Corrections to v3.0's external facts

| v3.0 said | Actually |
|---|---|
| `text-embedding-004`, 768-dim | **Shut down 2026-01-14** → `gemini-embedding-001` @1536 |
| "mixing Gemini 1.5 Pro / 1.5 Flash" | **All 1.5 models shut down 2025-09-29** → current 2.5-family, verified at build time; `agents.model` default and README are stale too |
| "Supabase Vault / `pgsodium`" | pgsodium **not recommended, pending deprecation**; Vault supported → Vault only, or Keychain |
| PCL API replaces ECF scraping | PCL is a **search index only** — no docket sheets, no PDFs. Retrieval is still ECF. `X-NEXT-GEN-CSO` expires and rotates |
| "$0.10/page, cap $3.00/doc" | Incomplete: **≤$30/quarter waived outright**; docket reports billable; **parties of record get a free copy by NEF email** — evaluate before building M10 |
| NYSCEF is CAPTCHA-bound, 30–120 min TTL | **Only Case Search is gated.** Direct internal-docket-ID access needs **no CAPTCHA** → two-phase design. The real constraint is a **~60-query budget**, not a TTL |
| §3.1 "unchanged extraction (`…pdf_url`), 750ms backoff" | Code extracts **five** fields, **never** `pdf_url`, and has **no** rate limiting, backoff, or retry |
| `drivedigital/notebooklm` might be an abandoned pre-`nlm` implementation | Created **~24 h before review**; an AI Studio applet; **in-memory token, no refresh token**; requests full `auth/drive`; unlicensed |
| `apark2020/nyscef-downloader` has DocumentList selectors + anti-bot patterns | **Neither exists.** Abandoned after two days in 2022; unlicensed. Its *README* supplied the two-phase insight and the query budget |
| `kshidenko/rag-memory-pg-mcp` might be a structure-aware RAG base | **Naive 500-*character* chunking**, JavaScript, 0 stars, unlicensed. One idea worth taking: hybrid FTS + vector |
| `casevault` / `converge` need reconnaissance | Both public. CaseVault has a **1,713-line ~55-table schema** and its Technical Spec §14.5 lists **"docket systems" as a future connector** |
| All three research repos: "check the licence" | **All three unlicensed** → no grant to copy. Build fresh; `jacob-bd/gemini-notebook-mcp-cli` is MIT and safe to depend on |

---

## 4. Reversals — do not act on the superseded advice

The review accreted over five rounds as new evidence arrived. Explicit reversals:

1. **"Drop the `shared` schema, there's nothing to be compatible with"** (§1.5) → **reversed** once CaseVault
   was published (§B): don't drop the cross-pillar layer, **adopt CaseVault's** instead of inventing a third.
2. **"Supabase Storage canonical + Drive mirror, buy Pro"** (§G6) → **superseded** (§H3) once AI Search/R2
   entered: **R2 canonical**, and Pro becomes unnecessary because vectors and bytes left the 500 MB budget.
3. **"OAuth is disqualified by restricted-scope verification + CASA"** (§H1) → **corrected** (§I1): with
   ≤100 test users you never publish, so verification is irrelevant. The real obstacle is the **7-day
   refresh-token expiry caused by staying in Testing** — escaped either by `drive.file` (non-sensitive) +
   Production, or by the service account (D9).
4. **Milestone ledger**: v3.0 marked M3/M4/M5 done. **M3 and M4 were never started** (no NotebookLM
   connector; no seed migration — 3 mock cases, never written to a database). Reset in §15 of the spec.

Also found and not yet fixed: `src/lib/supabase.ts` is **dead code** (nothing imports it) and **hardcodes a
live publishable key**; the UI hardcodes "Supabase — Connected", fakes a scrape with `setTimeout` + `alert`,
renders a **fake court letterhead** instead of a PDF, has a search box that filters nothing, and advertises
`/api/mcp` which `output: 'export'` cannot serve. All addressed by spec §10.1 / M0 / M15.

---

## 5. Costs

**~$17 one-time, ~$0–2/month.**

| | |
|---|---|
| AI Search backfill (~16M tokens incl. OCR) | **~$14 once** |
| AI Search ongoing ingest + storage | **$0** (5M tokens/mo, 10 GB-mo included) |
| AI Search queries | **~$0–1/mo** — ⚠ 1,000 semantic included; daily monitoring of 27 matters ≈ **810/mo before you ask anything**; overage $0.75/1k |
| Document AI OCR (scanned minority only) | **~$3–6 once** |
| R2 (~675 MB, no egress fees) | **$0** (10 GB free) |
| Supabase | **$0** (Pro $25/mo optional, backups only) |
| Gemini embedding | a few $ — billed via AI Gateway to your Google account, outside AI Search's allowance |
| PACER | **likely $0** (≤$30/quarter waived) |
| AI Search billing begins | **1 Nov 2026** |

---

## 6. Open

**Raise with CaseVault — don't decide unilaterally:**
1. Embedding standard and whether CaseVault adopts AI Search, accepts Docket-Key's dual-write to pgvector, or
   federates at query time (needed if it wants one index across all three pillars).
2. `system_jobs` hardening — CaseVault's copy has the same missing lease/priority/attempts. Fix once.
3. `gemini-embedding-2` (8,192 tokens, image support, same 1536 dims) vs `-001`.
4. Whether the Workers tier + local daemon serve as CaseVault's "Python API + async workers" too.
5. Tell CaseVault its docket connector is **cloud-canonical** (R2), against its local-first principle #6 —
   compatible, since `storage_path` is just a TEXT key, but it should know.

**Action items:**
- Reset the exposed `web` OAuth client secret; it is unused by this design and must not be committed.
- Create a dedicated GCP project (the credential's `gen-lang-client-*` project is AI Studio-managed).
- Run the citation spike (D15) before M8/M9.

**Next build step**: **M0** (RLS, key rotation, allowlist, `pg_dump` cron) — gates everything, blocked by
nothing. Then **M-Spike**, then **M6**.
