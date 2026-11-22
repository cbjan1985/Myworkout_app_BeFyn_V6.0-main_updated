import { plugin, isApp } from './env.js';

let nativeOk = null, ctx = null;
const tone = (f, d, v = 0.4) => {
  try { ctx = ctx || new (globalThis.AudioContext || globalThis.webkitAudioContext)(); if (ctx.state === 'suspended') ctx.resume(); const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime;
    o.type = 'sine'; o.frequency.value = f; o.connect(g); g.connect(ctx.destination); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + d); o.start(t); o.stop(t + d + 0.02); } catch (_) { /* audio unavailable */ }
};
export const beep = () => { tone(880, 0.22); setTimeout(() => tone(880, 0.22), 280); setTimeout(() => tone(1175, 0.3), 560); };
export const tick = () => tone(900, 0.1, 0.3);
export const vibrate = (p = [200, 100, 200]) => { try { navigator.vibrate && navigator.vibrate(p); } catch (_) { /* not supported */ } };

/** Speaks through Android text-to-speech when the app is running natively, else the browser voice, else a tone. */
export async function speak(text, { enabled = true, rate = 0.95 } = {}) {
  if (!enabled || !text) return false;
  const P = isApp() ? plugin('GifFolder') : null;
  if (P && nativeOk !== false) {
    try { await P.speak({ text: String(text), rate }); nativeOk = true; return true; } catch (_) { nativeOk = false; }
  }
  try {
    const ss = globalThis.speechSynthesis;
    if (ss && typeof SpeechSynthesisUtterance !== 'undefined') { ss.cancel(); const u = new SpeechSynthesisUtterance(String(text)); u.rate = rate; u.lang = 'en-US'; setTimeout(() => { try { ss.resume(); ss.speak(u); } catch (_) { /* ignore */ } }, 50); return true; }
  } catch (_) { /* fall through */ }
  if (/^[1-3]$/.test(String(text))) tick();
  return false;
}
export function stopSpeaking() { try { plugin('GifFolder')?.stopSpeak?.(); globalThis.speechSynthesis?.cancel(); } catch (_) { /* ignore */ } }
export const voiceStatus = () => ({ native: nativeOk, browser: typeof SpeechSynthesisUtterance !== 'undefined' });
