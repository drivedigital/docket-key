'use client';

import React, { useState } from 'react';
import { DocketEntry } from '@/lib/types';
import { Search, Filter, FileText, CheckCircle2, Cloud, AlertCircle, Eye, ArrowUpDown } from 'lucide-react';

interface DocketTableProps {
  entries: DocketEntry[];
  selectedEntryId: string | null;
  onSelectEntry: (entry: DocketEntry) => void;
}

export function DocketTable({ entries, selectedEntryId, onSelectEntry }: DocketTableProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [sortAsc, setSortAsc] = useState<boolean>(false);

  const docTypes = Array.from(new Set(entries.map((e) => e.doc_type)));

  const filteredEntries = entries
    .filter((e) => {
      const matchesSearch =
        e.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
        e.filed_by.toLowerCase().includes(searchTerm.toLowerCase()) ||
        e.doc_number.toString().includes(searchTerm);
      const matchesType = typeFilter === 'all' || e.doc_type === typeFilter;
      return matchesSearch && matchesType;
    })
    .sort((a, b) => {
      return sortAsc ? a.doc_number - b.doc_number : b.doc_number - a.doc_number;
    });

  return (
    <div className="flex flex-col h-full bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      {/* Table Toolbar */}
      <div className="p-4 border-b border-slate-100 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-slate-50/50">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search docket entries, descriptions, or filers..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
          />
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 text-xs text-slate-500">
            <Filter className="h-3.5 w-3.5" />
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="text-xs bg-white border border-slate-200 rounded-lg px-2 py-1.5 outline-none focus:border-indigo-500"
            >
              <option value="all">All Document Types</option>
              {docTypes.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={() => setSortAsc(!sortAsc)}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50"
            title="Sort by Doc Number"
          >
            <ArrowUpDown className="h-3.5 w-3.5" />
            Doc # {sortAsc ? '↑' : '↓'}
          </button>
        </div>
      </div>

      {/* Table Body */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-left border-collapse text-xs">
          <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200 sticky top-0 z-10">
            <tr>
              <th className="py-2.5 px-3 w-16">Doc #</th>
              <th className="py-2.5 px-3 w-28">Date Filed</th>
              <th className="py-2.5 px-3 w-24">Type</th>
              <th className="py-2.5 px-3">Description</th>
              <th className="py-2.5 px-3 w-32">Filed By</th>
              <th className="py-2.5 px-3 w-24">Text / OCR</th>
              <th className="py-2.5 px-3 w-16 text-center">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredEntries.map((entry) => {
              const isSelected = selectedEntryId === entry.id;
              return (
                <tr
                  key={entry.id}
                  onClick={() => onSelectEntry(entry)}
                  className={`hover:bg-indigo-50/50 cursor-pointer transition ${
                    isSelected ? 'bg-indigo-50/80 font-medium' : ''
                  }`}
                >
                  <td className="py-3 px-3 font-mono font-bold text-slate-700">
                    #{entry.doc_number}
                  </td>
                  <td className="py-3 px-3 text-slate-500 whitespace-nowrap">
                    {entry.entry_date}
                  </td>
                  <td className="py-3 px-3">
                    <span
                      className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                        entry.doc_type === 'Motion'
                          ? 'bg-amber-100 text-amber-800'
                          : entry.doc_type === 'Order'
                          ? 'bg-emerald-100 text-emerald-800'
                          : entry.doc_type === 'Affidavit'
                          ? 'bg-violet-100 text-violet-800'
                          : 'bg-slate-100 text-slate-700'
                      }`}
                    >
                      {entry.doc_type}
                    </span>
                  </td>
                  <td className="py-3 px-3 text-slate-800 leading-snug">
                    <div className="line-clamp-2">{entry.description}</div>
                  </td>
                  <td className="py-3 px-3 text-slate-600 truncate max-w-[130px]">
                    {entry.filed_by}
                  </td>
                  <td className="py-3 px-3 whitespace-nowrap">
                    {entry.ocr_status === 'digital_text' ? (
                      <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700 font-medium">
                        <CheckCircle2 className="h-3 w-3" /> Digital Text
                      </span>
                    ) : entry.ocr_status === 'cloud_ocr' ? (
                      <span className="inline-flex items-center gap-1 text-[11px] text-blue-700 font-medium">
                        <Cloud className="h-3 w-3" /> Cloud OCR
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11px] text-amber-700 font-medium">
                        <AlertCircle className="h-3 w-3" /> Pending OCR
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-3 text-center">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectEntry(entry);
                      }}
                      className="p-1 rounded text-slate-400 hover:text-indigo-600 hover:bg-slate-100"
                      title="Preview Filing"
                    >
                      <Eye className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {filteredEntries.length === 0 && (
          <div className="p-8 text-center text-slate-400 text-xs">
            No filings match your current search or type filter.
          </div>
        )}
      </div>
    </div>
  );
}
