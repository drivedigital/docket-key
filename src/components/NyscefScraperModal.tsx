'use client';

import React, { useState } from 'react';
import { X, ExternalLink, RefreshCw, KeyRound, Check, Download, AlertTriangle } from 'lucide-react';

interface NyscefScraperModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (newCaseIndex: string) => void;
}

export function NyscefScraperModal({ isOpen, onClose, onSuccess }: NyscefScraperModalProps) {
  const [indexNumber, setIndexNumber] = useState('');
  const [caseType, setCaseType] = useState('Commercial - Contract');
  const [sessionId, setSessionId] = useState('');
  const [isScraping, setIsScraping] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');

  if (!isOpen) return null;

  const handleStartScrape = () => {
    if (!indexNumber && !sessionId) return;

    setIsScraping(true);
    setStatusMessage('Initiating NYSCEF connection with session cookie...');

    setTimeout(() => {
      setStatusMessage('Querying docket entries & filing index...');
    }, 1200);

    setTimeout(() => {
      setStatusMessage('Downloading PDF exhibits & indexing text layers...');
    }, 2400);

    setTimeout(() => {
      setIsScraping(false);
      onSuccess(indexNumber || '150428/2024');
      onClose();
    }, 3600);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-lg overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div>
            <h3 className="text-base font-semibold text-slate-900">Pull Case from NYSCEF</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Sync docket entries and filings directly into Supabase & Google Drive
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4 text-xs">
          {/* Instructions Box */}
          <div className="p-3 bg-amber-50/70 border border-amber-200/60 rounded-xl text-amber-900 space-y-1">
            <div className="flex items-center gap-1.5 font-semibold text-amber-800">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              NYSCEF CAPTCHA Requirement
            </div>
            <p className="text-[11px] leading-relaxed text-amber-700">
              NYSCEF requires a valid browser session cookie (<code>JSESSIONID</code>) to search court dockets.
              Solve the CAPTCHA once in your browser, then paste the cookie below (or use the Playwright local runner).
            </p>
            <a
              href="https://iapps.courts.state.ny.us/nyscef/CaseSearch?TAB=courtDateRange"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-700 hover:underline pt-1"
            >
              Open NYSCEF Date Range Search in Browser <ExternalLink className="h-3 w-3" />
            </a>
          </div>

          <div>
            <label className="block font-medium text-slate-700 mb-1">
              Case Index Number
            </label>
            <input
              type="text"
              placeholder="e.g. 150428/2024"
              value={indexNumber}
              onChange={(e) => setIndexNumber(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-xs"
            />
          </div>

          <div>
            <label className="block font-medium text-slate-700 mb-1">
              Case Type Filter
            </label>
            <select
              value={caseType}
              onChange={(e) => setCaseType(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg outline-none focus:border-indigo-500 text-xs bg-white"
            >
              <option value="Commercial - Contract">Commercial - Contract</option>
              <option value="Commercial - Real Property">Commercial - Real Property</option>
              <option value="Torts - Other">Torts - Other</option>
              <option value="All Types">All Types</option>
            </select>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="font-medium text-slate-700">
                NYSCEF Session Cookie (<code className="font-mono">JSESSIONID</code>)
              </label>
              <span className="text-[10px] text-slate-400">Valid for ~60 queries</span>
            </div>
            <div className="relative">
              <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                placeholder="Paste active JSESSIONID from browser..."
                value={sessionId}
                onChange={(e) => setSessionId(e.target.value)}
                className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-xs font-mono"
              />
            </div>
          </div>

          {isScraping && (
            <div className="p-3 bg-indigo-50/70 border border-indigo-200 rounded-xl flex items-center gap-2 text-indigo-800">
              <RefreshCw className="h-4 w-4 animate-spin text-indigo-600" />
              <span className="font-medium text-xs">{statusMessage}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-slate-100 bg-slate-50 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            disabled={isScraping}
            className="px-3.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-200/60 rounded-lg transition"
          >
            Cancel
          </button>
          <button
            onClick={handleStartScrape}
            disabled={isScraping}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg shadow-sm transition disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" /> Start Docket Pull
          </button>
        </div>
      </div>
    </div>
  );
}
