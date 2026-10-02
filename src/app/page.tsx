'use client';

import React, { useState, useEffect } from 'react';
import {
  INITIAL_CASES,
  INITIAL_DOCKETS,
  INITIAL_MIND_MAP,
  INITIAL_AGENTS,
  INITIAL_QUERIES,
} from '@/lib/mockData';
import { Case, DocketEntry, MindMapWorkspace, Agent, QueryRecord } from '@/lib/types';
import { DocketTable } from '@/components/DocketTable';
import { PdfViewerPanel } from '@/components/PdfViewerPanel';
import { MindMapCanvas } from '@/components/MindMapCanvas';
import { NyscefScraperModal } from '@/components/NyscefScraperModal';
import {
  Scale,
  FolderOpen,
  Network,
  Bot,
  MessageSquareText,
  Settings,
  Plus,
  Search,
  ExternalLink,
  Sparkles,
  ShieldCheck,
  Send,
  Loader2,
  Copy,
  Check,
  Play,
  Pause,
  Database,
  Cloud,
  CheckCircle2,
} from 'lucide-react';

type NavTab = 'overview' | 'dockets' | 'mindmap' | 'agents' | 'qa' | 'settings';

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState<NavTab>('dockets');
  const [cases, setCases] = useState<Case[]>(INITIAL_CASES);
  const [selectedCaseId, setSelectedCaseId] = useState<string>('case-510w42');
  const [dockets, setDockets] = useState<DocketEntry[]>(INITIAL_DOCKETS);
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>('doc-1');
  const [agents, setAgents] = useState<Agent[]>(INITIAL_AGENTS);
  const [queries, setQueries] = useState<QueryRecord[]>(INITIAL_QUERIES);
  const [mindMap, setMindMap] = useState<MindMapWorkspace>(INITIAL_MIND_MAP);
  const [isScraperOpen, setIsScraperOpen] = useState(false);
  const [copiedMcp, setCopiedMcp] = useState(false);

  // Q&A state
  const [currentQuestion, setCurrentQuestion] = useState('');
  const [isAsking, setIsAsking] = useState(false);

  const selectedCase = cases.find((c) => c.id === selectedCaseId) || cases[0];
  const selectedEntry = dockets.find((d) => d.id === selectedEntryId) || null;
  const currentCaseDockets = dockets.filter((d) => d.case_id === selectedCase?.id);

  const handleAskQuestion = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentQuestion.trim()) return;

    setIsAsking(true);
    const newQ: QueryRecord = {
      id: `q-${Date.now()}`,
      case_id: selectedCase.id,
      case_name: selectedCase.caption,
      agent_name: 'Docket Sentinel',
      question: currentQuestion,
      answer: `Analysis grounded in ${currentCaseDockets.length} indexed filings for ${selectedCase.caption}: The court record indicates affirmative commitments made during the leasehold transition, subject to compliance with New York Uniform Court Rules [1].`,
      citations: [
        {
          doc_number: 1,
          title: 'Verified Complaint & Summons',
          excerpt: 'allegations concerning possession, emergency restoration, and leasehold preservation',
        },
      ],
      latency_ms: 2150,
      created_at: new Date().toISOString(),
    };

    setTimeout(() => {
      setQueries([newQ, ...queries]);
      setCurrentQuestion('');
      setIsAsking(false);
    }, 1200);
  };

  const copyMcpEndpoint = () => {
    navigator.clipboard.writeText('https://docket-key.pages.dev/api/mcp');
    setCopiedMcp(true);
    setTimeout(() => setCopiedMcp(false), 2000);
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-100/60 font-sans">
      {/* Primary Sidebar */}
      <aside className="w-60 bg-slate-900 text-white flex flex-col justify-between shrink-0 border-r border-slate-800">
        <div>
          {/* Brand header */}
          <div className="p-4 border-b border-slate-800 flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-indigo-500 flex items-center justify-center font-bold text-white shadow-md">
              <Scale className="h-4 w-4" />
            </div>
            <div>
              <h1 className="text-sm font-bold tracking-tight text-white flex items-center gap-1.5">
                Docket-Key
                <span className="text-[9px] font-mono uppercase bg-indigo-500/30 text-indigo-300 px-1.5 py-0.2 rounded">
                  v1.0
                </span>
              </h1>
              <p className="text-[10px] text-slate-400">NYSCEF & Mind Map Engine</p>
            </div>
          </div>

          {/* Navigation Items */}
          <nav className="p-3 space-y-1">
            <button
              onClick={() => setActiveTab('dockets')}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition ${
                activeTab === 'dockets'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              <FolderOpen className="h-4 w-4" />
              <span>Dockets & Filings</span>
            </button>

            <button
              onClick={() => setActiveTab('mindmap')}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition ${
                activeTab === 'mindmap'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              <Network className="h-4 w-4" />
              <span>Cross-Case Mind Map</span>
            </button>

            <button
              onClick={() => setActiveTab('agents')}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition ${
                activeTab === 'agents'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              <Bot className="h-4 w-4" />
              <span>Agent Studio</span>
            </button>

            <button
              onClick={() => setActiveTab('qa')}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition ${
                activeTab === 'qa'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              <MessageSquareText className="h-4 w-4" />
              <span>Q&A & Citations</span>
            </button>

            <button
              onClick={() => setActiveTab('settings')}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition ${
                activeTab === 'settings'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              <Settings className="h-4 w-4" />
              <span>Settings & MCP</span>
            </button>
          </nav>
        </div>

        {/* Sidebar Footer: Cloud & Supabase Indicators */}
        <div className="p-3 border-t border-slate-800 text-[11px] text-slate-400 space-y-2">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-emerald-400 font-medium">
              <Database className="h-3 w-3" /> Supabase
            </span>
            <span className="text-[10px] text-slate-500">Connected</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-indigo-400 font-medium">
              <Cloud className="h-3 w-3" /> Cloudflare
            </span>
            <span className="text-[10px] text-slate-500">docket-key.pages</span>
          </div>
        </div>
      </aside>

      {/* Main Workspace Area */}
      <main className="flex-1 flex flex-col h-full overflow-hidden">
        {/* Top Header Bar */}
        <header className="h-14 bg-white border-b border-slate-200 px-6 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-4">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Active Case:
            </label>
            <select
              value={selectedCaseId}
              onChange={(e) => setSelectedCaseId(e.target.value)}
              className="text-xs font-medium bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:border-indigo-500 max-w-sm truncate"
            >
              {cases.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.index_number} — {c.caption}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsScraperOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg shadow-sm transition"
            >
              <Plus className="h-3.5 w-3.5" /> Pull NYSCEF Docket
            </button>
          </div>
        </header>

        {/* Tab Content Canvas */}
        <div className="flex-1 overflow-hidden p-4">
          {activeTab === 'dockets' && (
            /* Split-Pane: Docket Table + High-Res Document Viewer */
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 h-full">
              <div className="lg:col-span-7 h-full overflow-hidden">
                <DocketTable
                  entries={currentCaseDockets}
                  selectedEntryId={selectedEntryId}
                  onSelectEntry={(entry) => setSelectedEntryId(entry.id)}
                />
              </div>
              <div className="lg:col-span-5 h-full overflow-hidden">
                <PdfViewerPanel
                  entry={selectedEntry}
                  caseName={selectedCase.caption}
                  driveFolderUrl={selectedCase.drive_folder_url}
                />
              </div>
            </div>
          )}

          {activeTab === 'mindmap' && (
            /* Cross-Case Mind Map & Entity Relationship Explorer */
            <div className="h-full">
              <MindMapCanvas workspace={mindMap} />
            </div>
          )}

          {activeTab === 'agents' && (
            /* Agent Studio & Runner (Grok-inspired card grid) */
            <div className="h-full overflow-auto space-y-4">
              <div className="flex items-center justify-between pb-2 border-b border-slate-200">
                <div>
                  <h2 className="text-base font-bold text-slate-900">Legal Intelligence Agents</h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Configured autonomous analysis agents analyzing dockets, proof graphs, and contradictions.
                  </p>
                </div>
                <button
                  onClick={() => alert('Agent creation modal ready')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg"
                >
                  <Plus className="h-3.5 w-3.5" /> New Agent
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                {agents.map((agent) => (
                  <div
                    key={agent.id}
                    className="p-5 rounded-xl border border-slate-200 bg-white shadow-sm flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-start justify-between">
                        <div className="h-9 w-9 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold text-sm">
                          <Bot className="h-5 w-5" />
                        </div>
                        <span
                          className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
                            agent.status === 'active'
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {agent.status}
                        </span>
                      </div>

                      <h3 className="text-sm font-bold text-slate-900 mt-3">{agent.name}</h3>
                      <p className="text-xs font-semibold text-indigo-600 mt-0.5">{agent.role}</p>
                      <p className="text-xs text-slate-500 mt-2 line-clamp-3 leading-relaxed">
                        {agent.system_prompt}
                      </p>
                    </div>

                    <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between">
                      <span className="text-[11px] font-mono text-slate-400 bg-slate-50 px-2 py-0.5 rounded border border-slate-200">
                        {agent.model}
                      </span>
                      <button
                        onClick={() =>
                          alert(`Agent "${agent.name}" executed against ${selectedCase.caption}`)
                        }
                        className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-800"
                      >
                        <Play className="h-3 w-3 fill-current" /> Run Now
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'qa' && (
            /* Fable-style Citation-Backed Q&A */
            <div className="h-full flex flex-col max-w-4xl mx-auto space-y-4">
              {/* Question Input Card */}
              <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-sm">
                <form onSubmit={handleAskQuestion} className="space-y-3">
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>
                      Ask anything grounded in <strong>{selectedCase.caption}</strong>
                    </span>
                    <span className="font-mono text-[10px]">Citations Mode: Active</span>
                  </div>
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="Ask questions about docket entries, dates, or sworn affidavits..."
                      value={currentQuestion}
                      onChange={(e) => setCurrentQuestion(e.target.value)}
                      className="w-full pl-3 pr-24 py-2.5 text-xs bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-indigo-500 focus:bg-white"
                    />
                    <button
                      type="submit"
                      disabled={isAsking || !currentQuestion.trim()}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 px-3 py-1 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-md disabled:opacity-50"
                    >
                      {isAsking ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <span className="flex items-center gap-1">
                          Ask <Send className="h-3 w-3" />
                        </span>
                      )}
                    </button>
                  </div>
                </form>
              </div>

              {/* Q&A Thread Feed */}
              <div className="flex-1 overflow-auto space-y-3">
                {queries.map((q) => (
                  <div
                    key={q.id}
                    className="p-5 bg-white rounded-xl border border-slate-200 shadow-sm space-y-2 text-xs"
                  >
                    <div className="flex items-center justify-between text-slate-500">
                      <span className="font-bold text-slate-800 text-sm">{q.question}</span>
                      <span className="font-mono text-[10px]">
                        {(q.latency_ms / 1000).toFixed(1)}s • {q.agent_name}
                      </span>
                    </div>

                    <p className="text-slate-700 leading-relaxed whitespace-pre-wrap">{q.answer}</p>

                    {q.citations && q.citations.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-slate-100 space-y-1.5">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                          Verified Docket Citations:
                        </span>
                        {q.citations.map((c, i) => (
                          <div
                            key={i}
                            className="p-2 bg-indigo-50/50 border border-indigo-100 rounded-lg flex items-start gap-2"
                          >
                            <span className="font-mono font-bold text-indigo-700 text-[10px]">
                              [Doc #{c.doc_number}]
                            </span>
                            <div>
                              <div className="font-semibold text-slate-800">{c.title}</div>
                              <div className="text-slate-500 italic mt-0.5">"{c.excerpt}"</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'settings' && (
            /* Settings & Remote MCP Connectors */
            <div className="h-full overflow-auto max-w-3xl mx-auto space-y-6">
              <div>
                <h2 className="text-base font-bold text-slate-900">Workspace Settings & Connectors</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Configure remote model API keys, Supabase credentials, and the external MCP server.
                </p>
              </div>

              {/* MCP Server Endpoint */}
              <div className="p-5 bg-white rounded-xl border border-slate-200 shadow-sm space-y-3">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-emerald-600" />
                  <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                    Model Context Protocol (MCP) Endpoint
                  </h3>
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Connect external LLM agents (Claude Desktop, Cursor, Gemini Spark for Mac) to this docket database over MCP.
                </p>

                <div className="flex items-center gap-2 p-2 bg-slate-50 border border-slate-200 rounded-lg">
                  <code className="text-xs font-mono text-indigo-600 flex-1 truncate">
                    https://docket-key.pages.dev/api/mcp
                  </code>
                  <button
                    onClick={copyMcpEndpoint}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded hover:bg-slate-50"
                  >
                    {copiedMcp ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
                    {copiedMcp ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>

              {/* Supabase Verification */}
              <div className="p-5 bg-white rounded-xl border border-slate-200 shadow-sm space-y-3 text-xs">
                <h3 className="font-bold text-slate-900 uppercase tracking-wider text-xs">
                  Connected Cloud Infrastructure
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                    <span className="text-slate-400 block text-[10px]">Database & Auth</span>
                    <strong className="text-slate-800">Supabase (ogbhlsddfajiwyofumrk)</strong>
                  </div>
                  <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                    <span className="text-slate-400 block text-[10px]">Front-End Edge Host</span>
                    <strong className="text-slate-800">Cloudflare Pages (docket-key)</strong>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* NYSCEF Scraper Modal */}
      <NyscefScraperModal
        isOpen={isScraperOpen}
        onClose={() => setIsScraperOpen(false)}
        onSuccess={(index) => {
          alert(`Docket pull complete for Case ${index}! Synced with Supabase.`);
        }}
      />
    </div>
  );
}
