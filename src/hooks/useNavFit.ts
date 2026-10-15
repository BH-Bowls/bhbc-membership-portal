// src/hooks/useNavFit.ts
// Makes the desktop navbar fit its space, in stages, checking after each one:
//   1. Show every item with its icon. Fits? Stop.
//   2. Drop the icons. Fits? Stop.
//   3. Move the last item into a "More" menu, check again, and repeat until it fits.
//
// It never measures individual items — it only asks "does the row of items overflow
// the space it has?", by comparing the row's natural width (rowRef) with the width of
// the slot it sits in (slotRef). The slot must be able to shrink (flex-1 min-w-0) and
// the row must not (flex-none), so the row's width is always the width it *wants*.
//
// Every stage change happens in useLayoutEffect, which runs after React updates the
// page but before the browser draws it — so people only ever see the final result,
// never the menu shuffling. Whenever the slot changes size (window resized, tablet
// rotated) or the items change (e.g. roles load, impersonation), it starts again from
// stage 1, so items come back out of More when there's room again.

import { useLayoutEffect, useRef, useState } from 'react';

interface NavFitStage {
  showIcons: boolean;
  moreCount: number; // how many items (from the end) are in the More menu
}

// A new object every time, so a reset always re-renders and re-checks the fit — even
// when the menu is already at the full stage but the space has just shrunk
const full = (): NavFitStage => ({ showIcons: true, moreCount: 0 });

/**
 * @param itemsKey  changes whenever the set of items changes (e.g. their names joined)
 * @param itemCount how many items are allowed to move into More
 * @param active    whether the desktop item row is on the page at all (it isn't in
 *                  guest mode, or while a page shows its own action buttons)
 */
export function useNavFit(itemsKey: string, itemCount: number, active: boolean) {
  const slotRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState<NavFitStage>(full);

  // Which items/visibility the current stage was worked out for
  const fittedFor = useRef('');

  // Runs whenever the row appears: start again from the full menu each time the
  // slot changes width
  useLayoutEffect(() => {
    const slot = slotRef.current;
    if (!active || !slot) return;
    let lastWidth = slot.clientWidth;
    const observer = new ResizeObserver(() => {
      if (slot.clientWidth === lastWidth) return;
      lastWidth = slot.clientWidth;
      setStage(full());
    });
    observer.observe(slot);
    return () => observer.disconnect();
  }, [active]);

  // Runs after each stage change (and when the items change): if the items have
  // changed, start again from the full menu; otherwise, if the row still
  // overflows, take the next step
  useLayoutEffect(() => {
    const key = `${itemsKey}|${active}`;
    if (fittedFor.current !== key) {
      fittedFor.current = key;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset before measuring, before paint
      setStage(full());
      return;
    }

    const slot = slotRef.current;
    const row = rowRef.current;
    if (!slot || !row) return;

    // Hidden (phone width, the hamburger menu is showing instead) — nothing to fit
    if (slot.clientWidth === 0) return;

    const overflows = row.offsetWidth > slot.clientWidth;
    if (!overflows) return;

    if (stage.showIcons) {
      setStage({ showIcons: false, moreCount: 0 });
    } else if (stage.moreCount < itemCount) {
      setStage({ showIcons: false, moreCount: stage.moreCount + 1 });
    }
    // Otherwise everything that can move is already in More — nothing more to do
  }, [stage, itemsKey, itemCount, active]);

  return { slotRef, rowRef, showIcons: stage.showIcons, moreCount: stage.moreCount };
}
