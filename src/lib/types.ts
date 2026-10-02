export interface Case {
  id: string;
  index_number: string;
  court: string;
  caption: string;
  judge?: string | null;
  case_type: string;
  status: 'active' | 'settled' | 'disposed' | 'appealed';
  filing_date: string;
  nyscef_url: string;
  drive_folder_id?: string | null;
  drive_folder_url?: string | null;
  total_filings: number;
  last_synced_at: string;
  created_at?: string;
}

export interface DocketEntry {
  id: string;
  case_id: string;
  doc_number: number;
  entry_date: string;
  doc_type: 'Motion' | 'Affidavit' | 'Summons' | 'Order' | 'Exhibit' | 'Notice' | 'Brief';
  description: string;
  filed_by: string;
  pdf_filename: string;
  pdf_storage_path?: string | null;
  has_text_layer: boolean;
  ocr_status: 'pending' | 'digital_text' | 'cloud_ocr' | 'failed';
  text_content?: string | null;
  created_at?: string;
}

export interface EntityNode {
  id: string;
  name: string;
  category: 'party' | 'attorney' | 'judge' | 'property' | 'corporation' | 'event';
  case_ids: string[];
  x?: number;
  y?: number;
}

export interface EntityRelationEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  case_id: string;
  notes?: string;
}

export interface MindMapWorkspace {
  id: string;
  title: string;
  description: string;
  case_ids: string[];
  nodes: EntityNode[];
  edges: EntityRelationEdge[];
}

export interface Agent {
  id: string;
  name: string;
  role: string;
  model: string;
  system_prompt: string;
  color: 'violet' | 'blue' | 'amber' | 'teal' | 'rose';
  status: 'active' | 'paused';
  request_count: number;
}

export interface QueryRecord {
  id: string;
  case_id: string;
  case_name: string;
  agent_name: string;
  question: string;
  answer: string;
  citations: Array<{
    doc_number: number;
    title: string;
    excerpt: string;
  }>;
  latency_ms: number;
  created_at: string;
}
