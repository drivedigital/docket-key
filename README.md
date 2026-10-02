# Docket-Key

**NYSCEF Court Intelligence, Split Document Viewer & Cross-Case Mind Maps**

Docket-Key automates pulling filings from the New York State Courts Electronic Filing (NYSCEF) system, maintains local and cloud clones of dockets, extracts searchable OCR text from filings, and builds interactive cross-case evidence networks and mind maps.

Deployed on **Cloudflare Pages** (`docket-key.pages.dev`) backed by **Supabase PostgreSQL & Storage**.

---

## Features

- **NYSCEF Docket Scraper**: Extends `nyscef-downloader` with automated Playwright CAPTCHA session extraction.
- **Split-Screen Workspace**: Sortable, filterable docket list on the left with a high-resolution PDF preview and OCR text inspector on the right.
- **Cross-Case Mind Maps**: Interactive entity-relationship graphs linking parties, attorneys, judges, properties, and filings across multiple litigations.
- **Multi-Model AI Agent Studio**: Configurable legal agents powered by Gemini, Claude 3.5 Sonnet, and GPT-4o.
- **Citation-Backed Q&A**: Interactive chat grounded strictly in case filings with verified pinpoint citations.
- **Universal MCP Server**: Exposes court filings and cross-case relations to external AI tools (Claude Desktop, Cursor, Gemini for Mac).

---

## Architecture & Technology Stack

| Layer | Technology |
| :--- | :--- |
| **Front-End** | Next.js (Static HTML Export), React, Tailwind CSS, Lucide Icons |
| **Edge Hosting** | Cloudflare Pages (`docket-key.pages.dev`) |
| **Database & Realtime** | Supabase (PostgreSQL + Realtime CDC + Storage) |
| **Scraper & Engine** | Python 3.11+, Playwright, Requests, BeautifulSoup |
| **MCP Integration** | FastMCP (Python) |

---

## Local Development

```bash
# 1. Install dependencies
npm install

# 2. Start Next.js development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to view the dashboard.

---

## Deploy to Cloudflare Pages

### Automatic Git Deploy (Recommended)
1. Push commits to `main` on GitHub:
   ```bash
   git push origin main
   ```
2. Cloudflare Pages automatically detects changes, builds with `npx next build`, and deploys to `docket-key.pages.dev`.

### Manual CLI Deploy
```bash
npm run deploy:cloudflare
```
