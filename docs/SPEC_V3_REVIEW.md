# Review of BUILD_SPEC v3.0 — Docket-Key ground-up build

> ## ⚠ HISTORICAL DOCUMENT — NOT GUIDANCE
>
> This review accreted over five rounds (2026-10-03) as new evidence arrived, and it **contains explicit
> reversals**. Later sections supersede earlier ones:
>
> - §1.5 ("drop the `shared` schema") → **reversed by §B** once `casevault` was published
> - §G6 ("Supabase Storage canonical, buy Pro") → **superseded by §H3** once AI Search / R2 entered
> - §H1 ("OAuth disqualified by restricted-scope verification") → **corrected by §I1**
>
> **For the current position read `BUILD_SPEC.md` (v4.0) and `docs/DECISIONS.md`.** This file is retained
> only for the reasoning trail and the evidence behind each change.

**Reviewer note**: produced 2026-10-03 against working tree `670e18e` (branch `arena/01a0ffc3-docket-key`).
Research findings for §10's three external repos are in `WORKLOG.md`; this document covers the spec itself.

**Overall**: v3.0's central move — splitting into a static web app plus a user-launched local Agent joined by
one Supabase job queue — is the right call and is the single best idea in the document. Downgrading
NotebookLM and Drive from pipeline dependencies to best-effort export mirrors is also right, and the
reasoning for local-only OCR (§3) is correct and well-argued.

But the spec is not buildable as written. It has one internal contradiction that breaks its own headline
feature, one security hole that reaches into the user's laptop, three dependencies on models/APIs that have
already been shut down, and a milestone ledger that does not match the repository. Details below, ranked.

---

## Tier 1 — Must resolve before any milestone starts

### 1.1 §5.3 pinpoint citations are unimplementable with §4's schema

§3 justifies local-only OCR at length on exactly one ground: "Docket-Key's core feature (§5.3,
click-a-citation → highlight exact spot on exact page) requires a positionally faithful, searchable PDF."

Then §4 stores no positional data. `docket.docket_entries` gets `ocr_status`, `ocr_confidence`,
`text_layer_source`. `docket.vector_embeddings` gets chunk text. There is no page number, no bounding box,
no character offset anywhere in the schema. You cannot highlight a location you never recorded. The spec
establishes a hard requirement and then omits the only table that could satisfy it.

**Fix** — add a positional layer to §4, produced during the OCR pass (§3.2) rather than re-derived at
render time, consistent with the spec's own principle:

```sql
CREATE TABLE docket.document_pages (
  entry_id uuid REFERENCES docket.docket_entries(id) ON DELETE CASCADE,
  page_no  integer NOT NULL,
  width_pt real, height_pt real,          -- PDF user-space pts, needed to scale overlays
  PRIMARY KEY (entry_id, page_no)
);

CREATE TABLE docket.text_spans (          -- the citation -> pixel bridge
  id        bigserial PRIMARY KEY,
  entry_id  uuid REFERENCES docket.docket_entries(id) ON DELETE CASCADE,
  chunk_id  uuid REFERENCES docket.vector_embeddings(id) ON DELETE CASCADE,
  page_no   integer NOT NULL,
  bbox      numeric[4] NOT NULL,          -- x0,y0,x1,y1 in PDF user space
  char_start integer, char_end integer,   -- offsets into docket_entries.text_content
  text      text
);
```

Two consequences for other milestones:
- **§3.2 must emit coordinates.** `ocrmypdf --sidecar` gives text only. For boxes, use its hOCR output
  (`--pdf-renderer hocr`, or keep the `hocr` Tessdata intermediate) or re-extract with PyMuPDF /
  `pdfminer.six` against the *finished* searchable PDF so native-text and OCR'd pages yield one uniform
  span format. Whichever path, the spec must name it, because it determines M9's shape.
- **§5.2/§5.3 must name a PDF renderer.** There is none today (see 3.1), and `PdfViewerPanel.tsx` currently
  fakes a document with a `<div>`. Overlaying highlight boxes on a specific page requires `pdfjs-dist`
  (or `react-pdf`) with a custom annotation layer and page-viewport scaling. This is a real dependency and
  a real chunk of work; it is currently invisible in the plan.

### 1.2 "No RLS" + a public static bundle + a writable job queue = remote control of the user's Mac

§4 defers RLS entirely. Combine that with three facts the spec doesn't put next to each other:

1. The web app is a **static export on a public URL** (`docket-key.pages.dev`), so the Supabase anon key
   ships inside a world-readable JS bundle. `src/lib/supabase.ts` already hardcodes a real publishable key
   as a fallback.
2. With RLS off, the anon key grants **full read and write on every table**.
3. §1's integration contract is: rows appear in `docket.jobs` with `status='pending'`, and the Agent
   **executes them** — running Playwright, shelling out to `ocrmypdf`, uploading to Drive, invoking `nlm`.

So any stranger who loads the site can read the entire litigation analysis (entities, relations, mind-map
layouts, Q&A history, draft briefs), rewrite it, and **enqueue work that the user's own machine will
perform on their behalf** — with the user's Google and PACER credentials attached. `job_type` and `params`
being free-form `jsonb` makes this worse: the Agent dispatches on attacker-chosen strings.

"Single-tenant, pro se, private" describes the intended audience, not the exposed attack surface. A public
Pages deployment is not private because only one person knows the URL.

**Fix — pick one, and say which in the spec:**
- **(a) Minimal and recommended**: enable RLS on every table with a single `auth.uid() = '<your uuid>'`
  policy, sign in with Supabase Auth (email magic link is enough for one user), and give the **Agent** the
  service-role key held locally. Cost: ~1 migration + a login screen. This also makes Supabase Realtime
  safe, since `postgres_changes` honours RLS.
- **(b) If you truly want zero RLS**: the web app must not use the anon key at all — put a Cloudflare Worker
  or an Edge Function in front of Supabase holding the secret, and authenticate to it. That reintroduces a
  server, which §1 exists to avoid.

Independent of (a)/(b), the Agent must treat the queue as **untrusted input**: an allowlist of `job_type`
values, a `jsonb` schema check per type, no `params` value ever reaching a shell unquoted, and a hard rule
that no job type may specify a filesystem path or command. Worth one paragraph in §1.

Also in §4: **"Vault / pgsodium" should be "Vault only"** — Supabase explicitly does not recommend
pgsodium and it is pending deprecation, while Vault remains supported (see `WORKLOG.md`). And consider that
a Google refresh token and a federal-judiciary PACER credential are better kept in the **macOS Keychain**
on the Agent host than in a third-party database at all; Vault then becomes optional rather than load-bearing.

### 1.3 The NYSCEF design contradicts what the reference repo actually documents

§2.4 models all of NYSCEF as CAPTCHA-bound behind a 30–120 min `JSESSIONID`. Per
`apark2020/nyscef-downloader`'s README (full note in `WORKLOG.md`):

- **Direct access by internal docket ID requires no CAPTCHA.** Only *Case Search* (discovery by
  court + date) is gated. So the architecture should be two-phase: resolve index number → internal case ID
  **once** under supervision, then refresh by internal ID unattended. That is a large improvement to the
  user experience and it is not in the spec.
- **A session is good for ~60 queries, not "30–120 minutes."** The binding constraint is a *count*, not a
  *duration*. With 27 monitored cases a full refresh pass is ~27 queries → about two passes per CAPTCHA
  solve. The spec mentions a 750 ms backoff and never mentions the budget, so nothing in the plan decides
  which cases get refreshed when the budget runs out. The Agent needs a per-session counter, a refresh
  priority order, and a re-prompt path.

This also exposes a live bug: `scraper/nyscef_engine.py` builds
`ViewDocket?caseId={index_number}` — passing the human index number where NYSCEF wants the internal case ID,
i.e. it skips phase one entirely. §3.1 describes this module as "unchanged field extraction logic from v2
(`doc_number`, `entry_date`, `doc_type`, `description`, `filed_by`, `pdf_url`), 750ms rate-limit backoff."
Neither half is accurate: the code extracts **five** fields and never extracts `pdf_url`, and there is **no
rate limiting, backoff, sleep, or retry** anywhere in the file. §3.1 should be rewritten as "to be built,"
not "unchanged."

### 1.4 Three named dependencies have already been shut down

All verified against primary sources; details and replacements in `WORKLOG.md`:

- **§2.2 / §3.4 `text-embedding-004`** — shut down **2026-01-14**. Use `gemini-embedding-001` with MRL
  output pinned to 768 or 1536 dims (keep ≤2000 for pgvector HNSW). Its 2048-token input cap also
  constrains the chunk size that §3.4 leaves unspecified.
- **§5.4 "mixing 1.5 Pro / 1.5 Flash"** — `gemini-1.5-pro`, `-flash`, and `-flash-8b` all shut down
  **2025-09-29**. Move to the current Gemini 2.5 family. `agents.model`'s default `'gemini-1.5-pro'` in
  `001_initial_schema.sql` and the README's "Claude 3.5 Sonnet, GPT-4o" are stale the same way.
- **§2.5 PACER** — the PCL API is a **case/party search index only**; it returns no docket sheets and no
  PDFs. Document retrieval still runs through per-court ECF HTML, so "official API, not scraping" is true
  for discovery and false for retrieval, which changes M10's scope. Its `X-NEXT-GEN-CSO` token expires and
  is re-issued in response headers, so the Agent must persist and rotate it — unmentioned. And the cost
  model should be reframed: since 2020-01-01, **quarterly usage of $30 or less is waived outright**, while
  docket reports are themselves billable. For one pro se user the meaningful guard is "stay under
  $30/quarter," not "$3/document." As a **party of record** the user also gets one free copy of each newly
  filed document via the CM/ECF notification email — for their own cases, harvesting that mailbox may beat
  any API on both cost and reliability. Worth deciding before building M10.

### 1.5 §9 and §10 reference a repo state that does not exist

- `drivedigital/casevault` and `drivedigital/converge` **do not exist** (not in the org's repo list, not
  resolvable under the org token). §9's task — read them and confirm their entity representations are
  compatible with `shared.entities` — is not executable, and its justification ("cheap today, expensive
  after Docket-Key is live") is arguing for pre-building compatibility with nothing.
- **Recommendation: drop the `shared` schema from v1.** Keep entities and relations in `docket`. Introduce
  a cross-pillar layer when a second pillar actually exists and its real shape is known. Every column added
  now for an imaginary consumer is a column you must migrate later anyway. If you want to reserve the name,
  reserve it in a comment, not in DDL.
- Related: `shared.entities` as drafted is a **regression** from the existing `entities` table. It drops
  `primary_case_id`, and `entity_relations` drops `case_id` and `evidence_doc_number` in favour of an opaque
  `source_record_id uuid`. For a tool whose whole premise is provenance, "this edge is supported by
  case X, Doc #3, page 4" is the most valuable thing an edge can carry. Do not trade it for a generic
  foreign key. Keep typed provenance (`source_case_id`, `source_doc_number`, `source_page_no`) whatever
  schema the tables live in.
- §9's remaining valid item is trivial and can be closed now: multiple schemas coexist fine in one Supabase
  project; the only real gotchas are that `search_path` must be set explicitly per role and that the
  Realtime publication and any RLS policies must be added per-table regardless of schema.
- **All three research repos are unlicensed** (`license: null`) — `drivedigital/notebooklm`,
  `apark2020/nyscef-downloader`, `kshidenko/rag-memory-pg-mcp`. That is "all rights reserved," so there is
  no grant to copy code from any of them. §10 asks the engineer to "check license" without saying what
  happens if the answer is none. The answer settles the reuse-vs-build question for all three: **build
  fresh; treat them as read-only reference for ideas.** `jacob-bd/gemini-notebook-mcp-cli` *is* MIT, so
  depending on `nlm` as an external tool is clean.

---

## Tier 2 — Significant gaps that will cost rework

### 2.1 The job queue is under-specified for a worker that is not always-on

§4's `docket.jobs` is a reasonable sketch, but the whole architecture rests on it and it is missing the
mechanics that make a queue survivable:

| Missing | Why it matters here specifically |
|---|---|
| `claimed_at` + lease timeout + requeue | The Agent is **user-launched and gets killed** — laptop sleeps, user hits ⌘C, `ocrmypdf` crashes. Without a lease, a job dies in `running` forever and the UI shows a spinner that never resolves. |
| `attempt_count` / `max_attempts` / `next_retry_at` | NYSCEF sessions expire mid-batch and Drive rate-limits. Retry policy is the difference between a resilient Agent and one that silently loses filings. |
| `priority` | **§3.3 explicitly calls NotebookLM export "a lower-priority job type" — and there is no priority column.** Direct contradiction. |
| `idempotency_key` / `UNIQUE` on (job_type, target) | A user clicking "Pull Docket" twice, or a Realtime race, enqueues two scrapes for the same case. CAPTCHA sessions cost ~60 queries total (1.3), so duplicate work is expensive, not merely wasteful. |
| Atomic claim (`FOR UPDATE SKIP LOCKED` via an RPC) | `SELECT … WHERE status='pending' LIMIT 1` then `UPDATE` is racy. Wrap the claim in a `claim_next_job()` SQL function. |
| `agent_id` / `locked_by` | Cheap insurance if the Agent ever runs on two machines. |
| `cancelled` state, `retry_of` link | Needed for the Jobs panel to be honest about abandoned work. |

Two more, both cheap and both currently wrong:

- **`docket.jobs` is not in the Realtime publication.** §1 promises "Supabase Realtime pushes job status to
  the web UI" and M15 promises "Realtime status," but §4 never adds it and `001_initial_schema.sql` only
  publishes `cases`, `docket_entries`, `mind_maps`. Without `ALTER PUBLICATION supabase_realtime ADD TABLE
  docket.jobs`, the Jobs panel has no live updates and you are back to polling — the thing §1 says Realtime
  removes.
- **Nobody is specified to hold the Agent's Supabase credential.** Claiming jobs, writing results, and
  uploading to Storage all need more than an anon key. State it: service-role key, Agent-side only, Keychain
  or `.env` on the Mac, never in the web bundle. (This interacts with 1.2 — the web app gets a scoped
  identity, the Agent gets the powerful one.)

### 2.2 Nothing schedules a refresh, so the "Sentinel" role has no trigger

§5.4's first Council of Experts role is **Sentinel** — monitoring. §5.1 is a "Monitored Cases Hub." But the
only way work enters the queue is "the web app writes rows to `docket.jobs`" (§1), which means a human
clicking a button. The Agent is explicitly *not* always-on (§1), so there is no cron and no daemon. As
specified, monitoring is manual: the user must open the dashboard and press refresh to learn whether
anything changed, which is precisely the job the tool exists to do.

Pick one and write it into §1:
- **(a)** When the Agent starts, it self-enqueues refreshes for all cases whose `last_synced_at` is older
  than a threshold, subject to the ~60-query session budget (1.3) and a priority order. Simple, no new
  infra, and "run the Agent" becomes "catch up on everything." **Recommended.**
- **(b)** A tiny external scheduler (Cloudflare Cron Trigger, GitHub Action) that only *inserts* pending
  rows — no scraping, no secrets beyond a scoped insert key. Keeps the Agent dumb, but adds a third
  component to a two-component topology.
- **(c)** Accept manual-only and rename Sentinel, so the UI doesn't promise monitoring it can't deliver.

### 2.3 §4 reads as a schema but is actually a partial delta, and it silently drops three tables

`001_initial_schema.sql` creates seven tables: `cases`, `docket_entries`, `entities`, `entity_relations`,
`mind_maps`, `agents`, `queries`. §4 shows four: `cases`, `docket_entries`, `vector_embeddings`, `jobs`.
`mind_maps`, `agents`, and `queries` vanish without a word, and `queries` is the citation-bearing Q&A log
that §5.3 depends on. Present §4 as an explicit migration delta — add / rename / drop / keep — or as the
complete target schema. As written, an implementer cannot tell what survives M6.

Three-way inconsistency to resolve in the same pass:

- **`ocr_status` has two incompatible vocabularies.** `001` and `types.ts` use
  `'pending' | 'digital_text' | 'cloud_ocr' | 'failed'`; §4 uses `'not_needed' | 'pending' | 'done' | 'failed'`.
  The second is better (it separates *state* from *provenance*), and §4's `text_layer_source` correctly
  subsumes the existing `has_text_layer` boolean — but the spec never says so, and the rename needs a data
  migration plus a `types.ts` / `DocketTable` / `PdfViewerPanel` update. Say it explicitly.
- **No pgvector anywhere.** `001` enables only `uuid-ossp` (and `gen_random_uuid()` is core since PG13, so
  that extension is unnecessary). §3.4 needs `CREATE EXTENSION vector;`, and §4's
  `docket.vector_embeddings ( ... )` is elided precisely where the dimension, index type, and distance
  operator live — the three things most likely to need a destructive rebuild if guessed wrong. Spell them
  out, tied to the corrected embedding model from 1.4.
- **No Storage design at all.** §1 and §3 both name Supabase Storage as the canonical store; there is no
  bucket, no path convention, no bucket policy, and no statement of public-vs-signed URLs. With RLS off
  (1.2), a public bucket publishes every filing. Also worth a reality check before M9: OCR'd PDFs of 27
  cases' worth of filings will move through gigabytes quickly, so the Supabase tier and its storage cap
  should be confirmed now, not discovered mid-pipeline.

### 2.4 §3.4's retrieval design is weaker than the one the research repo accidentally demonstrates

§3.4 specifies vector search only, with "200-token overlap" and **no chunk size**. Two problems:

- Legal retrieval is heavy on exact tokens — index numbers, doc numbers, party and attorney names, dates,
  statute cites. Pure semantic search underperforms on those. Adopt **hybrid retrieval**: pgvector cosine +
  Postgres FTS (`tsvector` + GIN) fused by reciprocal rank. This is the one genuinely good idea in
  `kshidenko/rag-memory-pg-mcp` (see `WORKLOG.md`) and it costs one column, one index, and one trigger.
  Consider a custom text-search config rather than `'english'` so legal abbreviations survive.
- Specify chunk size, and make chunking **structure-aware** as §3.4 already intends (headings, numbered
  paragraphs, affidavit clauses) — bounded by `gemini-embedding-001`'s 2048-token input cap. "200-token
  overlap" with no chunk size is not a spec. Note the anti-pattern from the reference repo: 500-*character*
  chunks would shred a numbered affidavit paragraph.

Crucially, chunks must carry the span/page linkage from 1.1, or retrieval returns text that cannot be
highlighted.

### 2.5 No test, eval, or verification strategy — for a tool whose entire value is accuracy

The spec has no testing section. That is a normal omission for a dashboard; it is not normal here, because
the product's promise is *"verified pinpoint citations"* in a litigation context, where a wrong page number
or a hallucinated quote has real consequences. Two things worth adding:

- **A golden fixture set.** A handful of real filings (including at least one scanned/image-only PDF and one
  with a native text layer) with expected OCR text, expected page/bbox for known phrases, and expected
  answers to 10–20 known questions with known citations. Run it on every change to OCR, chunking, or
  retrieval. This is the only way to know whether §5.3 actually works, and it makes M8/M9 reviewable instead
  of vibes-based.
- **Remove the build blinders.** `next.config.mjs` sets `ignoreBuildErrors: true` *and*
  `ignoreDuringBuilds: true`, so TypeScript and ESLint failures cannot block a deploy. For a ground-up
  rebuild, flip both off early — they are cheap to fix now and expensive to fix after 16 milestones of
  accumulated errors. `tsconfig.json`'s `target: "es5"` is also unnecessarily restrictive for a modern
  client-only bundle.

Related honesty problem in the current UI, which the rebuild should not carry forward: the sidebar shows
**"Supabase — Connected" in green as hardcoded text**, with no state behind it; the scraper modal runs three
`setTimeout` messages then `alert("Docket pull complete… Synced with Supabase")` having contacted nothing;
"PDF Preview" renders a fake court letterhead around a text dump; the in-document search box filters
nothing; and Settings advertises `https://docket-key.pages.dev/api/mcp` with a copy button — an endpoint
that **cannot exist**, since `output: 'export'` produces no server routes and the MCP server is a local
Python stdio process. For a litigation tool, UI that asserts false success is worse than UI that shows
nothing. Make connection state real, and make every destructive or long-running action report its true
outcome.

### 2.6 `docket.cases` cannot represent a PACER case

`cases` has `index_number TEXT UNIQUE NOT NULL` and `nyscef_url`. §2.5 and §3 add PACER as a first-class
source, but there is no `source_system`, and the mock data already shows the resulting confusion: case
`24-10892` is a **S.D.N.Y. bankruptcy matter** whose `nyscef_url` points at NYSCEF Case Search. Also,
`UNIQUE(index_number)` is wrong once two systems coexist — a NYSCEF index (`150428/2024`) and a federal
case number (`24-10892`) are different namespaces, and the same underlying dispute can appear in both.

**Fix**: add `source_system text NOT NULL` (`nyscef | pacer | manual`), `court_id` (PACER's court code),
and `source_case_id` (NYSCEF's internal docket ID from 1.3 / PACER's case id); replace the unique
constraint with `UNIQUE(source_system, index_number)`. Cheap now, painful later — and unlike §9's
speculative `shared` schema, this one has a concrete second consumer already in scope.

### 2.7 The Python side has no packaging, which blocks M12

There is no `requirements.txt` or `pyproject.toml`, no `__init__.py`, no pinned Python version, and no
`nlm`/`ocrmypdf`/Playwright setup documentation. §8 then proposes **four** sibling top-level Python
directories — `agent/`, `mcp/`, `ocr/`, `scraper/` — with the Agent importing from `scraper/` and `ocr/`,
which without a package means `sys.path` manipulation.

**Fix**: one installable package, e.g.

```
pyproject.toml            # pinned deps; python >= 3.11
docket_agent/
  __init__.py
  cli.py                  # entrypoint: `docket-agent run`
  queue.py                # claim/heartbeat/complete against docket.jobs
  scrapers/nyscef.py      # was scraper/nyscef_engine.py
  scrapers/pacer.py       # was agent/pacer_client.py
  ocr.py                  # was ocr/ocr_engine.py
  exports/drive.py        # was agent/oauth_drive.py
  exports/notebooklm.py   # was mcp/notebooklm_connector.py
  keychain.py             # credential storage (macOS Keychain / Vault)
mcp_server/server.py      # MCP is a separate process; keep it out of the agent package
```

This also makes M12's "Mac app" tractable: `pipx install -e .` plus a `.command` launcher or a
LaunchAgent the user starts manually. Note the spec says the Agent "exits or idles" (M12) — decide which.
Idling keeps a precious CAPTCHA session warm (1.3); exiting is safer and simpler. Given a ~60-query budget
rather than a fixed TTL, **idle-with-session-expiry-awareness** is probably right, but it should be a
stated decision, not an "or."

### 2.8 §7's MCP surface doesn't say where it runs or how it authenticates

§7 lists 12 tools reading cases, filings, document text, entities, and semantic search — all of which live
in Supabase. `mcp/server.py` today is a **hardcoded mock** returning literal strings with no DB access at
all, and its `except ImportError` fallback silently defines a fake `FastMCP` that prints and returns mocks
instead of failing loudly — so a missing dependency looks like a working server. Make the import hard-fail.

Then specify: the MCP server runs **on the Mac**, as a stdio server for Claude Desktop/Cursor, using the
same local credential as the Agent. Note that §7's `docket_request_job` / `docket_get_job_status` makes the
MCP server a *second* queue producer alongside the web app — good, and worth stating, since it means an
external agent can trigger scraping. That in turn makes 1.2's allowlist requirement apply to MCP input too.

Also correct the README/§8 assumption of a remote MCP endpoint; the Settings panel needs the real
configuration (a `claude_desktop_config.json` snippet), not a URL that 404s.

---

## Tier 3 — Smaller items worth folding in

- **§8's tree is aspirational, not current.** It lists `BUILD_SPEC.md`, `ROADMAP.md`, `AGENTS.md`,
  `WORKLOG.md`, `CasesView.tsx`, `notebooklm_connector.py`, `ocr/`, `agent/`, `scripts/`, and migrations
  `002`/`003` — none of which exist. Label it "target tree" and add the missing pieces 2.7 raises
  (`pyproject.toml`, tests, CI, `supabase/config.toml` for local dev).
- **`reactflow` was renamed.** M13 should depend on `@xyflow/react` (v12+), not the legacy `reactflow`
  package. Neither is in `package.json` yet. Today's `MindMapCanvas.tsx` is hand-rolled absolutely-positioned
  divs with a manual `scale` variable, so M13 is a full rewrite, not a refactor — budget it that way.
- **Relation vocabulary is over-fitted to one matter.** §4's `relation_type` list includes `ground_lease`,
  `nuisance_action`, `mortgage_lien` — these are facts about the 510 W 42nd dispute, not a general ontology,
  and `001` already uses a different set (`cross_moves_against`, `testifies_in`). Baking matter-specific
  predicates into a permanent enum guarantees churn. Prefer a small generic set
  (`adverse_to`, `represents`, `owns`, `guarantees`, `relates_to`, `testifies_in`) plus a free-text `label`
  and `metadata->>'subtype'` for matter-specific nuance.
- **Entity `category` vs `type`.** `001` uses `category` with a `judge` value; §4 uses `type` and drops
  `judge` from its list. Judges are central to a docket tool — keep them, and pick one column name.
- **No content dedupe.** The same exhibit gets filed in several related cases. Add `content_sha256` to
  `docket_entries` and skip re-OCR / re-upload on a hash match. Real savings in OCR time, Drive quota, and
  Supabase storage.
- **Cost of the two-level provider abstraction (§6) vs its payoff.** The interface is fine, but §6 says
  launch everything on Gemini and don't wire other SDKs. Then the abstraction has exactly one implementation
  on day one. Keep it as a thin function + config table, and resist building a provider registry until a
  second provider is actually needed — otherwise M14 is effort spent on a seam with nothing on either side.
- **`queries` table should store retrieval provenance**, not just `citations jsonb`: which chunks matched,
  their scores, and the span IDs from 1.1. Without it you cannot audit why an answer cited Doc #3 — which
  is the thing you most need when you're relying on it in a filing.

---

## Suggested milestone changes

Keep M6–M16's ordering instinct, but:

- **Insert M0 — security posture (gates everything).** Decide 1.2's option (a) or (b), rotate the exposed
  Supabase key out of `src/lib/supabase.ts`, write the RLS migration, add the login flow, and put the
  Agent's credential in Keychain. Small, and it must precede a public deploy of anything real.
- **M6 → expand.** Schema namespacing **only if** you keep `shared` (recommendation: don't); plus the
  `source_system` fix (2.6), the `ocr_status` reconciliation (2.3), the full job-queue mechanics (2.1),
  `CREATE EXTENSION vector`, Storage buckets + policies, and the Realtime publication additions.
- **M7 → re-scope.** Not "port from `drivedigital/notebooklm`" — that repo has nothing to port (1.5,
  `WORKLOG.md`). It's "build an offline-capable auth-code + refresh-token flow with `drive.file` only."
- **M8 → prepend the positional layer.** Spans/pages (1.1) and hybrid retrieval (2.4) belong here, and the
  golden fixture set (2.5) should be built alongside, not after.
- **M9 → add coordinate extraction** to the OCR pass, not just text and confidence.
- **M10 → re-scope after deciding the NEF-email question** (1.4). If the user is a party of record in the
  cases that matter most, email ingestion may cover them and M10 shrinks a lot.
- **M11 → promote.** Given 1.3, NYSCEF is the only source that actually works today and its two-phase
  design is now known. It is currently last-ish in the list behind PACER; it should come right after the
  queue and OCR, because it's what makes the product real.
- **M12 → split.** "Agent runtime + queue worker" (packaging, claim/heartbeat/lease, dispatch allowlist) is
  separable from "Mac app packaging" (launcher, Keychain, `nlm`/`ocrmypdf`/Playwright bootstrap). The first
  is on the critical path; the second is polish.
- **Add: honest-state milestone.** Replace the fake Connected indicator, fake scrape modal, fake PDF
  letterhead, and the impossible `/api/mcp` endpoint (2.5). Small, but it's the difference between a demo
  and a tool you can trust in a filing.

## Questions to settle before writing v3.1

1. **Security (1.2)**: RLS + Supabase Auth for one user, or a Worker/Edge Function in front? This is the
   biggest single decision and it changes M6, M15, and the Agent's credential story.
2. **`shared` schema (1.5)**: drop it and keep entities in `docket` until Converge/CaseVault exist, or keep
   the reservation?
3. **Scheduling (2.2)**: self-enqueue on Agent start, external cron, or manual-only (and rename Sentinel)?
4. **PACER (1.4)**: is the user a party of record in the federal matters that matter? If so, should M10
   become NEF-email ingestion instead of a PCL/ECF client?
5. **PDF rendering (1.1)**: commit to `pdfjs-dist` and the span/bbox model now — accepting that M8/M9 grow —
   or ship v1 with page-level citation only (jump to page N, no box highlight) and add precision later?
6. **Ledger**: reset M3/M4/M5 to "not started," or keep them and treat the current tree as throwaway?

---
---

# Addendum (2026-10-03) — decisions taken, and §1.5 is now reversed

## A. Decisions confirmed

| # | Question | Decision | Consequence for the spec |
|---|---|---|---|
| 1 | Security posture (1.2) | **RLS + Supabase Auth**, single user; Agent holds the service-role key locally | New M0. Rotate the key currently hardcoded in `src/lib/supabase.ts`. Every §4 table gets an RLS policy. `docket.jobs` writes become authenticated. Add the Agent-side `job_type` allowlist + `params` validation regardless — RLS stops strangers, not malformed input. Realtime `postgres_changes` becomes safe because it honours RLS. |
| 2 | Scheduling (2.2) | **Agent self-enqueues on start** | §1 must state it. On launch: compute staleness from `last_synced_at`, order by priority, enqueue subject to the **~60-query session budget** (1.3), and stop/prompt when the budget is close. This makes the session budget a first-class Agent concern, not a footnote. Sentinel keeps its name and gets a real trigger. |
| 3 | Pinpoint citations (1.1) | **Time-boxed spike, then decide** | See §C. |
| 4 | `shared` schema (1.5) | Reopened — see §B | Was "drop it"; now "adopt CaseVault's instead." |

## B. §1.5 REVERSED: don't drop the cross-pillar layer — adopt CaseVault's, don't invent a third

`drivedigital/casevault` and `drivedigital/converge` are now public. My original advice ("drop `shared`,
there's nothing to be compatible with") was based on those repos not existing. They do, and CaseVault
contains a **1,713-line, ~55-table PostgreSQL schema draft** that is substantially more mature than
docket-key §4. Full evidence in `WORKLOG.md` → Research Task #4. The short version:

**CaseVault already designs, properly, at least eleven things docket-key's spec proposes to build crudely** —
the job queue (`system_jobs`), entities and relations (`actors` / `actor_aliases` / `matter_actor_roles`
with a free-text `role_label` join instead of a hardcoded enum), hybrid retrieval (its §7 pairs tsvector
with pgvector on the same tables), the positional citation layer (`source_pages.layout_json` for bounding
boxes, `source_excerpts.anchor_json` + `locator_text` with Bates support — i.e. **exactly the table 1.1
says is missing, already specified**), content dedupe (`sources.sha256` + `source_metadata.text_simhash`),
the provider/agent layer (`ai_provider_configs`, `agent_personas`, `agent_runs` + steps/dispositions/
artifacts), the connector/MCP layer (`connector_configs`/`runs`/`results`), contradiction audit
(`proposals` with `proposal_type: contradiction`, `fact_support_links.support_type: contradicts`,
`claim_support_status: conflicted`), cross-case links (`matter_links`), audit log (`audit_log_entries`),
and evidentiary restriction states (`evidence_review_status_enum`: `privileged`, `settlement_restricted`,
`impeachment_only`) which docket-key has no concept of whatsoever.

**And CaseVault explicitly casts docket-key as a connector, not a co-equal pillar.** Technical Spec §14.5
lists "docket systems" under future connector categories; §14.4 defines the flow (connector run → user
chooses import/reject/defer → import creates a `source` → normal ingest/OCR/review chain begins); §14.6
mandates per-result provenance, which `connector_results` implements (`external_id`, `external_uri`,
`provenance_json`, `raw_payload_json`, `review_state`, `imported_source_id`). Its design principle #2 is
*"Relational clarity over premature graph complexity."*

**Revised recommendation for §4/§9:**

1. **Do not create `shared.entities` / `shared.entity_relations`.** Adopt CaseVault's `actors`,
   `actor_aliases`, `matter_actor_roles`, `matters`, `matter_links`, `events`. This is strictly better than
   the drafted `shared` tables *on docket-key's own terms* — it keeps typed provenance, adds alias-based
   dedup that docket-key lacks entirely, and avoids baking `ground_lease`/`nuisance_action`/`mortgage_lien`
   (facts about one matter) into a permanent enum.
2. **Do not create `docket.jobs`.** Use `system_jobs` — but fix the lease/heartbeat/attempts/priority gaps
   from 2.1 **once**, in the shared table. CaseVault's `system_jobs` has the same gaps, so converging now
   avoids fixing them twice. Adopt `agent_run_status_enum`'s richer vocabulary (`partial`, `canceled`).
3. **Do not create `docket.vector_embeddings`.** Use `source_pages` + `source_excerpts` with their existing
   FTS and vector indexes (CaseVault §7). Standardise on **`gemini-embedding-001` @ 1536 dims** — CaseVault
   already declares `VECTOR(1536)`, 1536 is within pgvector's 2000-dim HNSW limit, and it resolves the
   dead-`text-embedding-004` problem from 1.4 in the same stroke. CaseVault's own note applies: "standardize
   one embedding model for v1."
4. **A scraped filing should land as a `connector_result` with `review_state='proposed'`, not straight into
   canonical tables.** This is the most valuable single change available. docket-key §3's pipeline today is
   scrape → OCR → write canonical, with **no review gate**, so a mis-parsed doc number, a bad date, or a
   duplicate filing silently corrupts the canonical record and everything downstream — RAG, citations, mind
   map, brief drafts. CaseVault's gate (`connector_results` → user import/reject/defer → `sources` →
   `source_pages`/`source_excerpts`) costs one table and one UI queue and makes the whole system
   self-correcting. §14.6's provenance requirements are already satisfiable via
   `source_metadata.external_provenance_json`, which exists for exactly "MCP/import provenance."
5. **Docket entries stay docket-specific.** `ledger_entries` is a *fact* ledger (`fact_statement`,
   `confidence_level`, `authentication_or_witness`, `verification_task_text`), not a filing register — don't
   overload it. Keep a `docket_entries` table FK'd to `matters.id` and `sources.id`, and let the Sentinel /
   Auditor roles emit `proposals` (`proposal_type: fact | event | contradiction | date_normalization |
   duplicate_merge`) when a filing contains an assertion worth promoting to the fact record. That is what
   §5.4's roles should *produce*, instead of a parallel graph. Adopt CaseVault's date handling
   (`date_start`/`date_end`/`date_text_raw`/`date_precision`) for entries where NYSCEF dates are ambiguous —
   better than the current bare `entry_date DATE`.
6. **Adopt CaseVault's conventions now**, since a shared project makes divergence expensive: `workspace_id`
   on every table, `citext`, `pgcrypto`, `updated_at` everywhere, soft delete via `archived_at`, and named
   constraints (`pk_`/`fk_`/`uq_`/`ix_`/`ck_`). `001_initial_schema.sql` follows none of these.
   `workspace_id` is not optional if the projects are shared — CaseVault is multi-workspace/multi-user, so
   docket-key's "single-tenant, no auth scoping" cannot coexist with it. Decision 1 (RLS) resolves the
   security half; a single fixed workspace row resolves the schema half.
7. **§9's remaining recon is now real and small**: confirm the two projects can share one Supabase Postgres
   (they can — Supabase *is* Postgres), and settle the conflicts in §D below.

## C. The citation spike (decision 3) — scoped

Time-box to roughly a day, and make it decide the question with evidence rather than opinion. Use a real
fixture from `510W42` (it has 157 PDFs, including scanned material) rather than a synthetic sample:

1. One **image-only** PDF and one **native-text** PDF through `ocrmypdf --deskew --clean --rotate-pages`.
2. Extract page + bbox + char offsets from the *finished* searchable PDF (PyMuPDF is the fastest path;
   compare against `ocrmypdf`'s hOCR sidecar). Confirm both native and OCR'd pages yield one uniform span
   format — this is the thing most likely to fail.
3. Load into the **CaseVault shape** (`source_pages.layout_json`, `source_excerpts.anchor_json`), not a
   bespoke `text_spans`, so the spike validates the shared schema at the same time.
4. Render with `pdfjs-dist` in the static-export Next.js app; click a citation → highlight the box on the
   right page, at correct scale, in a `lg:col-span-5` panel.
5. **Decide**: if bbox fidelity is good on both file types → full precision. If native-text pages are clean
   but OCR'd pages drift → ship page-level citation for OCR'd documents, box-level for native, and record
   which per entry. If the pdf.js worker fights `output: 'export'` → that's a real blocker to surface now,
   not during M13.

Record the outcome in `WORKLOG.md` before M8/M9 are marked started.

## D. New cross-repo conflicts these decisions surface

1. **Local-first vs Supabase-Storage-as-canonical.** CaseVault: "Local filesystem for local-first testing,"
   principle #6 *"store file metadata and storage keys, but do not assume cloud storage,"*
   `sources.storage_path` documented as "local storage key/path." docket-key §1/§3 make Supabase Storage the
   canonical store with Drive as mirror. **These conflict.** Recommend converging on CaseVault: canonical
   PDFs stay on the Mac, Supabase holds metadata + text + pages/excerpts + embeddings, Drive stays a mirror.
   It also shrinks the public-exposure surface from 1.2, removes the Storage tier/bucket question from 2.3,
   and avoids pushing gigabytes of OCR'd filings through a hosted bucket.
2. **AI-sharing governance is missing from docket-key entirely.** CaseVault has `sharing_policy_enum`
   (`no_ai` / `local_only` / `external_excerpts_only` / `external_selected_full_documents`), a conservative
   workspace default of `external_excerpts_only`, and a per-matter `ai_sharing_policy` override. docket-key
   §2.3/§3.3/§3.4 ship filings to **NotebookLM and the Gemini API with no policy gate at all**. Adopt
   `ai_sharing_policy` on the case/matter record and check it before any export or embedding call. This
   should gate M3, M7, and M8 — it is much cheaper to add before those exist than to retrofit.
3. **Who runs CaseVault's "Python API"?** CaseVault assumes a typed frontend + Python API + async
   evidence-processing workers. docket-key §1 is deliberately serverless (static export, no server). If they
   share one Supabase project, either the **Agent becomes the shared local Python worker for both** — which
   is attractive, since it already owns OCR, the queue, and MCP — or CaseVault needs its own host. Worth
   deciding explicitly, because it determines whether `system_jobs` and `connector_configs` have one worker
   or two.
4. **Converge is a different stack.** SQLite + TanStack Start + TypeScript, versus Postgres + Python.
   "Sharing a Supabase project" implies migrating Converge off SQLite. Its data maps cleanly onto CaseVault
   (`sources` with `source_status: testimony`, `actors` for contacts, `events` for the message timeline,
   `fact_support_links.support_origin_type: user_memory`) — but that is Converge's problem to solve, and
   docket-key should not design around Converge's *current* SQLite shape.
5. **⚠ `drivedigital/510W42` is public** (269 files, 157 PDFs) and contains settlement talks, insurance
   tenders, P&L and balance sheets, draft affirmations, and third-party email exports — i.e. precisely the
   material CaseVault's `privileged` / `settlement_restricted` / `sharing_policy` controls exist to govern.
   Flagged for your decision; not a docket-key build blocker, but it is the strongest available argument for
   conflict D1 (local-first canonical storage) and for D2 (an AI-sharing gate) before any export milestone
   runs.

## E. Storage decision (decision 2, deferred for discussion)

Your tier numbers are correct and verified: Free = **500 MB database, 1 GB file storage**, 5 GB egress,
2 projects. Pro ($25/mo) = 8 GB database, 100 GB storage, 250 GB egress.

Two Free-tier facts that neither spec mentions, and one that changes the arithmetic:

- **Free tier has no automatic backups.** For an evidence system where the canonical record matters, that is
  a real gap, independent of capacity. (Pro: daily, 7-day retention.)
- **Free projects pause after 7 days of database inactivity**, and must be manually restored from the
  dashboard. This collides head-on with §1's "Agent is user-launched, **not always-on**." Go a week without
  touching docket-key — exactly what that design implies — and the project pauses, the dashboard goes dark,
  and the Agent cannot poll the queue. Mitigations: Pro (never pauses), or a keep-alive ping (e.g. a GitHub
  Action touching the DB every few days). The keep-alive fixes the pause but **not** capacity or backups.
- **The binding database constraint is embeddings, not PDFs.** 1,536-dim float vector = ~6 KB. At
  ~27 cases × ~25 filings × ~30 pages ≈ 20,000 pages: ~120 MB of raw vectors plus roughly 130–180 MB of
  HNSW index ≈ **250–300 MB of the 500 MB budget for page-level embeddings alone**, before any text,
  excerpts, relations, proposals, or audit rows. Page `ocr_text` at ~4 KB/page adds ~80 MB. So Drive solves
  the 1 GB *storage* cap but leaves the 500 MB *database* cap exposed. Levers: embed at excerpt/chunk level
  rather than per page; or 768 dims (halves vector size, and `gemini-embedding-001` supports it via MRL); or
  CaseVault's own §7.2 suggestion — move embeddings into dedicated `source_page_embeddings` /
  `excerpt_embeddings` tables so they can be rebuilt or relocated independently; or Pro (8 GB).

**Your Drive instinct is right, and for stronger reasons than capacity:**

1. 1 GB is genuinely too small — 27 cases × ~25 filings × 0.5–2 MB ≈ **340 MB–1.4 GB**, before adding
   `510W42`'s 157 PDFs. You would exceed it during initial ingestion.
2. Drive is **versioned and backed up by Google**, which partially closes the no-backups gap above (for
   documents; the database still needs its own answer).
3. **Zero Supabase egress** — PDF bytes never touch the 5 GB/month budget; only text and embeddings do.
4. **NotebookLM ingests Google Drive files natively**, so your "natural flow" point is correct and it
   materially simplifies M3: `nlm source add` can reference an existing Drive file instead of re-uploading
   bytes the Agent already pushed.
5. **It does not conflict with CaseVault principle #6.** `sources.storage_path` is a TEXT "local storage
   key/path", so a Drive file ID or URI is a perfectly legal value, and `sources.sha256` pins the exact
   bytes. Principle #6 says don't *assume* a cloud store — not don't *use* one. It needs a URI scheme
   (`drive://<fileId>`) and a resolver, nothing more.

**The one hard problem, which is the actual decision.** A private Drive file is not readable by a browser
without an access token, and the web app is a static export with no server (§1). Options:

| | How the browser gets the bytes | Cost | Verdict |
|---|---|---|---|
| **A** | Browser-side Google Identity Services token in the dashboard | One OAuth client **shared with the Agent**; authorized JS origins for `docket-key.pages.dev`; user must be signed into Google | **Best free option.** An in-memory ~1 h token is *fine here* even though 1.5 flagged the same pattern as broken in `drivedigital/notebooklm` — a browser session is interactive by definition. The **Agent** is what needs offline auth-code + refresh token. |
| **B** | Drive canonical + Supabase Storage as an LRU **render cache**, read via RLS-gated signed URLs | Double upload, pruning logic, still bounded by 1 GB — but as a cache, not a canonical budget | Robust, no browser OAuth. Good if you don't want GIS in the front end. |
| **C** | Make Drive files `anyoneWithLink` | — | **Rejected.** Publishes litigation exhibits to the internet and defeats decision 1 (RLS). |
| **D** | Cloudflare Worker proxy holding a service account | A server (§1 exists to avoid one) + a service-account key at the edge | **Rejected.** |
| **E** | Supabase **Pro**, Storage canonical | $25/mo → 100 GB storage, 8 GB DB, no pause, daily backups, signed URLs, RLS-native, one store | The only option that solves capacity + pause + backups + web-read **in a single decision**. |

**Recommendation**: **A** if you want to stay on Free and use your Drive capacity — Drive canonical for bytes,
Supabase for metadata/text/spans/embeddings only — plus a keep-alive for the pause and one of the embedding
levers above for the 500 MB budget. **E** if $25/mo is acceptable and you'd rather not run browser OAuth;
it also removes the double-store complexity entirely. **B** is the fallback if you want Drive canonical but
no GIS in the front end.

### Two `drive.file` gotchas that will silently break this (verified against Google's scope semantics)

1. **`drive.file` visibility is scoped to the exact OAuth client ID.** If the Agent uploads under client A
   and the dashboard reads under client B, the dashboard sees **nothing** — the files simply don't appear,
   with no error. So option A *requires* a single OAuth client ID shared by the Agent and the web app.
   (Do not reuse the client ID committed in `drivedigital/notebooklm` — `684113185983-…` belongs to a
   different GCP project, an AI Studio applet.)
2. **`drive.file` cannot see folders the user created manually in the browser** — only files and folders the
   app itself created. §3.3 plans uploads into `/NYSCEF_Cases/{index_number}_{caption_slug}/`, and the
   existing mock data already carries hand-made folder IDs (`19FzgL1V1gkuW806qIOhBsQfJXHczECps`). Under
   `drive.file` the Agent cannot find or write into those. It must **create and own the entire folder tree
   itself**, then persist the IDs on the matter record. Broadening to `drive.readonly` would fix discovery
   but that is a *restricted* scope triggering Google's verification / annual security assessment — the
   exact thing §2.1 said to avoid.

## F. ~~Action needed: `510W42` visibility~~ — DROPPED

> **Closed 2026-10-03 at the user's instruction ("forget about 510W42").** Retained for the record only;
> not an open action item, and not raised again. The sandbox token lacked admin rights (403), so no change
> was ever made by this review.

### Original note

Attempted both `gh repo edit --visibility private` and `PATCH /repos/drivedigital/510W42 {"private":true}`.
Both failed: **403 "Resource not accessible by integration."** The GitHub token available in this sandbox can
read the repo but lacks admin rights on it, so it cannot change visibility.

**The repo is still public.** To make it private you'll need to either do it yourself
(Settings → General → Danger Zone → *Change repository visibility*) or grant the Arena GitHub connection
admin access to that repo. Note that making it private does not undo any clones, forks, or scrapes that
already happened while it was public.

## G. Round 3 — your positions, and what they change

### G1. The attached OAuth credential did not arrive

The attachment was announced as `/home/user/uploads/client_secret_275082261796-qjscf02mb7hn6tmt2mom2ai2bgvdl7j3….json`,
but that directory does not exist in the sandbox — the file is not here. **I have not seen its contents and
have not guessed at them.**

What I actually need from it is one field: the top-level key, `"installed"` or `"web"`. That single value
decides the whole OAuth design:

- **`"installed"` (desktop/CLI)** — supports loopback redirect (`http://127.0.0.1:<port>`) and, with
  `access_type=offline` + `prompt=consent`, yields a **refresh token**. This is what the local ingestion
  daemon needs. Google treats an installed-app client secret as *not confidential* (it ships inside
  distributed binaries), so its exposure here is low-severity.
- **`"web"`** — needs registered redirect URIs and authorized JS origins; the secret **is** confidential and
  should be rotated if it has been pasted into chat or committed anywhere.

Two cautions regardless of type:

- The client ID in the filename is project **`275082261796`**, while `drivedigital/notebooklm`'s `auth.ts`
  hardcodes a fallback from project **`684113185983`**. Two GCP projects are in play. Because `drive.file`
  visibility is scoped to the exact client ID (G2), choosing between them is not cosmetic — pick one and use
  it for both the daemon and anything that reads those files back.
- Never commit the file. `uploads/` sits outside the repo so git won't pick it up, but the JSON belongs in
  the macOS Keychain or an untracked `.env`, not in `docket-key/`.

### G2. The Drive MCP server does not solve the authentication problem

Checked `developers.google.com/workspace/drive/api/guides/configure-mcp-server` (updated 2026-09-18):

- **Gated**: the prerequisite is *"Membership in the Google Workspace Developer Preview Program."* Not
  generally available.
- It is a **remote MCP server for AI hosts** (`https://drivemcp.googleapis.com/mcp/v1`, Streamable HTTP,
  OAuth 2.0) aimed at Antigravity/Claude — not a client library for a Python ingestion daemon doing bulk
  uploads.
- **8 tools**: `copy_file`, `create_file`, `download_file_content`, `get_file_metadata`,
  `get_file_permissions`, `list_recent_files`, `read_file_content`, `search_files`. **No OCR, no bounding
  boxes, no positional data.**
- You still configure your own GCP project, enable the Drive API, and set up an OAuth consent screen — i.e.
  **the credential work is unchanged.** It removes neither the `drive.file` per-client-ID constraint nor the
  browser-can't-read-a-private-Drive-file problem.
- Google devotes a section to **indirect prompt injection**: an MCP host "can read, modify, and delete data
  in your Google Account," and they recommend screening with Model Armor. Directly relevant here —
  docket-key feeds *untrusted scraped court documents* to LLM agents. Wiring those same agents to a Drive
  MCP server with create/copy/delete tools is precisely the scenario Google warns about. If you adopt it,
  scope it read-only and keep it away from the ingestion path.

Verdict: a nice convenience later for letting Claude browse Drive. **Not an auth solution, and not on the
critical path.**

### G3. OCR of non-searchable PDFs — the answer, and it inverts §3.2

Your three constraints decide this together: cloud-canonical, a local machine short on processing power, and
**agents that keep working when the laptop is off**. That last one is binding, and it means §3's "OCR
happens once, **locally**, in the Agent, always" is no longer viable — a laptop-off cloud agent cannot run
`ocrmypdf`.

**First, a correction to the premise that Drive/OneDrive built-in OCR could do this job.** Both do OCR, but
only to populate *their own* search indexes — neither exposes positionally faithful text through its API.
The only Drive route to extracted text is exporting the PDF to Google Docs (`exportLinks` →
`application/vnd.google.documents`), which triggers Drive's conversion **and reflows the text with no page
or bounding-box mapping back to the original**. That is exactly the failure mode §3 already correctly
rejected for Drive. Same story for OneDrive. **So built-in OCR is not a reason to choose either store, and
it cannot power pinpoint citations.**

**What does work: Google Document AI, Enterprise Document OCR processor.** Verified against Google's API
reference — the response is precisely the structure §5.3 needs:

- `Document.text` — the full raw text
- `pages[]` with **`pageNumber`** (1-based), `dimension`, `image` (pre-rendered deskewed/de-rotated so boxes
  are axis-aligned), and `transforms[]` (the matrices applied — needed to map coordinates back)
- per page: `blocks[]`, **`paragraphs[]`**, **`lines[]`**, **`tokens[]`**, `symbols[]` — each carrying
  `layout { textAnchor { textSegments[{startIndex, endIndex}] }, confidence ∈ [0,1],
  boundingPoly { vertices[], normalizedVertices[] }, orientation }`
- `pageAnchor.pageRefs[]` for elements spanning pages, plus `imageQualityScores` and `detectedLanguages`

**It maps 1:1 onto CaseVault's schema**, which is the real payoff:

| Document AI | CaseVault column |
|---|---|
| `pages[].pageNumber` | `source_pages.page_number` |
| `pages[].tokens[].layout.boundingPoly.normalizedVertices` | `source_pages.layout_json` ("bounding boxes/layout") |
| `layout.textAnchor.textSegments[{startIndex,endIndex}]` | `source_excerpts` char offsets |
| `pages[].paragraphs[]` / `lines[]` | **structure-aware chunking** — §3.4's "headings, numbered paragraphs, affidavit clauses", for free |
| `layout.confidence` | `ocr_confidence` (0.00–1.00) |
| `imageQualityScores` | the low-quality trigger, now measured rather than guessed |

It also fixes the chunking problem independently: §3.4 wanted structure-aware chunks, and the research repo
could only manage naive 500-character splits. Document AI hands you paragraphs and lines, so you chunk on
real document structure and embed *those* — better retrieval units than pages, and fewer vectors (G5).

**Cost.** Enterprise Document OCR is **$1.50 per 1,000 pages** (first 5M pages/month; $0.60/1k above), and
**async/batch mode via GCS is ~$0.60 per 1,000 pages** with no page limit. Worst case — every page of every
filing across 27 cases needing OCR — is ~20,000 pages ≈ **$30 sync / $12 batch**. But §3.2's text-layer
audit means only the *scanned minority* gets OCR'd at all; NYSCEF e-filed PDFs are overwhelmingly
born-digital. Realistically 2,000–4,000 pages ≈ **$3–6 for the entire back catalog**, then pennies ongoing.
Against that, local Tesseract on an underpowered Mac costs hours per case at 80–90% accuracy versus
Document AI's ~95–99%.

**Recommendation — invert §3.2:** Document AI becomes the **primary** OCR path; local `ocrmypdf`/Tesseract
becomes the free/offline **fallback**. Keep §3.2's text-layer audit exactly as written — it is what keeps
the bill near zero, since born-digital filings skip OCR entirely and record `text_layer_source = 'native'`.

One consequence worth stating: Document AI's batch mode reads from and writes to **Cloud Storage**, so batch
implies a GCS bucket as a staging area. Online (synchronous) `:process` avoids GCS entirely for documents
under ~15 pages / 20 MB, which covers most filings. Decide per document by size — sync for typical filings,
batch for large exhibits.

### G4. Always-on cloud agents + a local ingestion daemon — a real architecture change, and a good one

"The agents can be always-on, the local daemon for ingestion is not" **contradicts §1**, which is built
entirely on "a locally-run, user-launched Mac process" and "Nothing in Docket-Key Web assumes a server
exists." Your version is better, and it splits cleanly along a natural seam — **what physically requires the
Mac**:

| Tier | Runs | Owns |
|---|---|---|
| **Cloud agents (always-on)** | Cloudflare Workers + Cron Triggers (Free: 500k invocations/mo, secrets supported) | Sentinel monitoring and scheduling, RAG retrieval, embedding generation via Gemini API, Council of Experts, brief drafting, job orchestration, the daily Supabase keep-alive |
| **Local ingestion daemon (user-launched)** | Mac, Python | **Only** NYSCEF: headed Playwright + supervised CAPTCHA + the ~60-query session budget, then upload of acquired bytes |

With OCR (G3) and embeddings moved to the cloud, **NYSCEF scraping is the only thing left that needs your
machine** — because a human must solve the CAPTCHA. That is a much cleaner justification for the local
component than §1's original "everything a static host cannot do."

This also **properly resolves the §2.2 scheduling gap**: a Cloudflare Cron Trigger enqueues daily refresh
jobs; the daemon drains them whenever you next run it. Sentinel becomes real monitoring instead of a button.

Three things the spec must now say explicitly:

1. **§1's premise is gone — there is a server tier.** So the job queue is no longer the *only* channel.
   Decide what stays queued (NYSCEF acquisition — needs the Mac) versus what Workers do directly (analysis,
   retrieval, embedding, monitoring). Otherwise you'll queue work that could simply run.
2. **The keep-alive Worker and the agent tier are the same deployment.** One Worker with a cron trigger does
   both — a nice consolidation, and it means a Worker already exists to hold secrets, which matters for
   G6's option D′.
3. **Workers can't run Playwright, Tesseract, or long CPU work.** That constraint is what makes the split
   natural rather than arbitrary — but it also means anything heavy must be an API call (Document AI,
   Gemini), not in-process.

### G5. pgvector + Supabase for vectors: agreed — but watch the 500 MB budget

pgvector in Supabase with no separate vector DB is right, and matches §3.4. The §E arithmetic still applies
and gets worse at 1536 dims: ~20,000 page vectors ≈ 120 MB raw + ~130–180 MB HNSW index ≈ **250–300 MB of
your 500 MB, before any text or relations.**

Three levers, in order of preference:

1. **Embed paragraphs/excerpts, not pages.** Document AI already gives you `paragraphs[]`, and paragraphs
   are better retrieval units than pages for legal text. Fewer, more targeted vectors — and a citation lands
   on a paragraph you can highlight, not a whole page.
2. **Move embeddings into dedicated tables** (`source_page_embeddings`, `excerpt_embeddings`) — CaseVault's
   own §7.2 recommendation — so they can be rebuilt, re-dimensioned, or relocated without touching the
   document tables.
3. **768 dims instead of 1536** if you're still tight. `gemini-embedding-001` supports it via MRL and it
   halves vector storage. This diverges from CaseVault's declared `VECTOR(1536)`, so if you share one
   Postgres, agree a single dimension — CaseVault's note is explicit: *"standardize one embedding model for
   v1."*

### G6. Document store — your question, plus a third option

**Notion: reject outright.** It is a block database, not a document store — no positional fidelity, poor
handling of large binary corpora, rate limits, and PDFs degrade into attachments. It is also already your
*seed source* in M4. A source, not a store.

And per G3, **built-in OCR should not be a criterion at all** — neither Drive's nor OneDrive's is usable for
citations. So compare on what actually matters:

| Store | API / capacity | Versioning & backup | Browser-readable from a static app | NotebookLM native | OCR sibling |
|---|---|---|---|---|---|
| **Google Drive** | Drive API v3, solid Python client; 15 GB free, Google One cheap | ✓ Google-managed versions | ✗ needs a token or a proxy | **✓ ingests Drive files directly** | **Document AI** |
| **OneDrive / SharePoint** | Graph API, strong; 1 TB with M365 | ✓ | ✗ same problem | ✗ | Azure AI Document Intelligence (also returns word bboxes — a legitimate alternative stack) |
| **Dropbox** | Excellent API + delta sync | ✓ | ✗ | ✗ | none (you'd use Document AI anyway) |
| **Supabase Storage** | Native to your existing client; **1 GB free / 100 GB on Pro** | Pro: daily backups, 7-day retention | **✓ signed URLs, RLS-native, nothing extra** | ✗ (Drive stays the mirror for this) | none (Document AI regardless) |

**The third option I'd put forward: keep the spec's own design — Supabase Storage canonical, Drive mirror.**

Worth serious consideration, because promoting Drive to canonical *inverts reasoning §2.1 and §3.3 already
got right* ("Drive is an **export mirror, not a pipeline dependency**") and is the sole source of the
browser-auth problem. Specifically:

- The web app reads **signed URLs** directly. **No browser OAuth, no Worker proxy, no `drive.file`
  per-client-ID trap, no folder-ownership problem.** RLS applies natively and the decision-1 security model
  just works.
- Everything your always-on cloud agents need — bytes, text, spans, vectors, metadata — sits in **one store
  reachable with one key**. That is exactly your "agents keep working when the laptop is off" requirement.
  Drive-canonical means the cloud tier *also* needs Google OAuth credentials and refresh-token handling.
- Capacity is the only objection, and it has one clean answer: **Pro at $25/mo buys 100 GB storage, 8 GB
  database, no inactivity pause, and daily backups** — solving capacity, the pause you're currently planning
  to hack around with a keep-alive, *and* the free tier's missing backups, in a single decision.
- You keep Drive as the NotebookLM + human-browsing mirror exactly as §3.3 specced it, and your local copy
  as backup. Nothing is lost.

**So the honest framing:**

- **If $25/mo is acceptable → Supabase Storage canonical + Drive mirror + local backup.** Simplest, fewest
  moving parts, no new OAuth surface, and it makes the keep-alive Worker unnecessary.
- **If you want to stay Free and use your Drive capacity → Drive canonical + local backup**, solving browser
  reads with **D′: proxy through the Cloudflare Worker you already need for keep-alive**, holding the Drive
  refresh token as a Worker secret and authorising each request against the Supabase JWT. That is materially
  cheaper than when I listed it as option D last round, *because the Worker now exists anyway*. It still
  requires **one OAuth client ID shared by the daemon and the Worker** (G1/G2), and the daemon must create
  and own the whole Drive folder tree, since `drive.file` cannot see folders you made by hand in a browser.
- Option A (browser-side GIS token) remains viable but is now strictly more work than D′, since D′ reuses a
  Worker you're building regardless and keeps OAuth out of the front end entirely.

**My recommendation: Pro + Supabase Storage canonical**, Drive as the mirror. It is the only option that
meets all four of your stated goals — cloud-canonical, laptop-off operation, access-anywhere, no dependence
on local processing power — without adding a second credential system to the cloud tier.

### G7. Accepted: no review stage, no AI-sharing gate — with two nearly-free accommodations

Both are your call and I've dropped them from the recommendations. Two notes so they don't cost you later:

1. **No review stage** — fine, but keep the *machinery* without the human gate. Land scraped filings in
   `connector_results` with `review_state` set automatically to `'accepted'`, preserving `external_id`,
   `external_uri`, `provenance_json`, `raw_payload_json`, and `imported_source_id` (§14.6's provenance
   requirements). Then upsert on a natural key (`matter_id`, `doc_number`) so a re-pull **corrects** a
   mis-parse instead of duplicating it, and route only genuine *parse failures* to a `failed` state. Costs
   nothing extra, keeps CaseVault compatibility, and means a bad scrape is fixed by re-running rather than
   by hand-editing canonical rows.
2. **No AI-sharing gate** — fine, but if docket-key writes into CaseVault's schema then
   `matters.ai_sharing_policy` is `NOT NULL` with a default. So **populate it** (permissive value) rather
   than build enforcement. Zero cost, and CaseVault's future enforcement won't encounter nulls or need to
   backfill your matters.

### G8. Converge: SQLite is an ingestion artifact, and Converge should own actor identity

Your clarification is the right read — Converge uses SQLite *because iMessage stores are SQLite*, not as an
architectural commitment, so once extracted the data can land in the same Postgres as everything else.
Nothing in docket-key should be designed around Converge's current SQLite shape.

The architecturally important consequence is bigger than storage: **Converge is the authority on actor
identity resolution**, and docket-key is the worst possible place to invent one. Scraped dockets give you
`"JOHN SMITH ESQ"`, firm names where individuals are meant, abbreviated captions, and inconsistent party
ordering — while Converge already has a real contacts database with identity resolution.

So: adopt CaseVault's `actors` + `actor_aliases` + `matter_actor_roles` as the **shared identity spine**,
with **Converge as primary feeder** and docket-key as a *secondary proposer* — scraped names enter as
`actor_aliases` candidates (`alias_type` is already documented for "nickname/spelling/etc.") and as
`proposals` with `proposal_type: duplicate_merge`, rather than docket-key maintaining its own dedup logic.
That is a strict improvement on §4's `shared.entities`, which had no alias or dedup concept at all.

And the real three-tier value proposition lands in CaseVault's existing tables, not a new `shared` schema:
Converge's communications become `sources` (`source_status: testimony`) feeding `fact_support_links` with
`support_type: supports | contradicts` and `support_origin_type: user_memory | source_excerpt` — the
informal record corroborating or contradicting the formal docket record. That is what makes the suite more
than three separate apps, and it needs no new tables.

## H. Round 4 — Cloudflare AI Search, R2, and the Google credential

### H1. ⚠ Rotate that OAuth client secret now

You pasted a **`web`** client credential in plaintext, including `client_secret`. Unlike an `installed`
(desktop) client — whose secret Google treats as non-confidential because it ships inside distributed
binaries — a **web client secret is confidential**. Treat it as compromised and reset it in
Cloud Console → APIs & Services → Credentials → *Reset secret*. I have deliberately **not** written the
value into any file in this repo; nothing here contains it, and it should never be committed.

Three further problems with that credential, independent of the leak:

1. **`project_id` is `gen-lang-client-0885961933`** — an **AI Studio auto-generated project** (the
   `gen-lang-client-*` prefix is AI Studio's signature). Those projects are managed by AI Studio; properly
   configuring an OAuth consent screen, publishing status, and authorized redirect URIs in one is awkward at
   best. **Create a dedicated GCP project** rather than building on this.
2. **You enabled `https://www.googleapis.com/auth/drive` — the wrong scope, and the most restricted one.**
   Google's Drive scope tiers: **non-sensitive** = `drive.file`, `drive.appdata`, `drive.install`;
   **restricted** = `drive`, `drive.readonly`, `drive.metadata`, `drive.metadata.readonly`, `drive.activity`.
   Restricted scopes require roughly **6 weeks of verification plus an annual CASA Tier 2 security audit** to
   publish. §2.1 already said to use `drive.file` only; this is the broad scope it warned against.
3. **A personal Gmail account forces the "External" user type** (Internal requires Google Workspace), and
   External apps start in **Testing** publishing status: ≤100 test users, and **refresh tokens expire 7 days
   after consent.** With a restricted scope you can't publish without verification, so you'd be stuck
   re-consenting **weekly** — widely described as the single most common reason such agents "randomly" lose
   access in week two. For a tool meant to run unattended, that's disqualifying.

**There is an escape hatch, and it's the one you already named: a service account.** It has no consent
screen, no publishing status, no verification, and **no 7-day expiry**. You share the docket folders with its
email address and it can read/write there. It works identically from a Cloudflare Worker and from Python
(`google-auth` handles JWT signing in both), and — usefully — **service-account access is granted by folder
share, not by app-created-file, so it sidesteps the `drive.file` per-client-ID trap entirely.**

(One claim you may encounter online — that service accounts are "only available to Google Workspace
customers" — comes from the Google **Ads** API and is **wrong for Drive**. Any GCP project can create one.)

So: **service account, `drive.file`-equivalent access via a single shared folder, in a dedicated GCP
project.** Reset and delete the web client. Note your read on billing is correct — **Google One AI Pro is a
consumer subscription and does not cover Cloud API usage**; Document AI bills to a GCP project separately.
Worth adding: Gemini *app* usage included in that subscription is not Gemini *API* quota either, so
inference/embeddings need the API's own free tier or pay-as-you-go.

### H2. AI Search is a much bigger deal than "OCR if needed" — but it cannot do pinpoint citations

Verified against the docs and the GA post. AI Search bundles **Workers AI + Vectorize + R2 + Browser Run**
into a managed index/retrieval pipeline. What it includes **at no extra charge**: parsing, chunking,
embedding, keyword indexing, and reranking. Plus:

- **Hybrid search on by default** — vector and keyword run in parallel, results fused, optionally reranked.
  This is exactly the 2.4 recommendation, already built.
- **A built-in MCP endpoint** on every instance, plus **embeddable search UI components**. That removes most
  of §7's hand-rolled MCP server and gives the dashboard a search widget for free.
- **Automated continuous indexing** of a connected data source — no ingestion pipeline to write or maintain.
- OCR for scanned PDFs, **available on every account**.
- MRL-based embeddings to keep storage manageable.

**Hard limits (Workers Free = Workers Paid for these):**

| Limit | Value | Impact on docket-key |
|---|---|---|
| **Max PDF size with OCR** | **10 MiB** | ⚠ The binding one. Scanned exhibits routinely exceed this. PDFs *without* OCR are capped at **4 MiB** — even tighter. |
| **Max custom metadata fields** | **5 per instance** | ⚠ You'd want matter_id, doc_number, page_number, entry_date, doc_type, filed_by, source_system = 7. Must economise. |
| Filterable string data | first 64 UTF-8 bytes | Long captions can't be filtered on. |
| Included queries/month | **1,000 semantic + 1,000 full-text** | The real ongoing constraint — see below. |
| Files per instance | 100,000 | Fine (~675 filings). |
| Metadata per vector | 10 KiB | Fine. |

**Cost math for your volume.** ~27 cases × ~25 filings × ~30 pages ≈ 20,000 pages. A dense legal page ≈ 800
tokens (`cl100k_base`), so ≈ **16M tokens** for the whole corpus.

- **One-time backfill**: 16M × $0.75/M = **$12**, plus OCR on the scanned minority (say 20% → 3.2M image
  tokens × $0.50/M) = **$1.60**. **≈ $14 once.**
- **Storage**: ~64 MB of text indexed into vectors + keyword ≈ well inside the **10 GB-month free**
  allotment. **$0.**
- **Ongoing ingestion**: 50–200 new pages/month ≈ 40k–160k tokens, far inside the **5M tokens/month free**
  allotment. **$0.**
- **Queries — the actual constraint.** 1,000 semantic/month ≈ 33/day, fine for personal Q&A. But if the
  Sentinel does a daily per-case monitoring search, 27 cases × 30 days = **810 queries/month** before you
  ask a single question. Overage is trivial (**$0.75/1,000** → ~$0.61), so this is a *budget* note, not a
  blocker — but your "free at our volume" assumption holds for ingestion and storage and **not quite** for
  query count once monitoring is daily.
- **Billing starts 1 November 2026** (~4 weeks out). Free until then, with a reminder email the week before.

**The critical limitation — and it's the same one that ruled out Drive's OCR.** AI Search's OCR "reads the
text from each page before chunking and embedding it." It produces **searchable text, not locatable text**:
nothing in its feature set or pricing model mentions bounding boxes, page coordinates, or text anchors. So
**it cannot power §5.3's click-a-citation → highlight-the-exact-spot**, for the same structural reason Drive's
built-in OCR can't. It is a *retrieval* index, not a *positional* one.

**Therefore AI Search and Document AI are complements, not substitutes:**

| | AI Search | Document AI (Enterprise OCR) |
|---|---|---|
| Purpose | Hybrid retrieval index | Positional OCR |
| Returns | Chunks + scores | `pageNumber`, `tokens/lines/paragraphs` with `boundingPoly.normalizedVertices`, `textAnchor{startIndex,endIndex}`, `confidence` |
| Bounding boxes | ✗ | ✓ |
| File cap | 10 MiB (OCR) / 4 MiB (no OCR) | Effectively unlimited (batch via GCS) |
| Cost for your corpus | ~$14 one-time, ~$0 ongoing | ~$3–6 one-time (scanned minority only) |
| Maps to CaseVault | retrieval layer | `source_pages.layout_json`, `source_excerpts.anchor_json` |

**Recommended pipeline — one OCR pass, one canonical text layer:**

```
acquire PDF ──> text-layer audit (§3.2, unchanged)
   │
   ├─ born-digital ──> extract text+positions locally (PyMuPDF)  ──┐
   │                                                              │
   └─ scanned ──> Document AI OCR ──> pages/tokens/bbox/confidence ─┤
                                                                  ▼
                              Postgres (system of record): sources, source_pages.layout_json,
                                                           source_excerpts.anchor_json
                                                                  │
                                                                  ▼
                              AI Search: ingest the *already-extracted* paragraphs/chunks
                              (NOT the raw PDF) ──> hybrid retrieval + MCP endpoint
                                                                  │
                                                                  ▼
                              citation ──> AI Search returns chunk + source/page
                                       ──> Postgres supplies the bbox ──> pdf.js highlight
```

The key move is **ingesting extracted text into AI Search rather than the raw PDF**. That avoids a second
OCR pass, avoids two disagreeing text layers for the same page (a real citation-integrity hazard), sidesteps
the 10 MiB cap for large scanned exhibits, and keeps AI Search as a pure retrieval index while Postgres
remains the system of record. With only 5 metadata fields available, store **`source_id`, `page_number`,
`doc_number`, `matter_id`, and one filter of your choice** in AI Search and keep everything else in
Postgres — AI Search points back, it does not own the citation.

### H3. This changes the storage answer: R2, not Drive, and not Supabase Storage

AI Search's stack includes R2, and your always-on agent tier is already Workers. That makes **R2 the
document store I should have proposed last round** — and it dissolves the entire §2.1 OAuth problem:

- **No Google credentials on the critical path at all.** A Worker reads R2 through a **binding** — no OAuth,
  no consent screen, no client ID, no per-client-ID `drive.file` scoping, no folder-ownership problem, no
  7-day refresh-token expiry, no restricted-scope verification. Everything in H1 becomes **non-blocking**,
  because Drive is demoted to the best-effort mirror §3.3 always said it should be.
- **No egress fees** — serving PDFs to the browser costs nothing, versus Supabase's 5 GB/month.
- **10 GB free**, $0.015/GB-month beyond. ~675 filings × ~1 MB ≈ **675 MB — inside the free tier.**
- Browser reads go through the **Worker you already need** for keep-alive and the agent tier, authorised
  against the Supabase JWT (decision 1's RLS identity). That is option D′ from §E, but with **zero** Google
  OAuth instead of a refresh token in a Worker secret — a strictly better version of the same idea.
- Same platform as everything else that must run while the laptop is off (G4). One credential system:
  a Cloudflare API token.

**Revised recommendation, superseding §G6:**

| Layer | Store | Why |
|---|---|---|
| Canonical document bytes | **Cloudflare R2** | No egress, 10 GB free, Worker binding = no OAuth, laptop-independent |
| Positional text layer, spans, relational record, job queue | **Supabase Postgres** | CaseVault connector target; system of record for citations |
| Retrieval index | **Cloudflare AI Search** | Hybrid + MCP + chunking/embedding included; ~$14 one-time |
| Positional OCR (scanned minority only) | **Google Document AI** | The only option here that returns bounding boxes |
| Human browsing + NotebookLM ingestion | **Google Drive (mirror)** | §3.3's original role; best-effort, non-blocking; service account |
| Offline copy | **Local Mac** | Your backup requirement; also lets the daemon re-OCR without re-downloading |

**This also removes the reason to buy Supabase Pro.** The 500 MB database budget was tight because
1536-dim page vectors were going to eat 250–300 MB of it (§E/G5). With vectors in AI Search and bytes in R2,
Supabase holds relational metadata plus citation spans — comfortably inside 500 MB. **Pro becomes optional**,
wanted only for daily backups and to avoid the 7-day pause — and you're already building a Cloudflare cron
keep-alive, which handles the pause for free. So: **total realistic spend ≈ $14 one-time, ~$0–2/month
ongoing**, instead of $25/month.

Two honest caveats:

1. **This diverges from CaseVault's §7**, which recommends tsvector + pgvector in Postgres. Defensible —
   CaseVault's §7 is a *recommendation* in a draft, and its own §7.2 note ("if multiple embedding
   dimensions/providers are likely, move embeddings into dedicated tables") anticipates embeddings being
   relocatable. But if CaseVault later wants **one index spanning docket + converge + casevault sources**,
   having docket-key's vectors in AI Search and CaseVault's in pgvector fragments retrieval. That's a
   cross-repo decision to raise, not to make silently: either CaseVault adopts AI Search, or docket-key
   dual-writes embeddings to pgvector, or you federate at query time.
2. **Supabase free still has no backups.** R2 and Drive give you document redundancy, but the *relational*
   record — matters, actors, spans, the whole citation graph — has none. A `pg_dump` on a schedule (the same
   Worker cron, or a GitHub Action) into R2 costs nothing and closes it. Worth adding to M0.

### H4. What this does to the milestone plan

Several milestones shrink or disappear:

- **M8 (native RAG engine)** → largely **deleted**. AI Search provides chunking, embedding, hybrid
  retrieval, reranking, and an MCP endpoint. What remains is the *ingest* step (push extracted paragraphs
  with 5 metadata fields) and the citation-resolution path back to Postgres for bboxes. This was the largest
  remaining build; it is now mostly configuration.
- **M9 (OCR pipeline)** → **rescoped**, not built from scratch. Text-layer audit stays (it's what keeps cost
  near zero). `ocrmypdf`/Tesseract demoted to offline fallback. Document AI becomes the scanned-path
  producer of `source_pages.layout_json` / `source_excerpts.anchor_json`.
- **M7 (Google OAuth + Drive export)** → **dramatically reduced**. No OAuth flow to build: a service account
  plus one shared folder. Drive is a mirror, so failure is non-blocking by design.
- **§7 MCP server** → mostly replaced by AI Search's built-in MCP endpoint; keep only the docket-specific
  tools (`docket_request_job`, `docket_get_ocr_status`, job-queue bridge) that AI Search can't provide.
- **New milestone**: the **Workers agent tier** (G4) — cron keep-alive, Sentinel scheduling, Council of
  Experts orchestration, R2 document proxy, `pg_dump` backup. This didn't exist in §1 and is now central.
- **The citation spike (C) gets sharper.** It should now test one specific thing: does a Document AI OCR
  pass on a real scanned filing from `510W42` produce bounding boxes that, after the `transforms[]`
  deskew matrices are applied, land correctly on a pdf.js render? That single question decides §5.3.
  AI Search and R2 are not in doubt and don't need spiking.

## I. Round 5 — Drive scope, and vector portability to Supabase

### I1. Drive: you're right about verification, but it doesn't escape the real problem

Conceded: **verification and the CASA Tier 2 audit are irrelevant to you.** Those only apply when publishing an
app that requests restricted scopes to a public audience. With ≤100 hand-listed test users you never publish,
so that whole cost disappears. As sole user the cap is a non-issue. My §H1 point 2 was aimed at the wrong
target.

But the two are coupled in a way that still bites: **staying in Testing is precisely what causes the 7-day
refresh-token expiry.** Google's documented behaviour for an External app in Testing status is that
authorisations lapse 7 days after consent. So "Testing is fine, I'm the only user" is correct about
verification and *is the reason* the daemon would need a fresh interactive browser consent every week. You
cannot have both "Testing, no verification" and "non-expiring refresh tokens."

Two ways out, and the first is the one §2.1 already specified:

- **Use `drive.file` and publish to Production.** `drive.file` is **non-sensitive**, so Production requires
  no restricted-scope verification and **no CASA audit** — only brand verification if you show a logo/name.
  Refresh tokens then stop expiring. The single trade-off: a Production External client can be authorised by
  *any* Google account. With `drive.file` the blast radius is only files the app itself created, so for a
  private single-user tool this is an acceptable and common choice. This is the path if you want OAuth.
- **Service account** — no consent screen, no publishing status, no expiry, no public audience, and it works
  identically from a Worker and from Python. Access is by folder share, so it also sidesteps `drive.file`
  per-client-ID scoping. Strictly less machinery.

Either resolves it. **Both are moot if R2 is canonical (§H3)** — Drive is then a best-effort mirror whose
auth can fail without affecting anything.

One ownership nuance if you pick the service account: files it creates are owned by the *service account*,
appearing in your Drive only through the shared folder. NotebookLM running as you can still ingest them, and
the folder stays human-browsable, so §3.3's intent is preserved — just don't expect them in "My Drive" as
owner.

### I2. Yes — and with the right model choice they are the *same* vectors, not a copy

AI Search lets you pick the embedding model, and the supported list includes:

| Provider | Alias | Dims | Input tokens | Image | Default |
|---|---|---|---|---|---|
| **Google AI Studio** | `google-ai-studio/gemini-embedding-001` | **1,536** | 2,048 | no | no |
| **Google AI Studio** | `google-ai-studio/gemini-embedding-2` | **1,536** | **8,192** | **yes** | no |
| OpenAI | `openai/text-embedding-3-small` / `-large` | 1,536 | 8,192 | no | no |
| Workers AI | `@cf/qwen/qwen3-embedding-0.6b` | 1,024 | 8,192 | no | **yes** |
| Workers AI | `@cf/qwen/qwen3-vl-embedding-2b` | 1,024 | 32,768 | yes | no |
| Workers AI | `@cf/baai/bge-m3`, `bge-large-en-v1.5` | 1,024 | 512 | no | no |
| Workers AI | `@cf/google/embeddinggemma-300m` | 768 | 512 | no | no |

**`google-ai-studio/gemini-embedding-001` at 1,536 dims, cosine, is exactly CaseVault's declared
`VECTOR(1536)`** — and exactly the replacement I recommended for the shut-down `text-embedding-004` (§1.4).
That is a three-way convergence: pick it and

- AI Search's vectors and Supabase pgvector's vectors are produced by **the same model, same dimension, same
  metric**, so they are **directly comparable and cross-queryable** — not two incompatible spaces;
- you can regenerate any vector yourself by calling the Gemini API, so a Supabase copy is a **deterministic
  re-derivation**, not a fragile export;
- **§H3 caveat 1 (divergence from CaseVault §7) is resolved.** CaseVault can search docket-key's embeddings
  in pgvector, and AI Search can serve the fast hybrid path, from one shared vector space. This is the
  dual-write option, and it now costs nothing in coherence.

Three caveats, stated plainly:

1. **This only works with an external provider.** If you leave AI Search on its **default**
   (`@cf/qwen/qwen3-embedding-0.6b`, 1,024 dims), the vectors are Cloudflare-internal, you cannot reproduce
   them elsewhere, and the dimension does not match CaseVault's `VECTOR(1536)`. Portability is a *choice you
   make at instance creation*, not a property of the product.
2. **External embedding providers bill to your own account via AI Gateway**, outside AI Search's included
   ingestion allowance (which covers Workers AI embedding and reranking). For ~16M tokens that is a few
   dollars at most, but verify the current Gemini embedding rate rather than assuming it's absorbed.
3. **Don't plan on *exporting* from AI Search.** Its vector index is managed (built-in storage is "powered by
   R2 and Vectorize"); Vectorize does expose `list` and `get_by_ids`, but the docs don't state that an
   AI Search instance's internal index is enumerable in your account. Plan on **regenerating** instead —
   which is cheap and deterministic precisely because you control the model. Note also that AI Search
   previously wrote to an R2 bucket in your account and **no longer does**, so treat the index as opaque.

The deeper point: **vectors are derived data.** A vector is a pure function of (chunk text, model). Your
canonical text and citation spans live in Postgres, which is the system of record. So the backup you actually
need is the text — which you already have — and "restore the index" means "re-embed," ~$14 and a few minutes.
Writing them to pgvector as well is worth doing for **CaseVault convergence and cross-pillar search**, not
for disaster recovery.

### I3. One refinement to the §H3 architecture: index your own R2 bucket, with path filtering

AI Search can use **built-in storage** *or* an **external R2 bucket you own** as its data source — and can use
both alongside each other. Use **your own bucket**, because then the canonical bytes are directly readable by
the Worker through an R2 binding for the PDF viewer, and AI Search indexes them on a sync schedule with
**no ingestion code**.

Combine that with AI Search's **path filtering** (include/exclude patterns) to keep the two concerns apart in
one bucket:

```
r2://docket-key/
  raw/{matter_slug}/{doc_number}.pdf     ← canonical bytes; EXCLUDED from indexing;
                                            served to pdf.js via Worker binding
  text/{matter_slug}/{doc_number}.md     ← Document AI / PyMuPDF extracted paragraphs
                                            with page markers; INCLUDED, auto-indexed
```

This is what makes the §H2 recommendation concrete: AI Search indexes **extracted text**, never the raw PDF.
Consequences, all favourable — one canonical text layer (no two disagreeing OCR outputs for the same page),
the **10 MiB PDF-with-OCR cap stops mattering** (markdown chunks are tiny), the 5-metadata-field limit is
spent on `source_id / page_number / doc_number / matter_id` + one filter, and positions stay in Postgres
where the citation resolves them.

`google-ai-studio/gemini-embedding-2` is worth noting as an alternative to `-001`: same 1,536 dims but
**8,192 input tokens** (vs 2,048) and **native image support**. The larger context window suits long
affidavit sections without aggressive splitting. Confirm it against CaseVault before standardising, since
CaseVault's draft predates it and names only a dimension, not a model.
