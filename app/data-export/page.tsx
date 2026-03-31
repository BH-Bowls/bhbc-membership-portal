// app/data-export/page.tsx
// Data Export / Report Builder - Admin-only page for extracting CSV data from Google Sheets

'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Navbar } from '@/components/Navbar';
import {
  SheetSchema,
  ReportDefinition,
  ReportFilter,
  DefinitionSummary,
} from '@/lib/types/data-export';

export default function DataExportPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  // Schema state
  const [schemas, setSchemas] = useState<SheetSchema[]>([]);
  const [schemasLoading, setSchemasLoading] = useState(true);
  const [schemasError, setSchemasError] = useState<string | null>(null);

  // Report configuration state
  const [primarySheet, setPrimarySheet] = useState<string>('');
  const [joinedSheets, setJoinedSheets] = useState<string[]>([]);

  // Unified column order: qualified col names (e.g. 'Members.user_name') OR 'fixed:{id}'
  const [columnOrder, setColumnOrder] = useState<string[]>([]);
  const [columnAliases, setColumnAliases] = useState<{ [qualified: string]: string }>({});
  const [fixedColumns, setFixedColumns] = useState<{ id: string; name: string; value: string }[]>([]);

  // Derived: sheet columns currently selected (for checkbox state)
  const selectedColumns = columnOrder.filter((c) => !c.startsWith('fixed:'));

  const [filters, setFilters] = useState<ReportFilter[]>([]);
  const [filterMode, setFilterMode] = useState<'AND' | 'OR'>('AND');

  // Results state
  const [results, setResults] = useState<{
    rowCount: number;
    columnCount: number;
    headers: string[];
    preview: string[][];
  } | null>(null);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  // Saved definitions state
  const [definitions, setDefinitions] = useState<DefinitionSummary[]>([]);
  const [definitionsLoading, setDefinitionsLoading] = useState(false);
  const [showSavedPanel, setShowSavedPanel] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saving, setSaving] = useState(false);
  const [loadedDefinitionId, setLoadedDefinitionId] = useState<string | null>(null);

  const isAdmin = session?.user?.role === 'Admin';

  // Auth check
  useEffect(() => {
    if (status === 'authenticated' && !isAdmin) {
      router.push('/');
    }
  }, [status, isAdmin, router]);

  // Load schemas on mount
  useEffect(() => {
    if (status === 'authenticated' && isAdmin) {
      fetchSchemas();
      fetchDefinitions();
    }
  }, [status, isAdmin]);

  async function fetchSchemas() {
    setSchemasLoading(true);
    setSchemasError(null);
    try {
      const res = await fetch('/api/data-export/schemas');
      if (!res.ok) throw new Error('Failed to fetch schemas');
      const data = await res.json();
      setSchemas(data.schemas);
    } catch (err) {
      setSchemasError(err instanceof Error ? err.message : 'Failed to load schemas');
    } finally {
      setSchemasLoading(false);
    }
  }

  async function fetchDefinitions() {
    setDefinitionsLoading(true);
    try {
      const res = await fetch('/api/data-export/definitions');
      if (!res.ok) throw new Error('Failed to fetch definitions');
      const data = await res.json();
      setDefinitions(data.definitions);
    } catch {
      // Silent fail for definitions list
    } finally {
      setDefinitionsLoading(false);
    }
  }

  // Get the primary sheet's schema
  const primarySchema = schemas.find((s) => s.key === primarySheet);

  // Get compatible sheets for joining (same joinKey as primary)
  const compatibleSheets = primarySchema
    ? schemas.filter((s) => s.key !== primarySheet && s.joinKey === primarySchema.joinKey)
    : [];

  // All sheets currently involved (primary + joined)
  const activeSheetKeys = primarySheet ? [primarySheet, ...joinedSheets] : [];
  const activeSchemas = schemas.filter((s) => activeSheetKeys.includes(s.key));

  // Get all available columns (qualified) for active sheets
  const allAvailableColumns = activeSchemas.flatMap((schema) =>
    schema.columns.map((col) => ({
      qualified: `${schema.key}.${col.name}`,
      label: `${schema.label} > ${col.originalHeader}`,
      sheetKey: schema.key,
      sheetLabel: schema.label,
      columnName: col.name,
      originalHeader: col.originalHeader,
    }))
  );

  // Handle primary sheet change
  function handlePrimaryChange(newPrimary: string) {
    setPrimarySheet(newPrimary);
    setJoinedSheets([]);
    setColumnOrder([]);
    setColumnAliases({});
    setFixedColumns([]);
    setFilters([]);
    setFilterMode('AND');
    setResults(null);
    setRunError(null);
    setLoadedDefinitionId(null);
  }

  // Handle join toggle
  function handleJoinToggle(sheetKey: string) {
    setJoinedSheets((prev) => {
      const newJoins = prev.includes(sheetKey)
        ? prev.filter((k) => k !== sheetKey)
        : [...prev, sheetKey];

      // Remove columns and aliases for removed sheets
      if (prev.includes(sheetKey)) {
        setColumnOrder((cols) => cols.filter((c) => !c.startsWith(`${sheetKey}.`)));
        setColumnAliases((aliases) => {
          const next = { ...aliases };
          Object.keys(next)
            .filter((k) => k.startsWith(`${sheetKey}.`))
            .forEach((k) => delete next[k]);
          return next;
        });
        setFilters((f) => f.filter((filter) => !filter.column.startsWith(`${sheetKey}.`)));
      }

      return newJoins;
    });
    setResults(null);
  }

  // Handle column toggle
  function handleColumnToggle(qualifiedCol: string) {
    const isCurrentlySelected = columnOrder.includes(qualifiedCol);
    setColumnOrder((prev) =>
      prev.includes(qualifiedCol)
        ? prev.filter((c) => c !== qualifiedCol)
        : [...prev, qualifiedCol]
    );
    if (isCurrentlySelected) {
      setColumnAliases((prev) => {
        const next = { ...prev };
        delete next[qualifiedCol];
        return next;
      });
    }
  }

  // Handle select all / deselect all for a sheet
  function handleSelectAllForSheet(sheetKey: string) {
    const sheetCols = allAvailableColumns
      .filter((c) => c.sheetKey === sheetKey)
      .map((c) => c.qualified);

    const allSelected = sheetCols.every((c) => selectedColumns.includes(c));

    if (allSelected) {
      setColumnOrder((prev) => prev.filter((c) => !sheetCols.includes(c)));
      setColumnAliases((prev) => {
        const next = { ...prev };
        sheetCols.forEach((k) => delete next[k]);
        return next;
      });
    } else {
      setColumnOrder((prev) => {
        const existing = new Set(prev);
        const toAdd = sheetCols.filter((c) => !existing.has(c));
        return [...prev, ...toAdd];
      });
    }
  }

  // Fixed column management
  function addFixedColumn() {
    const id = `fc_${Date.now()}`;
    setFixedColumns((prev) => [...prev, { id, name: '', value: '' }]);
    setColumnOrder((prev) => [...prev, `fixed:${id}`]);
  }

  function updateFixedColumn(id: string, updates: Partial<{ name: string; value: string }>) {
    setFixedColumns((prev) => prev.map((fc) => (fc.id === id ? { ...fc, ...updates } : fc)));
  }

  function removeFixedColumn(id: string) {
    setFixedColumns((prev) => prev.filter((fc) => fc.id !== id));
    setColumnOrder((prev) => prev.filter((c) => c !== `fixed:${id}`));
  }

  // Filter management
  function addFilter() {
    if (allAvailableColumns.length === 0) return;
    setFilters((prev) => [
      ...prev,
      { column: allAvailableColumns[0].qualified, operator: 'in', values: [] },
    ]);
  }

  function updateFilter(index: number, updates: Partial<ReportFilter>) {
    setFilters((prev) =>
      prev.map((f, i) => (i === index ? { ...f, ...updates } : f))
    );
  }

  function removeFilter(index: number) {
    setFilters((prev) => prev.filter((_, i) => i !== index));
  }

  // Build the current definition
  function buildDefinition(): ReportDefinition {
    return {
      id: loadedDefinitionId || undefined,
      name: saveName || 'Untitled Report',
      primarySheet,
      joins: joinedSheets,
      selectedColumns,
      filters: filters.filter(
        (f) => f.operator === 'is_blank' || f.operator === 'is_not_blank' || f.values.length > 0
      ),
      filterMode,
      columnAliases: Object.keys(columnAliases).length > 0 ? columnAliases : undefined,
      fixedColumns: fixedColumns.length > 0 ? fixedColumns : undefined,
      columnOrder,
    };
  }

  // Run report
  async function handleRunReport() {
    if (!primarySheet || columnOrder.length === 0) return;

    setRunning(true);
    setRunError(null);
    setResults(null);

    try {
      const res = await fetch('/api/data-export/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ definition: buildDefinition() }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to run report');
      }

      const data = await res.json();
      setResults(data);
    } catch (err) {
      setRunError(err instanceof Error ? err.message : 'Failed to run report');
    } finally {
      setRunning(false);
    }
  }

  // Save definition
  async function handleSave() {
    if (!saveName.trim()) return;

    setSaving(true);
    try {
      const res = await fetch('/api/data-export/definitions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: loadedDefinitionId || undefined,
          name: saveName,
          definition: buildDefinition(),
        }),
      });

      if (!res.ok) throw new Error('Failed to save');
      const saved = await res.json();
      setLoadedDefinitionId(saved.id);
      await fetchDefinitions();
    } catch {
      // Error handled silently
    } finally {
      setSaving(false);
    }
  }

  // Load definition
  async function handleLoadDefinition(id: string) {
    try {
      const res = await fetch(`/api/data-export/definitions/${id}`);
      if (!res.ok) throw new Error('Failed to load');
      const def: ReportDefinition = await res.json();

      setPrimarySheet(def.primarySheet);
      setJoinedSheets(def.joins || []);
      // Restore unified column order (backwards compat: fall back to selectedColumns)
      setColumnOrder(
        def.columnOrder && def.columnOrder.length > 0
          ? def.columnOrder
          : def.selectedColumns || []
      );
      setColumnAliases(def.columnAliases || {});
      setFixedColumns(def.fixedColumns || []);
      setFilters(def.filters || []);
      setFilterMode(def.filterMode || 'AND');
      setSaveName(def.name || '');
      setLoadedDefinitionId(def.id || id);
      setResults(null);
      setRunError(null);
      setShowSavedPanel(false);
    } catch {
      // Error handled silently
    }
  }

  // Delete definition
  async function handleDeleteDefinition(id: string) {
    if (!confirm('Delete this saved report definition?')) return;

    try {
      await fetch(`/api/data-export/definitions/${id}`, { method: 'DELETE' });
      if (loadedDefinitionId === id) {
        setLoadedDefinitionId(null);
      }
      await fetchDefinitions();
    } catch {
      // Error handled silently
    }
  }

  // Download CSV from preview
  function handleDownloadCSV() {
    if (!results) return;

    let csv = results.headers.join(',') + '\n';
    for (const row of results.preview) {
      csv +=
        row.map((cell) => `"${(cell || '').replace(/"/g, '""')}"`).join(',') +
        '\n';
    }

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `data-export-${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  if (!isAdmin) return null;

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar
        userName={session?.user?.name || ''}
        userRole={session?.user?.role || ''}
      />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-6 gap-4">
          <h1 className="text-2xl font-bold text-gray-900">Data Export</h1>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={handleRunReport}
              disabled={running || !primarySheet || columnOrder.length === 0}
              className={`inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white ${
                running || !primarySheet || columnOrder.length === 0
                  ? 'bg-gray-400 cursor-not-allowed'
                  : 'bg-blue-600 hover:bg-blue-700'
              }`}
            >
              {running ? (
                <>
                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Running...
                </>
              ) : (
                'Run Report'
              )}
            </button>
            <button
              onClick={() => setShowSavedPanel(!showSavedPanel)}
              className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
            >
              {showSavedPanel ? 'Hide Saved' : 'Load Saved'}
            </button>
          </div>
        </div>

        {/* Saved Definitions Panel */}
        {showSavedPanel && (
          <div className="bg-white rounded-lg shadow mb-6 p-4">
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Saved Reports</h2>
            {definitionsLoading ? (
              <p className="text-gray-500 text-sm">Loading...</p>
            ) : definitions.length === 0 ? (
              <p className="text-gray-500 text-sm">No saved reports yet.</p>
            ) : (
              <div className="space-y-2">
                {definitions.map((def) => (
                  <div
                    key={def.id}
                    className="flex items-center justify-between p-3 border border-gray-200 rounded-md"
                  >
                    <div>
                      <div className="text-sm font-medium text-gray-900">{def.name}</div>
                      <div className="text-xs text-gray-500">
                        Updated: {new Date(def.updatedAt).toLocaleDateString()}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleLoadDefinition(def.id)}
                        className="text-sm text-blue-600 hover:text-blue-800 font-medium"
                      >
                        Load
                      </button>
                      <button
                        onClick={() => handleDeleteDefinition(def.id)}
                        className="text-sm text-red-600 hover:text-red-800 font-medium"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Save Bar */}
        <div className="bg-white rounded-lg shadow mb-6 p-4">
          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
            <label className="text-sm font-medium text-gray-700 whitespace-nowrap">
              Report Name:
            </label>
            <input
              type="text"
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              placeholder="Enter a name to save this report..."
              className="flex-1 border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-blue-500 focus:border-blue-500"
            />
            <button
              onClick={handleSave}
              disabled={saving || !saveName.trim() || !primarySheet}
              className={`inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white ${
                saving || !saveName.trim() || !primarySheet
                  ? 'bg-gray-400 cursor-not-allowed'
                  : 'bg-green-600 hover:bg-green-700'
              }`}
            >
              {saving ? 'Saving...' : loadedDefinitionId ? 'Update' : 'Save'}
            </button>
            {loadedDefinitionId && (
              <>
                <button
                  onClick={() => setLoadedDefinitionId(null)}
                  className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
                >
                  New
                </button>
                <button
                  onClick={() => {
                    setPrimarySheet('');
                    setJoinedSheets([]);
                    setColumnOrder([]);
                    setColumnAliases({});
                    setFixedColumns([]);
                    setFilters([]);
                    setFilterMode('AND');
                    setSaveName('');
                    setLoadedDefinitionId(null);
                    setResults(null);
                    setRunError(null);
                  }}
                  className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
                >
                  Clear
                </button>
              </>
            )}
          </div>
        </div>

        {schemasError && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
            <p className="text-red-700 text-sm">{schemasError}</p>
          </div>
        )}

        {schemasLoading ? (
          <div className="bg-white rounded-lg shadow p-8 text-center">
            <p className="text-gray-500">Loading sheet schemas...</p>
          </div>
        ) : (
          <>
            {/* Card 1: Report Configuration */}
            <div className="bg-white rounded-lg shadow mb-6 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Report Configuration</h2>

              {/* Primary Sheet */}
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Primary Sheet
                </label>
                <select
                  value={primarySheet}
                  onChange={(e) => handlePrimaryChange(e.target.value)}
                  className="block w-full sm:w-64 border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="">Select a sheet...</option>
                  {schemas.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label} (join: {s.joinKey})
                    </option>
                  ))}
                </select>
              </div>

              {/* Joined Sheets */}
              {primarySheet && compatibleSheets.length > 0 && (
                <div className="mb-6">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Join With (same join key: {primarySchema?.joinKey})
                  </label>
                  <div className="flex flex-wrap gap-3">
                    {compatibleSheets.map((s) => (
                      <label
                        key={s.key}
                        className="inline-flex items-center gap-2 text-sm text-gray-700"
                      >
                        <input
                          type="checkbox"
                          checked={joinedSheets.includes(s.key)}
                          onChange={() => handleJoinToggle(s.key)}
                          className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                        />
                        {s.label}
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* Select Columns */}
              {primarySheet && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Select Columns
                  </label>
                  <div className="space-y-4 max-h-96 overflow-y-auto border border-gray-200 rounded-md p-4">
                    {activeSchemas.map((schema) => {
                      const sheetCols = schema.columns.map(
                        (c) => `${schema.key}.${c.name}`
                      );
                      const allSelected = sheetCols.every((c) =>
                        selectedColumns.includes(c)
                      );
                      const someSelected = sheetCols.some((c) =>
                        selectedColumns.includes(c)
                      );

                      return (
                        <div key={schema.key}>
                          <div className="flex items-center gap-2 mb-2">
                            <input
                              type="checkbox"
                              checked={allSelected}
                              ref={(el) => {
                                if (el) el.indeterminate = someSelected && !allSelected;
                              }}
                              onChange={() => handleSelectAllForSheet(schema.key)}
                              className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                            />
                            <span className="text-sm font-semibold text-gray-900">
                              {schema.label}
                            </span>
                          </div>
                          <div className="ml-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1">
                            {schema.columns.map((col) => {
                              const qualified = `${schema.key}.${col.name}`;
                              return (
                                <label
                                  key={qualified}
                                  className="inline-flex items-center gap-2 text-sm text-gray-600"
                                >
                                  <input
                                    type="checkbox"
                                    checked={selectedColumns.includes(qualified)}
                                    onChange={() => handleColumnToggle(qualified)}
                                    className="h-3.5 w-3.5 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                                  />
                                  {col.originalHeader}
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Output Column Order */}
              {primarySheet && (
                <div className="mt-6">
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium text-gray-700">
                      Output Column Order ({columnOrder.length} column{columnOrder.length !== 1 ? 's' : ''})
                    </label>
                    <button
                      onClick={addFixedColumn}
                      className="text-sm text-purple-600 hover:text-purple-800 font-medium"
                    >
                      + Fixed Column
                    </button>
                  </div>

                  {columnOrder.length === 0 ? (
                    <p className="text-sm text-gray-400 italic border border-gray-200 rounded-md p-4">
                      Select columns above or add a fixed column.
                    </p>
                  ) : (
                    <div className="border border-gray-200 rounded-md divide-y divide-gray-100">
                      {columnOrder.map((colKey, index) => {
                        const isFixed = colKey.startsWith('fixed:');

                        // Move up / down handlers shared by both types
                        const moveUp = () => {
                          if (index === 0) return;
                          setColumnOrder((prev) => {
                            const next = [...prev];
                            [next[index - 1], next[index]] = [next[index], next[index - 1]];
                            return next;
                          });
                        };
                        const moveDown = () => {
                          if (index === columnOrder.length - 1) return;
                          setColumnOrder((prev) => {
                            const next = [...prev];
                            [next[index], next[index + 1]] = [next[index + 1], next[index]];
                            return next;
                          });
                        };
                        const reorderButtons = (
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              onClick={moveUp}
                              disabled={index === 0}
                              title="Move up"
                              className="p-1 rounded text-gray-400 hover:text-gray-700 disabled:opacity-25 disabled:cursor-not-allowed"
                            >
                              ▲
                            </button>
                            <button
                              onClick={moveDown}
                              disabled={index === columnOrder.length - 1}
                              title="Move down"
                              className="p-1 rounded text-gray-400 hover:text-gray-700 disabled:opacity-25 disabled:cursor-not-allowed"
                            >
                              ▼
                            </button>
                          </div>
                        );

                        if (isFixed) {
                          const fixedId = colKey.substring(6);
                          const fc = fixedColumns.find((f) => f.id === fixedId);
                          if (!fc) return null;

                          return (
                            <div
                              key={colKey}
                              className="flex items-center gap-2 px-3 py-2 bg-purple-50"
                            >
                              <span className="text-xs text-gray-400 w-5 text-right shrink-0">
                                {index + 1}
                              </span>
                              <span className="text-xs font-medium text-purple-700 bg-purple-100 px-1.5 py-0.5 rounded shrink-0">
                                Fixed
                              </span>
                              <input
                                type="text"
                                value={fc.name}
                                onChange={(e) => updateFixedColumn(fc.id, { name: e.target.value })}
                                placeholder="Column name"
                                className="w-36 text-sm border border-gray-300 rounded px-2 py-1 focus:ring-blue-500 focus:border-blue-500 shrink-0"
                              />
                              <span className="text-xs text-gray-400 shrink-0">=</span>
                              <input
                                type="text"
                                value={fc.value}
                                onChange={(e) => updateFixedColumn(fc.id, { value: e.target.value })}
                                placeholder="Fixed value"
                                className="flex-1 text-sm border border-gray-300 rounded px-2 py-1 focus:ring-blue-500 focus:border-blue-500 min-w-0"
                              />
                              {reorderButtons}
                              <button
                                onClick={() => removeFixedColumn(fc.id)}
                                title="Remove column"
                                className="p-1 rounded text-red-400 hover:text-red-600"
                              >
                                ✕
                              </button>
                            </div>
                          );
                        }

                        // Field column
                        const dotIndex = colKey.indexOf('.');
                        const sheetKey = colKey.substring(0, dotIndex);
                        const colName = colKey.substring(dotIndex + 1);
                        const schema = activeSchemas.find((s) => s.key === sheetKey);
                        const col = schema?.columns.find((c) => c.name === colName);
                        const sheetLabel = schema?.label ?? sheetKey;
                        const colLabel = col?.originalHeader ?? colName;
                        const hasAlias = !!columnAliases[colKey];

                        return (
                          <div
                            key={colKey}
                            className="flex items-center gap-2 px-3 py-2 bg-white hover:bg-gray-50"
                          >
                            <span className="text-xs text-gray-400 w-5 text-right shrink-0">
                              {index + 1}
                            </span>
                            <span className="text-xs text-gray-400 shrink-0 hidden sm:block">
                              {sheetLabel} ›
                            </span>
                            <span className={`text-sm shrink-0 min-w-0 ${hasAlias ? 'text-gray-400 line-through' : 'text-gray-700'}`}>
                              {colLabel}
                            </span>
                            <input
                              type="text"
                              value={columnAliases[colKey] ?? ''}
                              onChange={(e) => {
                                const val = e.target.value;
                                setColumnAliases((prev) => {
                                  if (!val) {
                                    const next = { ...prev };
                                    delete next[colKey];
                                    return next;
                                  }
                                  return { ...prev, [colKey]: val };
                                });
                              }}
                              placeholder="Rename..."
                              className="w-32 text-sm border border-gray-300 rounded px-2 py-1 focus:ring-blue-500 focus:border-blue-500 shrink-0"
                            />
                            {reorderButtons}
                            <button
                              onClick={() => handleColumnToggle(colKey)}
                              title="Remove column"
                              className="p-1 rounded text-red-400 hover:text-red-600"
                            >
                              ✕
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Card 2: Filters */}
            {primarySheet && (
              <div className="bg-white rounded-lg shadow mb-6 p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <h2 className="text-lg font-semibold text-gray-900">Filters</h2>
                    {filters.length > 1 && (
                      <div className="flex items-center rounded-md border border-gray-300 overflow-hidden text-sm">
                        <button
                          onClick={() => setFilterMode('AND')}
                          className={`px-3 py-1 font-medium transition-colors ${
                            filterMode === 'AND'
                              ? 'bg-blue-600 text-white'
                              : 'bg-white text-gray-600 hover:bg-gray-50'
                          }`}
                        >
                          AND
                        </button>
                        <button
                          onClick={() => setFilterMode('OR')}
                          className={`px-3 py-1 font-medium transition-colors ${
                            filterMode === 'OR'
                              ? 'bg-blue-600 text-white'
                              : 'bg-white text-gray-600 hover:bg-gray-50'
                          }`}
                        >
                          OR
                        </button>
                      </div>
                    )}
                  </div>
                  <button
                    onClick={addFilter}
                    disabled={allAvailableColumns.length === 0}
                    className="text-sm text-blue-600 hover:text-blue-800 font-medium"
                  >
                    + Add Filter
                  </button>
                </div>

                {filters.length === 0 ? (
                  <p className="text-gray-500 text-sm">
                    No filters applied. All rows will be included.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {filters.map((filter, index) => (
                      <div key={index}>
                        {index > 0 && (
                          <div className="flex items-center my-1">
                            <div className="flex-1 border-t border-gray-200" />
                            <span className="mx-2 text-xs font-semibold text-gray-400 uppercase tracking-wide">
                              {filterMode}
                            </span>
                            <div className="flex-1 border-t border-gray-200" />
                          </div>
                        )}
                        <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center p-3 border border-gray-200 rounded-md">
                          <select
                            value={filter.column}
                            onChange={(e) =>
                              updateFilter(index, { column: e.target.value })
                            }
                            className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-blue-500 focus:border-blue-500 w-full sm:w-auto"
                          >
                            {allAvailableColumns.map((col) => (
                              <option key={col.qualified} value={col.qualified}>
                                {col.label}
                              </option>
                            ))}
                          </select>
                          <select
                            value={filter.operator}
                            onChange={(e) =>
                              updateFilter(index, {
                                operator: e.target.value as ReportFilter['operator'],
                                values: [],
                              })
                            }
                            className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-blue-500 focus:border-blue-500"
                          >
                            <option value="in">IN</option>
                            <option value="not_in">NOT IN</option>
                            <option value="is_blank">IS BLANK</option>
                            <option value="is_not_blank">IS NOT BLANK</option>
                            <option value="contains">CONTAINS</option>
                            <option value="not_contains">NOT CONTAINS</option>
                            <option value="gt">GREATER THAN</option>
                            <option value="lt">LESS THAN</option>
                          </select>
                          {(filter.operator === 'in' || filter.operator === 'not_in') && (
                            <input
                              type="text"
                              value={filter.values.join(',')}
                              onChange={(e) =>
                                updateFilter(index, {
                                  values: e.target.value.split(','),
                                })
                              }
                              onBlur={(e) =>
                                updateFilter(index, {
                                  values: e.target.value
                                    .split(',')
                                    .map((v) => v.trim())
                                    .filter((v) => v),
                                })
                              }
                              placeholder="Value1, Value2, ..."
                              className="flex-1 border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-blue-500 focus:border-blue-500 w-full"
                            />
                          )}
                          {(filter.operator === 'contains' || filter.operator === 'not_contains') && (
                            <input
                              type="text"
                              value={filter.values.join(', ')}
                              onChange={(e) =>
                                updateFilter(index, {
                                  values: e.target.value
                                    .split(',')
                                    .map((v) => v.trim())
                                    .filter((v) => v),
                                })
                              }
                              placeholder="Text to search for..."
                              className="flex-1 border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-blue-500 focus:border-blue-500 w-full"
                            />
                          )}
                          {(filter.operator === 'gt' || filter.operator === 'lt') && (
                            <input
                              type="text"
                              value={filter.values[0] ?? ''}
                              onChange={(e) =>
                                updateFilter(index, { values: [e.target.value] })
                              }
                              placeholder="e.g. 100"
                              className="flex-1 border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-blue-500 focus:border-blue-500 w-full"
                            />
                          )}
                          {(filter.operator === 'is_blank' || filter.operator === 'is_not_blank') && (
                            <span className="flex-1 text-sm text-gray-400 italic">
                              (no value needed)
                            </span>
                          )}
                          <button
                            onClick={() => removeFilter(index)}
                            className="text-red-500 hover:text-red-700 text-sm font-medium whitespace-nowrap"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Run Error */}
            {runError && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
                <p className="text-red-700 text-sm">{runError}</p>
              </div>
            )}

            {/* Card 3: Results Preview */}
            {results && (
              <div className="bg-white rounded-lg shadow mb-6 p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-gray-900">Results Preview</h2>
                  <button
                    onClick={handleDownloadCSV}
                    className="inline-flex items-center px-3 py-1.5 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
                  >
                    Download Preview CSV
                  </button>
                </div>

                <div className="mb-4 text-sm text-gray-600">
                  <span className="font-medium">{results.rowCount}</span> rows,{' '}
                  <span className="font-medium">{results.columnCount}</span> columns
                  {results.rowCount > 10 && (
                    <span className="ml-1">(showing first 10 rows)</span>
                  )}
                </div>

                <p className="text-sm text-gray-500 mb-4">
                  Full results have been written to the{' '}
                  <span className="font-medium">ReportOutput</span> tab in your Members
                  spreadsheet. Open the spreadsheet to access all rows and download
                  as CSV from Google Sheets.
                </p>

                {results.preview.length > 0 && (
                  <div className="overflow-x-auto border border-gray-200 rounded-md">
                    <table className="min-w-full divide-y divide-gray-200 text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          {results.headers.map((header, i) => (
                            <th
                              key={i}
                              className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap"
                            >
                              {header}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {results.preview.map((row, rowIdx) => (
                          <tr key={rowIdx} className={rowIdx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                            {row.map((cell, cellIdx) => (
                              <td
                                key={cellIdx}
                                className="px-3 py-2 text-gray-700 whitespace-nowrap max-w-xs truncate"
                                title={cell}
                              >
                                {cell}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
