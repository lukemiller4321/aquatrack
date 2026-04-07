'use client';

import Image from 'next/image';
import { useEffect, useState, useCallback } from 'react';

type Contact = {
  id: number;
  name: string | null;
  contact: string;
  type: string;
  source: string | null;
  status: string;
  notes: string;
  voicemail: boolean;
  received_at: string;
  updated_at: string;
};

const STATUS_OPTIONS = ['new', 'contacted', 'enrolled', 'not interested', 'no response'];
const TYPE_OPTIONS = ['all', 'call', 'email', 'posh', 'sms', 'other'];

const PRIMARY = '#1B6CA8';
const ACCENT  = '#F5A623';
const DANGER  = '#CC0000';

const STATUS_STYLES: Record<string, { bg: string; text: string }> = {
  new:              { bg: '#DBEAFE', text: PRIMARY },
  contacted:        { bg: '#FEF3C7', text: '#92400E' },
  enrolled:         { bg: '#D1FAE5', text: '#065F46' },
  'not interested': { bg: '#FEE2E2', text: '#991B1B' },
  'no response':    { bg: '#F3F4F6', text: '#6B7280' },
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLES[status] ?? { bg: '#F3F4F6', text: '#6B7280' };
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium"
      style={{ backgroundColor: s.bg, color: s.text }}
    >
      {status}
    </span>
  );
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function ContactsTable() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editNotes, setEditNotes] = useState('');
  const [saving, setSaving] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const fetchContacts = useCallback(async () => {
    try {
      const res = await fetch('/api/contacts');
      const data = await res.json();
      setContacts(Array.isArray(data) ? data : []);
    } catch {
      setContacts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchContacts();
  }, [fetchContacts]);

  useEffect(() => {
    async function pollGmail() {
      try {
        await fetch('/api/gmail/poll');
        await fetchContacts();
      } catch {
        // silent — polling errors shouldn't surface to the user
      }
    }

    pollGmail();
    const id = setInterval(pollGmail, 10 * 60 * 1000);
    return () => clearInterval(id);
  }, [fetchContacts]);

  async function updateStatus(id: number, status: string) {
    setSaving(id);
    await fetch(`/api/contacts/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    setContacts(prev =>
      prev.map(c => (c.id === id ? { ...c, status, updated_at: new Date().toISOString() } : c))
    );
    setSaving(null);
  }

  async function saveNotes(id: number) {
    setSaving(id);
    await fetch(`/api/contacts/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: editNotes }),
    });
    setContacts(prev =>
      prev.map(c => (c.id === id ? { ...c, notes: editNotes, updated_at: new Date().toISOString() } : c))
    );
    setEditingId(null);
    setSaving(null);
  }

  async function deleteContact(id: number) {
    if (!confirm('Delete this contact?')) return;
    await fetch(`/api/contacts/${id}`, { method: 'DELETE' });
    setContacts(prev => prev.filter(c => c.id !== id));
    setSelected(prev => { const next = new Set(prev); next.delete(id); return next; });
  }

  async function deleteSelected() {
    if (!confirm(`Delete ${selected.size} selected contact${selected.size === 1 ? '' : 's'}?`)) return;
    setBulkDeleting(true);
    await Promise.all(
      [...selected].map(id => fetch(`/api/contacts/${id}`, { method: 'DELETE' }))
    );
    setContacts(prev => prev.filter(c => !selected.has(c.id)));
    setSelected(new Set());
    setBulkDeleting(false);
  }

  // Derived selection state relative to current filtered view
  const filteredIds = filtered_ids();
  function filtered_ids() {
    return contacts
      .filter(c => {
        const matchStatus = statusFilter === 'all' || c.status === statusFilter;
        const matchType =
          typeFilter === 'all' ||
          (typeFilter === 'posh' ? c.source === 'posh' : c.type === typeFilter);
        return matchStatus && matchType;
      })
      .map(c => c.id);
  }

  const filtered = contacts.filter(c => {
    const matchStatus = statusFilter === 'all' || c.status === statusFilter;
    const matchType =
      typeFilter === 'all' ||
      (typeFilter === 'posh' ? c.source === 'posh' : c.type === typeFilter);
    return matchStatus && matchType;
  });

  const allVisibleSelected = filteredIds.length > 0 && filteredIds.every(id => selected.has(id));
  const someVisibleSelected = filteredIds.some(id => selected.has(id));

  function toggleSelectAll() {
    if (allVisibleSelected) {
      setSelected(prev => {
        const next = new Set(prev);
        filteredIds.forEach(id => next.delete(id));
        return next;
      });
    } else {
      setSelected(prev => new Set([...prev, ...filteredIds]));
    }
  }

  function toggleOne(id: number) {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const statusCounts = STATUS_OPTIONS.reduce<Record<string, number>>((acc, s) => {
    acc[s] = contacts.filter(c => c.status === s).length;
    return acc;
  }, {});

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header bar */}
      <header className="px-6 py-4 flex items-center gap-3" style={{ backgroundColor: PRIMARY }}>
        <Image
          src="https://i.imgur.com/PuK51bz.png"
          alt="PSS logo"
          width={40}
          height={40}
          className="rounded"
          unoptimized
        />
        <div>
          <h1 className="text-xl font-bold text-white leading-tight">PSS AquaTrack</h1>
          <p className="text-xs text-white/70">Missed contacts dashboard</p>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Summary cards */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-8">
          {STATUS_OPTIONS.map(s => {
            const active = statusFilter === s;
            return (
              <button
                key={s}
                onClick={() => setStatusFilter(prev => (prev === s ? 'all' : s))}
                className="rounded-lg border p-3 text-left transition-colors"
                style={
                  active
                    ? { borderColor: PRIMARY, backgroundColor: '#EFF6FF' }
                    : { borderColor: '#E5E7EB', backgroundColor: '#FFFFFF' }
                }
              >
                <div
                  className="text-2xl font-bold"
                  style={{ color: active ? PRIMARY : '#111827' }}
                >
                  {statusCounts[s] ?? 0}
                </div>
                <div className="text-xs text-gray-500 capitalize mt-0.5">{s}</div>
              </button>
            );
          })}
        </div>

        {/* Filters + bulk delete */}
        <div className="flex flex-wrap gap-3 mb-4">
          <div className="flex items-center gap-1">
            <label className="text-xs font-medium text-gray-500 mr-1">Type</label>
            {TYPE_OPTIONS.map(t => {
              const active = typeFilter === t;
              return (
                <button
                  key={t}
                  onClick={() => setTypeFilter(t)}
                  className="px-3 py-1 rounded-full text-xs font-medium transition-colors border"
                  style={
                    active
                      ? { backgroundColor: PRIMARY, color: '#FFFFFF', borderColor: PRIMARY }
                      : { backgroundColor: '#FFFFFF', color: '#4B5563', borderColor: '#E5E7EB' }
                  }
                >
                  {t}
                </button>
              );
            })}
          </div>

          <div className="ml-auto flex items-center gap-3">
            {selected.size > 0 && (
              <button
                onClick={deleteSelected}
                disabled={bulkDeleting}
                className="text-xs font-semibold text-white px-3 py-1.5 rounded disabled:opacity-50 transition-opacity"
                style={{ backgroundColor: DANGER }}
              >
                {bulkDeleting ? 'Deleting…' : `Delete ${selected.size} selected`}
              </button>
            )}
            <button
              onClick={() => { setStatusFilter('all'); setTypeFilter('all'); }}
              className="text-xs text-gray-400 hover:text-gray-600"
            >
              Clear filters
            </button>
          </div>
        </div>

        {/* Table */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {loading ? (
            <div className="p-12 text-center text-gray-400">Loading contacts...</div>
          ) : filtered.length === 0 ? (
            <div className="p-12 text-center text-gray-400">No contacts match the current filters.</div>
          ) : (
            <table className="w-full table-fixed divide-y divide-gray-100">
              <colgroup>
                <col className="w-8" />
                <col className="w-36" />
                <col className="w-28" />
                <col className="w-32" />
                <col className="w-24" />
                <col className="w-16" />
                <col className="w-28" />
                <col className="w-10" />
                <col />
                <col className="w-12" />
              </colgroup>
              <thead style={{ backgroundColor: '#F0F7FF' }}>
                <tr>
                  <th className="px-2 py-2 w-8">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      ref={el => { if (el) el.indeterminate = someVisibleSelected && !allVisibleSelected; }}
                      onChange={toggleSelectAll}
                      className="rounded border-gray-300 cursor-pointer"
                      style={{ accentColor: PRIMARY }}
                    />
                  </th>
                  {['Received', 'Name', 'Contact', 'Type', 'Source', 'Status', 'VM', 'Notes', ''].map(h => (
                    <th
                      key={h}
                      className="px-2 py-2 text-left text-xs font-semibold uppercase tracking-wide"
                      style={{ color: PRIMARY }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map(c => (
                  <tr
                    key={c.id}
                    className="transition-colors"
                    style={{ backgroundColor: selected.has(c.id) ? '#EFF6FF' : undefined }}
                  >
                    <td className="px-2 py-2">
                      <input
                        type="checkbox"
                        checked={selected.has(c.id)}
                        onChange={() => toggleOne(c.id)}
                        className="rounded border-gray-300 cursor-pointer"
                        style={{ accentColor: PRIMARY }}
                      />
                    </td>
                    <td className="px-2 py-2 text-xs text-gray-500 truncate">
                      {formatDate(c.received_at)}
                    </td>
                    <td className="px-2 py-2 text-xs font-medium text-gray-900 truncate">
                      {c.name ?? <span className="text-gray-400 italic">unknown</span>}
                    </td>
                    <td className="px-2 py-2 text-xs text-gray-700 truncate">{c.contact}</td>
                    <td className="px-2 py-2 text-xs">
                      {c.type === 'call' ? (
                        <span className="rounded px-1.5 py-0.5 font-medium text-white text-xs" style={{ backgroundColor: DANGER }}>
                          Missed Call
                        </span>
                      ) : (
                        <span className="rounded bg-gray-100 px-1.5 py-0.5 font-medium text-gray-600 capitalize text-xs">
                          {c.type === 'email' ? 'Email' : c.type}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-xs text-gray-500 truncate">{c.source ?? '—'}</td>
                    <td className="px-2 py-2">
                      <select
                        value={c.status}
                        disabled={saving === c.id}
                        onChange={e => updateStatus(c.id, e.target.value)}
                        className="w-full text-xs border border-gray-200 rounded px-1 py-1 bg-white focus:outline-none disabled:opacity-50"
                        style={{ ['--tw-ring-color' as string]: PRIMARY }}
                      >
                        {STATUS_OPTIONS.map(s => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                      <span className="mt-1 block">
                        <StatusBadge status={c.status} />
                      </span>
                    </td>
                    <td className="px-2 py-2 text-center">
                      {c.voicemail ? (
                        <span
                          className="inline-flex items-center justify-center w-6 h-6 rounded-full text-white text-xs font-bold"
                          style={{ backgroundColor: ACCENT }}
                          title="Voicemail recorded"
                        >
                          ✓
                        </span>
                      ) : (
                        <span className="text-xs text-gray-300">No</span>
                      )}
                    </td>
                    <td className="px-2 py-2">
                      {editingId === c.id ? (
                        <div className="flex gap-1">
                          <input
                            className="flex-1 min-w-0 text-xs border rounded px-2 py-1 focus:outline-none"
                            style={{ borderColor: PRIMARY }}
                            value={editNotes}
                            onChange={e => setEditNotes(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') saveNotes(c.id); if (e.key === 'Escape') setEditingId(null); }}
                            autoFocus
                          />
                          <button
                            onClick={() => saveNotes(c.id)}
                            disabled={saving === c.id}
                            className="shrink-0 text-xs text-white px-2 py-1 rounded disabled:opacity-50"
                            style={{ backgroundColor: PRIMARY }}
                          >
                            Save
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            className="shrink-0 text-xs text-gray-400 hover:text-gray-600 px-1"
                          >
                            ✕
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => { setEditingId(c.id); setEditNotes(c.notes ?? ''); }}
                          className="text-xs text-gray-500 hover:text-gray-800 text-left w-full truncate"
                        >
                          {c.notes || <span className="italic text-gray-300">Add notes…</span>}
                        </button>
                      )}
                    </td>
                    <td className="px-2 py-2">
                      <button
                        onClick={() => deleteContact(c.id)}
                        className="text-xs text-red-400 hover:text-red-600 transition-colors"
                        title="Delete"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <p className="text-xs text-gray-400 mt-4 text-right">
          Showing {filtered.length} of {contacts.length} contacts
        </p>
      </div>
    </div>
  );
}
