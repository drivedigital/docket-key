'use client';

import React, { useState } from 'react';
import { DocketEntry } from '@/lib/types';
import { FileText, Search, ExternalLink, Download, Copy, Check, Eye, Code } from 'lucide-react';

interface PdfViewerPanelProps {
  entry: DocketEntry | null;
  caseName?: string;
  driveFolderUrl?: string | null;
}

export function PdfViewerPanel({ entry, caseName, driveFolderUrl }: PdfViewerPanelProps) {
  const [viewMode, setViewMode] = useState<'preview' | 'ocr_text'>('preview');
  const [copied, setCopied] = useState(false);
  const [searchInDoc, setSearchInDoc] = useState('');

  if (!entry) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-8 text-center bg-white rounded-xl border border-slate-200 text-slate-400">
        <FileText className="h-12 w-12 stroke-[1.2] text-slate-300 mb-3" />
        <h3 className="text-sm font-semibold text-slate-600">No Document Selected</h3>
        <p className="text-xs text-slate-400 max-w-xs mt-1">
          Select any filing from the docket table on the left to preview the source PDF and searchable OCR text.
        </p>
      </div>
    );
  }

  const handleCopyText = () => {
    if (entry.text_content) {
      navigator.clipboard.writeText(entry.text_content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="h-full flex flex-col bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      {/* Document Header */}
      <div className="p-4 border-b border-slate-200 bg-slate-50/80 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono font-bold text-xs bg-indigo-100 text-indigo-800 px-2 py-0.5 rounded">
              Doc #{entry.doc_number}
            </span>
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              {entry.doc_type}
            </span>
          </div>
          <h2 className="text-sm font-semibold text-slate-900 mt-1 line-clamp-1">
            {entry.description}
          </h2>
          <div className="text-[11px] text-slate-500 mt-0.5 flex flex-wrap items-center gap-2">
            <span>Filed: {entry.entry_date}</span>
            <span>•</span>
            <span className="truncate max-w-[200px]">By: {entry.filed_by}</span>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {driveFolderUrl && (
            <a
              href={driveFolderUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50"
              title="Open Case Folder in Google Drive"
            >
              <ExternalLink className="h-3 w-3 text-indigo-500" /> Drive
            </a>
          )}

          <div className="flex bg-slate-200/80 p-0.5 rounded-lg text-xs font-medium">
            <button
              onClick={() => setViewMode('preview')}
              className={`px-2.5 py-1 rounded-md transition ${
                viewMode === 'preview'
                  ? 'bg-white text-slate-900 shadow-sm font-semibold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Eye className="inline h-3 w-3 mr-1" /> PDF Preview
            </button>
            <button
              onClick={() => setViewMode('ocr_text')}
              className={`px-2.5 py-1 rounded-md transition ${
                viewMode === 'ocr_text'
                  ? 'bg-white text-slate-900 shadow-sm font-semibold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Code className="inline h-3 w-3 mr-1" /> Searchable Text
            </button>
          </div>
        </div>
      </div>

      {/* Document Sub-bar / Search */}
      <div className="px-4 py-2 border-b border-slate-100 bg-slate-50/40 flex items-center justify-between text-xs">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          <input
            type="text"
            placeholder="Search text in this document..."
            value={searchInDoc}
            onChange={(e) => setSearchInDoc(e.target.value)}
            className="w-full pl-8 pr-2 py-1 text-xs bg-white border border-slate-200 rounded-md outline-none focus:border-indigo-500"
          />
        </div>

        <div className="flex items-center gap-3 text-slate-500">
          <span className="font-mono text-[11px] text-slate-400">
            {entry.pdf_filename}
          </span>
          <button
            onClick={handleCopyText}
            className="inline-flex items-center gap-1 text-slate-600 hover:text-indigo-600"
            title="Copy extracted text to clipboard"
          >
            {copied ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
            {copied ? 'Copied' : 'Copy Text'}
          </button>
        </div>
      </div>

      {/* Viewer Canvas Area */}
      <div className="flex-1 overflow-auto p-6 bg-slate-100/70">
        {viewMode === 'preview' ? (
          /* Simulated High-Res Legal Document Page Canvas */
          <div className="max-w-2xl mx-auto bg-white rounded-lg shadow-md border border-slate-200 min-h-[700px] p-10 font-serif text-slate-800 leading-relaxed text-sm">
            <div className="text-center border-b border-slate-300 pb-4 mb-6">
              <h4 className="text-xs tracking-widest font-sans font-bold text-slate-500 uppercase">
                New York State Supreme Court Electronic Filing System
              </h4>
              <p className="text-xs font-sans text-slate-400 mt-0.5">
                NYSCEF DOC. NO. {entry.doc_number} • FILED: {entry.entry_date}
              </p>
            </div>

            <div className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-slate-700 bg-slate-50/50 p-4 rounded border border-slate-200/60">
              {entry.text_content || 'No text extracted for this document.'}
            </div>

            <div className="mt-8 pt-4 border-t border-slate-200 flex justify-between items-center text-[10px] font-sans text-slate-400">
              <span>Case: {caseName || 'NYSCEF Matter'}</span>
              <span>Document #{entry.doc_number}</span>
            </div>
          </div>
        ) : (
          /* Searchable Raw OCR Text Layer with Highlighting */
          <div className="max-w-2xl mx-auto bg-white rounded-lg shadow border border-slate-200 p-6 font-mono text-xs text-slate-800 leading-relaxed">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
              <span className="text-slate-500 font-sans font-semibold">
                Extracted Text Layer ({entry.ocr_status.replace('_', ' ')})
              </span>
              <span className="text-slate-400 font-sans">
                {entry.text_content ? entry.text_content.length : 0} characters
              </span>
            </div>

            <pre className="whitespace-pre-wrap overflow-auto">
              {entry.text_content || 'No text content available.'}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
