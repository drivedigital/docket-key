'use client';

import React, { useState } from 'react';
import { MindMapWorkspace, EntityNode, EntityRelationEdge } from '@/lib/types';
import { Network, ZoomIn, ZoomOut, Maximize2, Share2, Layers, Filter } from 'lucide-react';

interface MindMapCanvasProps {
  workspace: MindMapWorkspace;
  onSelectNode?: (node: EntityNode) => void;
}

export function MindMapCanvas({ workspace, onSelectNode }: MindMapCanvasProps) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [scale, setScale] = useState<number>(1);
  const [filterCategory, setFilterCategory] = useState<string>('all');

  const nodes = workspace.nodes.filter(
    (n) => filterCategory === 'all' || n.category === filterCategory
  );

  const nodeMap = new Map(workspace.nodes.map((n) => [n.id, n]));

  const categoryColors: Record<string, { bg: string; text: string; border: string }> = {
    party: { bg: 'bg-indigo-50', text: 'text-indigo-800', border: 'border-indigo-300' },
    attorney: { bg: 'bg-emerald-50', text: 'text-emerald-800', border: 'border-emerald-300' },
    judge: { bg: 'bg-amber-50', text: 'text-amber-800', border: 'border-amber-300' },
    property: { bg: 'bg-rose-50', text: 'text-rose-800', border: 'border-rose-300' },
    corporation: { bg: 'bg-purple-50', text: 'text-purple-800', border: 'border-purple-300' },
    event: { bg: 'bg-sky-50', text: 'text-sky-800', border: 'border-sky-300' },
  };

  const handleNodeClick = (node: EntityNode) => {
    setSelectedNodeId(node.id === selectedNodeId ? null : node.id);
    onSelectNode?.(node);
  };

  return (
    <div className="h-full flex flex-col bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden relative">
      {/* Mind Map Header & Toolbar */}
      <div className="p-4 border-b border-slate-200 bg-slate-50/70 flex flex-wrap items-center justify-between gap-3 z-10">
        <div>
          <div className="flex items-center gap-2">
            <Network className="h-4 w-4 text-indigo-600" />
            <h2 className="text-sm font-semibold text-slate-900">{workspace.title}</h2>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">{workspace.description}</p>
        </div>

        <div className="flex items-center gap-2">
          {/* Category Filter */}
          <div className="flex items-center gap-1 text-xs">
            <Filter className="h-3.5 w-3.5 text-slate-400" />
            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="text-xs bg-white border border-slate-200 rounded-lg px-2 py-1 outline-none"
            >
              <option value="all">All Entity Types</option>
              <option value="party">Parties</option>
              <option value="attorney">Attorneys</option>
              <option value="property">Properties</option>
              <option value="corporation">Corporations / Liens</option>
              <option value="event">Zoning & Events</option>
            </select>
          </div>

          {/* Zoom controls */}
          <div className="flex items-center bg-slate-100 border border-slate-200 rounded-lg p-0.5">
            <button
              onClick={() => setScale((s) => Math.max(0.6, s - 0.1))}
              className="p-1 hover:bg-white rounded text-slate-600"
              title="Zoom Out"
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </button>
            <span className="text-[11px] font-mono px-1.5 text-slate-600">
              {Math.round(scale * 100)}%
            </span>
            <button
              onClick={() => setScale((s) => Math.min(1.5, s + 0.1))}
              className="p-1 hover:bg-white rounded text-slate-600"
              title="Zoom In"
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* SVG Canvas Area with Connecting Lines and Nodes */}
      <div className="flex-1 overflow-auto bg-slate-50/40 relative p-8">
        <div
          style={{
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
            minWidth: '900px',
            minHeight: '600px',
            position: 'relative',
          }}
        >
          {/* SVG Connecting Edges */}
          <svg
            className="absolute inset-0 w-full h-full pointer-events-none"
            style={{ width: '1000px', height: '650px' }}
          >
            <defs>
              <marker
                id="arrowhead"
                markerWidth="8"
                markerHeight="6"
                refX="7"
                refY="3"
                orient="auto"
              >
                <polygon points="0 0, 8 3, 0 6" fill="#94a3b8" />
              </marker>
            </defs>

            {workspace.edges.map((edge) => {
              const src = nodeMap.get(edge.source);
              const tgt = nodeMap.get(edge.target);
              if (!src || !tgt) return null;

              const isHighlighted =
                selectedNodeId === src.id || selectedNodeId === tgt.id;

              const x1 = src.x || 0;
              const y1 = src.y || 0;
              const x2 = tgt.x || 0;
              const y2 = tgt.y || 0;

              const midX = (x1 + x2) / 2;
              const midY = (y1 + y2) / 2;

              return (
                <g key={edge.id}>
                  <line
                    x1={x1 + 80}
                    y1={y1 + 25}
                    x2={x2 + 80}
                    y2={y2 + 25}
                    stroke={isHighlighted ? '#6366f1' : '#cbd5e1'}
                    strokeWidth={isHighlighted ? 2.5 : 1.5}
                    strokeDasharray={isHighlighted ? 'none' : '4 2'}
                    markerEnd="url(#arrowhead)"
                  />
                  <rect
                    x={midX + 25}
                    y={midY + 15}
                    width={edge.label.length * 6 + 10}
                    height="18"
                    rx="4"
                    fill="#ffffff"
                    stroke="#e2e8f0"
                  />
                  <text
                    x={midX + 30}
                    y={midY + 28}
                    fill="#64748b"
                    fontSize="9px"
                    fontFamily="monospace"
                  >
                    {edge.label}
                  </text>
                </g>
              );
            })}
          </svg>

          {/* Render Nodes */}
          {nodes.map((node) => {
            const isSelected = selectedNodeId === node.id;
            const style = categoryColors[node.category] || categoryColors.party;

            return (
              <div
                key={node.id}
                onClick={() => handleNodeClick(node)}
                style={{
                  position: 'absolute',
                  left: `${node.x || 100}px`,
                  top: `${node.y || 100}px`,
                  width: '180px',
                }}
                className={`mindmap-node cursor-pointer p-3 rounded-xl border bg-white shadow-sm transition-all select-none ${
                  isSelected
                    ? 'ring-2 ring-indigo-500 shadow-md border-indigo-400'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span
                    className={`text-[9px] uppercase font-bold px-1.5 py-0.5 rounded ${style.bg} ${style.text}`}
                  >
                    {node.category}
                  </span>
                  <span className="text-[10px] text-slate-400">
                    {node.case_ids.length} case{node.case_ids.length > 1 ? 's' : ''}
                  </span>
                </div>
                <h4 className="text-xs font-semibold text-slate-800 leading-snug">
                  {node.name}
                </h4>
              </div>
            );
          })}
        </div>
      </div>

      {/* Legend Footer */}
      <div className="px-4 py-2.5 border-t border-slate-100 bg-white flex flex-wrap items-center justify-between text-xs text-slate-500">
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-semibold text-slate-600 text-[11px]">Legend:</span>
          {Object.entries(categoryColors).map(([cat, colors]) => (
            <div key={cat} className="flex items-center gap-1.5">
              <span className={`w-2.5 h-2.5 rounded-full ${colors.bg} border ${colors.border}`} />
              <span className="capitalize text-[11px] text-slate-600">{cat}</span>
            </div>
          ))}
        </div>
        <span className="text-[11px] text-slate-400">
          Click nodes to trace cross-case relationships
        </span>
      </div>
    </div>
  );
}
