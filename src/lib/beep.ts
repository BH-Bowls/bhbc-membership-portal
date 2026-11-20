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
    const length = kind === 'ok' ? 0.12 : 0.3;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = kind === 'ok' ? 1800 : 400; // high chirp vs low buzz
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + length);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + length);
  } catch { /* ignore */ }
}
