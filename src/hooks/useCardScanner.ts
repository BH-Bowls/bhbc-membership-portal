'use client';

// src/hooks/useCardScanner.ts
// A plug-in QR scanner (USB or Bluetooth) at the bar till. These scanners act as a
// keyboard: they "type" the code very fast, usually followed by Enter or Tab. Needs no
// camera, so it works whatever the tablet's kiosk app allows.
//
// Only membership card codes are picked up: BHBC1.<32 hex>.<32 hex> (src/lib/bar-card.ts).
// Their fixed shape means a scan can be recognised as it arrives. Its keys are kept from the
// page, so they don't land in the PIN pad or the search box. The one exception is the first
// "B" when a text box has focus: it's let through, because it might be a person typing, and
// taken back out once the scan completes. The Enter or Tab after a scan is swallowed too.
// Old-style username-only cards aren't picked up; the camera still reads those.
//
// One listener is shared by every caller. The most recently enabled caller gets the scan,
// so a card/PIN dialog that opens over the till takes scans while it is open.

import { useEffect, useRef } from 'react';

const PREFIX = 'bhbc1.';
const CODE_LENGTH = 71;                       // 'BHBC1.' + 32 + '.' + 32
const PARTIAL = /^bhbc1\.([0-9a-f]{0,32}|[0-9a-f]{32}\.[0-9a-f]{0,32})$/i;
const MAX_GAP_MS = 120;                       // a scanner types far faster than a person
const SUFFIX_MS = 300;                        // how long after a scan an Enter/Tab is swallowed

type Handler = { onScan: (code: string) => void };
const handlers: Handler[] = [];
let installed = false;
let buffer = '';
let lastKeyAt = 0;
let suffixUntil = 0;
let leakedInto: HTMLInputElement | HTMLTextAreaElement | null = null;

function couldBeCode(s: string): boolean {
  if (s.length <= PREFIX.length) return PREFIX.startsWith(s.toLowerCase());
  return s.length <= CODE_LENGTH && PARTIAL.test(s);
}

function isTextBox(target: EventTarget | null): target is HTMLInputElement | HTMLTextAreaElement {
  if (target instanceof HTMLTextAreaElement) return true;
  return target instanceof HTMLInputElement && !['button', 'checkbox', 'radio', 'submit'].includes(target.type);
}

// Removes the scan's first "B" from the text box it was typed into. Uses the native value
// setter plus an input event, so React's onChange sees the change.
function takeBackLeakedKey() {
  const box = leakedInto;
  leakedInto = null;
  if (!box || !/b$/i.test(box.value)) return;
  const proto = box instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(box, box.value.slice(0, -1));
  box.dispatchEvent(new Event('input', { bubbles: true }));
}

function onKeyDown(e: KeyboardEvent) {
  if (handlers.length === 0 || e.ctrlKey || e.metaKey || e.altKey) return;
  const now = performance.now();

  if (e.key === 'Enter' || e.key === 'Tab') {
    // The scanner's own Enter/Tab after a code, or the end of a scan that didn't read fully
    if (now < suffixUntil || (buffer.length > 1 && now - lastKeyAt < MAX_GAP_MS)) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
    buffer = '';
    suffixUntil = 0;
    return;
  }
  if (e.key.length !== 1) return;             // Shift and other non-character keys

  const fast = now - lastKeyAt < MAX_GAP_MS;
  lastKeyAt = now;
  let candidate = (fast ? buffer : '') + e.key;
  if (!couldBeCode(candidate)) candidate = e.key;   // not a scan after all — maybe one starts here
  if (candidate.length === 1) leakedInto = null;
  if (!couldBeCode(candidate)) {
    buffer = '';
    return;
  }
  buffer = candidate;

  if (candidate.length === 1 && isTextBox(e.target)) {
    leakedInto = e.target;                    // let it through — it may be a person typing
    return;
  }
  e.preventDefault();
  e.stopImmediatePropagation();

  if (candidate.length === CODE_LENGTH) {
    const code = 'BHBC1.' + candidate.slice(PREFIX.length).toLowerCase();
    buffer = '';
    suffixUntil = now + SUFFIX_MS;
    takeBackLeakedKey();
    const handler = handlers[handlers.length - 1];
    if (handler) handler.onScan(code);
  }
}

/** Calls onScan with a membership card code read by a plug-in scanner, while enabled. */
export function useCardScanner(onScan: (code: string) => void, enabled = true) {
  const latest = useRef(onScan);
  useEffect(() => {
    latest.current = onScan;
  });

  useEffect(() => {
    if (!enabled) return;
    if (!installed) {
      window.addEventListener('keydown', onKeyDown, true);  // capture: before the page sees the key
      installed = true;
    }
    const handler: Handler = { onScan: (code) => latest.current(code) };
    handlers.push(handler);
    return () => {
      const i = handlers.indexOf(handler);
      if (i >= 0) handlers.splice(i, 1);
    };
  }, [enabled]);
}
