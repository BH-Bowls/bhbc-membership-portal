// src/lib/bar-offline-queue.ts
// IndexedDB-backed queue for bar till sales made while offline — deliberately NOT
// React state, so it survives a full reboot/reload, not just a tab staying open.
// Only cash/card sales are ever queued here (see app/bar/page.tsx): wallet purchases,
// top-ups, voids, and refunds against a stale/unknown real balance stay disabled while
// offline, except spending/adding to a member's zero-based *offline session* balance
// (tracked separately in localStorage — see offlineWalletDeltas below), which this
// queue also carries as 'topup'/'purchase' entries so they can be replayed as signed
// ledger deltas against the member's real balance once back online.

const DB_NAME = 'bar-offline-queue';
const STORE = 'queue';

export interface QueuedSaleEntry {
  id: string;              // client-generated — lets a future retry avoid double-applying
  createdAt: number;
  kind: 'sale';
  method: 'cash' | 'card';
  items: { productId: string; qty: number }[];
  staff: string;
  userName?: string;       // set only for a member-attributed "Pay by Card"
  grossPence: number;
  netPence: number;
  discountPence: number;
}

export interface QueuedWalletEntry {
  id: string;
  createdAt: number;
  kind: 'topup' | 'purchase';
  userName: string;
  staff: string;
  amountPence: number;     // signed: +topup, -purchase (mirrors bar_ledger.amount_pence)
  paymentMethod?: 'cash' | 'card'; // 'topup' only
  items?: { productId: string; qty: number }[]; // 'purchase' only, for replay as a real wallet sale
}

export type QueuedEntry = QueuedSaleEntry | QueuedWalletEntry;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

export async function enqueue(entry: QueuedEntry): Promise<void> {
  await withStore('readwrite', (store) => store.add(entry));
}

export async function listQueued(): Promise<QueuedEntry[]> {
  const all = await withStore<QueuedEntry[]>('readonly', (store) => store.getAll());
  return all.sort((a, b) => a.createdAt - b.createdAt);
}

export async function dequeue(id: string): Promise<void> {
  await withStore('readwrite', (store) => store.delete(id));
}

export function newQueueId(): string {
  return crypto.randomUUID();
}
