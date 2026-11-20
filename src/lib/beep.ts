// src/lib/beep.ts
// Short beeps for the till, made with the Web Audio API (no audio file needed).
// iOS/iPadOS only lets audio start after a touch, so primeBeep() is called when the
// scan modal opens (which is always from a tap).

let ctx: AudioContext | null = null;

export function primeBeep() {
  try {
    if (!ctx) {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') void ctx.resume();
  } catch { /* no audio available — carry on silently */ }
}

export function beep(kind: 'ok' | 'error' = 'ok') {
  try {
    primeBeep();
    if (!ctx) return;
    const length = kind === 'ok' ? 0.2 : 0.45;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = kind === 'ok' ? 1500 : 500; // chirp vs buzz — kept in the range tablet speakers handle best
    gain.gain.setValueAtTime(1.0, ctx.currentTime);
    gain.gain.setValueAtTime(1.0, ctx.currentTime + length * 0.7); // hold full volume, then fade the tail
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + length);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + length);
  } catch { /* ignore */ }
}
