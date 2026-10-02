-- =============================================================================
-- Docket-Key: Initial Schema Migration for Supabase
-- Covers: Cases, Dockets, Entities, Cross-Case Mind Maps, Agents, Queries & Realtime
-- =============================================================================

-- Enable uuid and pgvector if available
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Tracked Cases
CREATE TABLE IF NOT EXISTS cases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    index_number TEXT UNIQUE NOT NULL,            -- e.g., '150123/2024'
    court TEXT NOT NULL,                          -- e.g., 'New York County Supreme Court'
    caption TEXT NOT NULL,                        -- e.g., 'In re 510 W 42nd Hotel Lease'
    judge TEXT,
    case_type TEXT DEFAULT 'Commercial',
    status TEXT DEFAULT 'active',                 -- 'active', 'settled', 'disposed', 'appealed'
    filing_date DATE,
    nyscef_url TEXT,
    drive_folder_id TEXT,
    drive_folder_url TEXT,
    total_filings INTEGER DEFAULT 0,
    last_synced_at TIMESTAMPTZ DEFAULT now(),
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Docket Entries & Filings
CREATE TABLE IF NOT EXISTS docket_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id UUID REFERENCES cases(id) ON DELETE CASCADE,
    doc_number INTEGER NOT NULL,                  -- NYSCEF Doc #
    entry_date DATE NOT NULL,
    doc_type TEXT NOT NULL,                       -- 'Motion', 'Affidavit', 'Summons', 'Order', 'Exhibit'
    description TEXT NOT NULL,
    filed_by TEXT,
    pdf_filename TEXT,
    pdf_storage_path TEXT,
    has_text_layer BOOLEAN DEFAULT FALSE,
    ocr_status TEXT DEFAULT 'pending',            -- 'pending', 'digital_text', 'cloud_ocr', 'failed'
    text_content TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(case_id, doc_number)
);

-- 3. Entities (Nodes for Cross-Case Mind Maps & Network Analysis)
CREATE TABLE IF NOT EXISTS entities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    category TEXT NOT NULL,                       -- 'party', 'attorney', 'judge', 'property', 'corporation', 'event'
    primary_case_id UUID REFERENCES cases(id) ON DELETE SET NULL,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 4. Entity Relationships (Edges for Cross-Case Connections)
CREATE TABLE IF NOT EXISTS entity_relations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_entity_id UUID REFERENCES entities(id) ON DELETE CASCADE,
    target_entity_id UUID REFERENCES entities(id) ON DELETE CASCADE,
    case_id UUID REFERENCES cases(id) ON DELETE CASCADE,
    relation_type TEXT NOT NULL,                  -- 'sues', 'represents', 'owns', 'cross_moves_against', 'testifies_in'
    evidence_doc_number INTEGER,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 5. Saved Mind Maps & Workspace Layouts
CREATE TABLE IF NOT EXISTS mind_maps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    description TEXT,
    case_ids UUID[] DEFAULT '{}',
    layout_data JSONB NOT NULL,                   -- Nodes, edges, positions, collapse states
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 6. Configured AI Agents
CREATE TABLE IF NOT EXISTS agents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    model TEXT NOT NULL DEFAULT 'gemini-1.5-pro',
    system_prompt TEXT NOT NULL,
    color TEXT DEFAULT 'violet',
    status TEXT DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 7. Q&A Log with Citations
CREATE TABLE IF NOT EXISTS queries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id UUID REFERENCES cases(id) ON DELETE CASCADE,
    agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
    question TEXT NOT NULL,
    answer TEXT,
    citations JSONB DEFAULT '[]',
    latency_ms INTEGER,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable Realtime for live updates on Cases and Docket Entries
ALTER PUBLICATION supabase_realtime ADD TABLE cases;
ALTER PUBLICATION supabase_realtime ADD TABLE docket_entries;
ALTER PUBLICATION supabase_realtime ADD TABLE mind_maps;
