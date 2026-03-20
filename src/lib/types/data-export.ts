// src/lib/types/data-export.ts
// Type definitions for the Data Export / Report Builder feature

// ============================================================================
// SHEET REGISTRY TYPES
// ============================================================================

export type JoinKey = 'user_name' | 'club_name';

export interface SheetDescriptor {
  key: string;
  label: string;
  sheetName: string;
  spreadsheetKey: 'MEMBERS_SPREADSHEET_ID' | 'FRIENDLIES_SPREADSHEET_ID' | 'MATCH_DAY_CONTACTS_SPREADSHEET_ID';
  joinKey: JoinKey;
}

// ============================================================================
// SCHEMA TYPES
// ============================================================================

export interface SchemaColumn {
  name: string;           // Normalized column name (e.g., "user_name")
  originalHeader: string; // Original header text (e.g., "User Name")
}

export interface SheetSchema {
  key: string;
  label: string;
  joinKey: JoinKey;
  columns: SchemaColumn[];
}

// ============================================================================
// REPORT DEFINITION TYPES
// ============================================================================

export interface ReportFilter {
  column: string;        // Qualified column: "Members.member_type"
  operator: 'in' | 'not_in' | 'is_blank' | 'is_not_blank' | 'contains' | 'not_contains' | 'gt' | 'lt';
  values: string[];
}

export interface ReportDefinition {
  id?: string;
  name: string;
  primarySheet: string;  // Sheet key, e.g., "Members"
  joins: string[];       // Sheet keys to join, e.g., ["Renewals", "Players"]
  selectedColumns: string[]; // Qualified columns: "Members.user_name", "Renewals.amount"
  filters: ReportFilter[];
  filterMode?: 'AND' | 'OR';  // How filters are combined (default: AND)
  columnAliases?: { [qualified: string]: string }; // Override output header names
  fixedColumns?: { id: string; name: string; value: string }[]; // Static value columns
  columnOrder?: string[]; // Unified output order: qualified names OR 'fixed:{id}' entries
  createdAt?: string;
  updatedAt?: string;
}

// ============================================================================
// API REQUEST/RESPONSE TYPES
// ============================================================================

export interface SchemasResponse {
  schemas: SheetSchema[];
}

export interface RunReportRequest {
  definition: ReportDefinition;
}

export interface RunReportResponse {
  rowCount: number;
  columnCount: number;
  headers: string[];
  preview: string[][]; // First 10 rows
}

export interface SaveDefinitionRequest {
  id?: string;
  name: string;
  definition: ReportDefinition;
}

export interface DefinitionSummary {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface DefinitionsListResponse {
  definitions: DefinitionSummary[];
}
