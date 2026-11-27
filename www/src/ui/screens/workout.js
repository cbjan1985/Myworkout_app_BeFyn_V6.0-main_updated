// Workout execution: a focused full-screen flow. Every logged set is persisted immediately, so an interruption never loses work.
import { h } from '../dom.js';
import { openSheet, toast, confirmDialog } from '../dom.js';
import { btn, iconBtn, stepper, banner, pill, chips, list, item, textarea, field, progressBar, toggle } from '../components.js';
import { icon } from '../icons.js';
import { ring } from '../charts.js';
import { SECTION_LABEL } from '../../domain/programme.js';
import { parseTarget, parseLoad } from '../../domain/progression.js';
import { targetText, outline } from '../session-view.js';
import { formatDuration, prettyDate } from '../../core/util.js';
import { youtubeThumb, youtubeSearch, safeUrl } from '../../platform/media.js';

const BLOCK = { superset: 'Superset', triset: 'Tri-set', dropset: 'Drop set' };

export async function workout(app, ctx) {
  const draft = app.state.draft;
  if (!draft) { setTimeout(() => app.router.navigate('/today', { replace: true }), 0); return { title: 'Workout', content: h('div') }; }
  const plan = app.planForDraft(draft);
  if (!plan || !plan.steps.length) { await app.discardDraft(); setTimeout(() => app.router.navigate('/today', { replace: true }), 0); toast('That workout has no exercises to run.'); return { title: 'Workout', content: h('div') }; }
  const steps = plan.steps, V = app.platform.voice, prefs = () => app.state.prefs;
  const say = (t) => V.speak(t, { enabled: prefs().voice?.enabled !== false });
  const st = { phase: 'overview', i: 0, timer: null, effort: null, notes: draft.notes || '', result: null, saving: false };
  const done = Object.keys(draft.records).length;
  if (done > 0) { st.i = Math.min(steps.length - 1, Math.max(...Object.keys(draft.records).map(Number)) + 1); st.phase = st.i >= steps.length ? 'summary' : 'exercise'; }
  if (st.i >= steps.length) st.i = steps.length - 1;

  const root = h('div', { class: 'player', role: 'region', 'aria-label': 'Workout' });
  const head = h('div', { class: 'player-head' }), barHost = h('div', { style: { padding: '0 16px' } }), body = h('div', { class: 'player-body' }), foot = h('div', { class: 'player-foot' });
  root.append(head, barHost, body, foot);
  let wake = null; try { navigator.wakeLock?.request('screen').then((w) => { wake = w; }).catch(() => {}); } catch (_) { /* not supported */ }
  const stopTimer = () => { if (st.timer) { clearInterval(st.timer.h); st.timer = null; } };
  const leave = () => { stopTimer(); V.stopSpeaking?.(); try { wake && wake.release(); } catch (_) { /* ignore */ } };
  const isLive = () => root.isConnected;
  const fmt = (s) => formatDuration(s);

  /* ---------- helpers ---------- */
  const prevRecordFor = (idx) => { const it = steps[idx].item; for (let j = idx - 1; j >= 0; j--) if (steps[j].item.exercise === it.exercise && (steps[j].item.side || '') === (it.side || '') && draft.records[j] && draft.records[j].done) return draft.records[j]; return null; };
  const goto = (i, phase = 'exercise') => { stopTimer(); st.i = i; st.phase = phase; draw(); body.scrollTop = 0; };
  const advance = async (rec) => {
    const idx = st.i, step = steps[idx];
    await app.recordSet(draft, idx, rec);
    const next = idx + 1;
    if (next >= steps.length) return goto(steps.length - 1, 'summary');
    const nx = steps[next], pw = prefs().workout;
    const sameEx = nx.item.exercise === step.item.exercise && step.sideOf !== 'Left';
    const nextIsRight = step.sideOf === 'Left'; // Left -> Right is one movement: no rest, no transition
    let rest = 0, label = 'Rest';
    if (rec.done && !nextIsRight) {
      rest = step.restAfterRound || 0;
      if (!rest && step.section === 'main' && step.blockType === 'straight') rest = sameEx ? pw.restSec : pw.breakSec;   // between sets: rest; between exercises: break
      if (!rest && step.section === 'breathing' && nx.section === 'breathing') rest = pw.breathBreakSec;
    }
    if (rest > 0 && pw.autoRest === false) { st.pendingRest = { sec: rest, next }; rest = 0; }
    if (rest > 0) { st.next = next; return startRest(rest, label); }
    if (rec.done && !nextIsRight && pw.transitionSec > 0 && nx.item.exercise !== step.item.exercise) { st.next = next; return startRest(pw.transitionSec, 'Get ready'); }
    if (steps[next].section !== step.section) { say(`Next: ${SECTION_LABEL[steps[next].section]}`); toast(`Next: ${SECTION_LABEL[steps[next].section]}`); }
    goto(next);
  };

  /* ---------- rest ---------- */
  function startRest(sec, label = 'Rest') {
    stopTimer(); st.phase = 'rest'; st.restLabel = label; st.restTotal = sec; st.restEnd = Date.now() + sec * 1000; draw(); say(`${label}. Next: ${steps[st.next].item.name}`);
    let said = -1;
    st.timer = { h: setInterval(() => {
      if (!isLive()) return stopTimer();
      const left = Math.max(0, Math.ceil((st.restEnd - Date.now()) / 1000)); updateRest(left);
      if (left <= 3 && left > 0 && said !== left) { said = left; say(String(left)); }
      if (left <= 0) { stopTimer(); V.beep(); V.vibrate(); goto(st.next); }
    }, 200) };
  }
  let restUi = null;
  const updateRest = (left) => { if (!restUi) return; restUi.t.textContent = fmt(left); restUi.r.set(left / st.restTotal); };

  /* ---------- timed and breathing ---------- */
  function runTimer(step, total, onDone) {
    stopTimer(); let said = -1; const end = Date.now() + total * 1000; st.tim = { end, total, paused: false };
    const tick = () => { if (!isLive()) return stopTimer(); const left = Math.max(0, Math.ceil((st.tim.end - Date.now()) / 1000)); if (st.tim.ui) { st.tim.ui.t.textContent = fmt(left); st.tim.ui.r.set(left / total); }
      if (left <= 3 && left > 0 && said !== left) { said = left; say(String(left)); } if (left <= 0) { stopTimer(); V.beep(); V.vibrate(); onDone(total); } };
    st.timer = { h: setInterval(tick, 200) };
  }
  function runBreathing(step, onDone) {
    const it = step.item, bp = it.breath || {}, pr = prefs().breathing || {};
    const t = { i: bp.in ?? pr.i ?? 4, h: bp.hold ?? pr.h ?? 0, o: bp.out ?? pr.o ?? 6, h2: bp.hold2 ?? pr.h2 ?? 0 }; const cycle = t.i + t.h + t.o + t.h2 || 10;
    const cycles = bp.cycles || Math.max(1, Math.round((it.secs || 60) / cycle)); const total = cycles * cycle;
    stopTimer(); const start = Date.now(); let lastPhase = ''; st.br = { cycles, total };
    st.timer = { h: setInterval(() => {
      if (!isLive()) return stopTimer(); const el = (Date.now() - start) / 1000; if (el >= total) { stopTimer(); V.beep(); V.vibrate(); return onDone(Math.round(total)); }
      const c = Math.floor(el / cycle), r = el % cycle; let ph, scale;
      if (r < t.i) { ph = 'Breathe in'; scale = 0.55 + 0.45 * (r / t.i); } else if (r < t.i + t.h) { ph = 'Hold'; scale = 1; } else if (r < t.i + t.h + t.o) { ph = 'Breathe out'; scale = 1 - 0.45 * ((r - t.i - t.h) / t.o); } else { ph = 'Hold'; scale = 0.55; }
      const key = c + ph; if (key !== lastPhase) { lastPhase = key; say(ph); }
      const u = st.tim && st.tim.ui; if (u) { u.p.textContent = ph; u.c.textContent = `Breath ${c + 1} of ${cycles}`; u.b.style.transform = `scale(${scale.toFixed(3)})`; u.t.textContent = fmt(Math.max(0, Math.ceil(total - el))); }
    }, 120) };
  }

  /* ---------- drawing ---------- */
  function drawHead() {
    const n = steps.length, k = Math.min(st.i + 1, n);
    head.replaceChildren(iconBtn('close', 'Leave workout', exitSheet), h('div', { class: 'grow' }, h('div', { class: 'strong' }, plan.name), st.phase === 'exercise' || st.phase === 'rest' ? h('div', { class: 'small muted num' }, `Step ${k} of ${n}`) : null),
      iconBtn(prefs().voice?.enabled === false ? 'close' : 'voice', prefs().voice?.enabled === false ? 'Voice guidance is off. Turn on' : 'Voice guidance is on. Turn off', async () => { await app.updatePref('voice', { enabled: prefs().voice?.enabled === false }); V.stopSpeaking(); drawHead(); }), iconBtn('list', 'Session overview', overviewSheet));
    barHost.replaceChildren(...(st.phase === 'exercise' || st.phase === 'rest' ? [progressBar((k / n) * 100, 'Workout progress')] : []));
  }
  function draw() { drawHead(); ({ overview: drawOverview, exercise: drawExercise, rest: drawRest, summary: drawSummary, saved: drawSaved })[st.phase](); }

  function drawOverview() {
    const sections = plan.session.sections ? outline(plan.session) : [];
    body.replaceChildren(h('h1', { class: 'ex-title' }, plan.name), h('p', { class: 'muted' }, `${steps.length} steps. Your sets are saved as you go, so you can stop any time.`), ...sections.map((o) => h('div', {}, h('h3', { class: 'strong small muted', style: { margin: '10px 0 4px' } }, o.label), list(o.rows.map((r) => item({ title: r.title, meta: r.meta, chev: false }))))));
    foot.replaceChildren(btn(Object.keys(draft.records).length ? 'Resume' : 'Start', () => { goto(st.i); announce(); }, { block: true, icon: 'play' }));
  }
  const announce = () => { const s = steps[st.i]; say(`${s.item.name}${s.item.side ? ', ' + s.item.side + ' side' : ''}. ${targetText({ ...s.item, sets: 1 })}`); };

  function drawExercise() {
    const step = steps[st.i], it = step.item, ex = app.exercise(it.exercise);
    const tgt = parseTarget(it.target, it), load = parseLoad(it.load); const timed = !!it.secs && !it.reps && !/rep/.test(it.target || '') && step.section !== 'breathing' && !it.breath;
    const breathing = step.section === 'breathing' || !!it.breath;
    const strength = step.section === 'main' && !timed;
    const hist = strength ? app.exerciseHistory(it.exercise) : []; const sug = strength ? app.suggestFor(it) : null; const prevSet = prevRecordFor(st.i);
    const info = step.blockType !== 'straight' ? `${BLOCK[step.blockType] || 'Block'} \u00b7 round ${step.round} of ${step.rounds}` : step.rounds > 1 ? `Set ${step.round} of ${step.rounds}` : SECTION_LABEL[step.section];
    const mediaBox = h('div', { class: 'media', 'aria-label': `${it.name} demonstration` }, icon('image', 40)); resolveMedia(mediaBox, ex);
    const kids = [h('div', { class: 'row wrap' }, pill(SECTION_LABEL[step.section], 'acc'), info !== SECTION_LABEL[step.section] ? pill(info) : null, it.side ? pill(`${it.side} side`) : null),
      h('h1', { class: 'ex-title' }, it.name + (it.side ? ` (${it.side})` : '')),
      h('p', { class: 'muted' }, [targetText({ ...it, sets: 1 }), it.cue, step.note].filter(Boolean).join(' \u00b7 ')),
      mediaBox];
    if (hist.length || (sug && sug.basis === 'history')) kids.push(h('div', { class: 'card' }, hist.length ? h('p', { class: 'small' }, h('strong', {}, 'Last time: '), hist[0].sets.filter((s) => s.done !== false).map((s) => `${s.reps || s.secs}${s.kg ? ` \u00d7 ${s.kg} kg` : ''}`).join(', '), ` (${prettyDate(hist[0].date)})`) : null, sug ? h('p', { class: 'small', style: { marginTop: '4px' } }, h('strong', {}, 'Suggestion: '), sug.reason) : null));
    if ((ex && (ex.instructions || ex.breathing || ex.commonMistakes?.length)) || it.how || it.detail) kids.push(h('details', { class: 'card' }, h('summary', { class: 'strong', style: { cursor: 'pointer', minHeight: '32px' } }, 'How to do it'), h('div', { class: 'stack', style: { marginTop: '8px' } }, ex.instructions && h('p', {}, ex.instructions), ex.breathing && h('p', { class: 'small' }, h('strong', {}, 'Breathing: '), ex.breathing), (ex.commonMistakes || []).length ? h('p', { class: 'small' }, h('strong', {}, 'Avoid: '), ex.commonMistakes.join('; ')) : null, (it.how || it.detail) && !ex.instructions ? h('p', {}, it.how || it.detail) : null)));
    body.replaceChildren(...kids);

    const skipRow = h('div', { class: 'row' }, st.i > 0 ? btn('Back', undoLast, { kind: 'text', sm: true, icon: 'undo' }) : null, h('span', { class: 'grow' }), btn('Skip set', () => advance({ done: false }), { kind: 'text', sm: true }), btn('Skip exercise', skipExercise, { kind: 'text', sm: true }), btn('Finish early', finishEarly, { kind: 'text', sm: true }));
    if (breathing || timed) {
      const total = breathing ? 0 : it.secs;
      const ui = { t: h('div', { class: 'timer num' }, timed ? fmt(total) : '--:--'), r: ring(1), p: h('div', { class: 'ex-title center' }, 'Ready'), c: h('div', { class: 'small muted center' }, ''), b: h('div', { style: { width: '120px', height: '120px', borderRadius: '50%', background: 'var(--accent-soft)', border: '3px solid var(--accent)', transition: 'transform .3s linear', transform: 'scale(.55)' } }) };
      st.tim = { ui };
      const wrapper = breathing ? h('div', { class: 'stack center' }, h('div', { style: { height: '150px', display: 'grid', placeItems: 'center' } }, ui.b), ui.p, ui.c, ui.t) : h('div', { class: 'ring', role: 'timer', 'aria-label': 'Exercise timer' }, ui.r, ui.t);
      body.append(wrapper);
      const startBtn = btn(breathing ? 'Begin breathing' : 'Start timer', () => {
        startBtn.disabled = true; startBtn.textContent = 'Running\u2026'; say('Begin');
        const fin = (secs) => advance({ secs, done: true });
        breathing ? runBreathing(step, fin) : runTimer(step, total, fin);
      }, { block: true, icon: 'play' });
      foot.replaceChildren(startBtn, btn(breathing ? 'Mark done' : 'Done early', () => { const elapsed = st.tim && st.tim.end ? Math.round(total - (st.tim.end - Date.now()) / 1000) : 0; stopTimer(); advance({ secs: Math.max(0, elapsed) || total, done: true }); }, { kind: 'secondary', block: true }), skipRow);
    } else {
      const pv = prevSet || null; const defReps = (pv && pv.reps) || (sug && sug.reps) || tgt.max || it.reps || 10; const defKg = (pv && pv.kg != null) ? pv.kg : (sug && sug.kg != null) ? sug.kg : (load.kg || 0);
      const reps = stepper({ value: defReps, min: 0, max: 200, label: 'Reps' }), kg = stepper({ value: defKg, min: 0, max: 500, step: 0.5, decimals: 1, label: 'Weight in kilograms' });
      const showKg = strength && load.kg !== 0 || (load.kg > 0);
      body.append(h('div', { class: 'card stack' }, h('div', { class: 'row' }, h('div', { class: 'grow' }, h('div', { class: 'small strong', style: { marginBottom: '6px' } }, 'Reps'), reps), showKg ? h('div', { class: 'grow' }, h('div', { class: 'small strong', style: { marginBottom: '6px' } }, 'Weight (kg)'), kg) : null)));
      foot.replaceChildren(btn(step.section === 'main' ? 'Log set' : 'Done', () => advance({ reps: reps.get(), kg: showKg ? kg.get() : 0, done: true }), { block: true, icon: 'check' }), skipRow);
    }
    if (st.pendingRest && st.pendingRest.next === st.i) { const pr = st.pendingRest; st.pendingRest = null; foot.prepend(btn(`Start ${pr.sec}s rest`, () => { st.next = st.i; startRest(pr.sec, 'Rest'); }, { kind: 'secondary', block: true })); }
    if (st.autoSay) { announce(); st.autoSay = false; }
  }
  async function resolveMedia(box, ex) {
    try {
      const m = ex ? await app.platform.media.resolve(ex) : null; if (!box.isConnected) return;
      if (m) { box.replaceChildren(m.type === 'video' ? h('video', { src: m.url, controls: true, loop: true, muted: true, playsinline: true, preload: 'metadata', 'aria-label': ex.name }) : h('img', { src: m.url, alt: `${ex.name} demonstration`, onerror: (e) => { e.target.replaceWith(icon('image', 40)); } })); return; }
      const link = (ex?.media || []).find((x) => x.kind === 'youtube' && safeUrl(x.url)); const th = link && youtubeThumb(link.url);
      const url = link ? link.url : youtubeSearch(ex?.name || '');
      box.replaceChildren(h('div', { class: 'stack center', style: { padding: '16px' } }, th ? h('img', { src: th, alt: '', style: { maxHeight: '140px', borderRadius: '8px' }, onerror: (e) => e.target.remove() }) : icon('image', 40), h('a', { class: 'btn secondary sm', href: url, target: '_blank', rel: 'noopener' }, icon('link', 18), link ? 'Watch demo video' : 'Find a demo video')));
    } catch (_) { /* leave the placeholder */ }
  }
  function finishEarly() { st.returnTo = st.i; goto(steps.length - 1, 'summary'); }
  async function undoLast() { stopTimer(); const prev = st.i - 1; await app.undoRecord(draft, prev); goto(prev); }
  async function skipExercise() {
    const step = steps[st.i]; let j = st.i;
    while (j < steps.length && steps[j].item.exercise === step.item.exercise && steps[j].section === step.section) { draft.records[j] = { reps: 0, kg: 0, secs: 0, restSec: 0, done: false, at: new Date().toISOString() }; j++; }
    draft.stepIndex = j; await app.saveDraft(draft); if (j >= steps.length) goto(steps.length - 1, 'summary'); else goto(j);
  }

  function drawRest() {
    const nx = steps[st.next]; const t = h('div', { class: 'timer num', role: 'timer', 'aria-label': 'Rest timer' }, fmt(Math.ceil((st.restEnd - Date.now()) / 1000))); const r = ring(1); restUi = { t, r };
    body.replaceChildren(h('div', { class: 'center strong', style: { fontSize: 'var(--fs-lg)' } }, st.restLabel || 'Rest'), h('div', { class: 'ring' }, r, t), h('div', { class: 'card' }, h('div', { class: 'small muted' }, 'Up next'), h('div', { class: 'strong', style: { fontSize: 'var(--fs-md)' } }, nx.item.name + (nx.item.side ? ` (${nx.item.side})` : '')), h('div', { class: 'small muted' }, targetText({ ...nx.item, sets: 1 }))));
    foot.replaceChildren(btn(st.restLabel === 'Get ready' ? 'Start now' : 'Skip rest', () => { stopTimer(); goto(st.next); announce(); }, { block: true }), btn('Add 15 seconds', () => { st.restEnd += 15000; st.restTotal += 15; }, { kind: 'secondary', block: true }));
  }

  function drawSummary() {
    const recs = Object.values(draft.records), logged = recs.filter((r) => r.done).length, skipped = recs.length - logged;
    const secs = Math.round((Date.now() - new Date(draft.startedAt).getTime()) / 1000); const vol = Math.round(recs.reduce((t, r) => t + (r.done ? (r.kg || 0) * (r.reps || 0) : 0), 0));
    const notes = textarea({ placeholder: 'How did it go? (optional)', value: st.notes, oninput: () => { st.notes = notes.value; } });
    const err = h('div', { class: 'stack' });
    body.replaceChildren(h('h1', { class: 'ex-title' }, 'Nice work'), h('p', { class: 'muted' }, 'Review and save your workout.'),
      h('div', { class: 'card metrics' }, h('div', { class: 'metric' }, h('div', { class: 'metric-v num' }, fmt(secs)), h('div', { class: 'metric-l' }, 'Time')), h('div', { class: 'metric' }, h('div', { class: 'metric-v num' }, logged), h('div', { class: 'metric-l' }, 'Sets done')), vol ? h('div', { class: 'metric' }, h('div', { class: 'metric-v num' }, vol), h('div', { class: 'metric-l' }, 'kg lifted')) : null),
      skipped ? h('p', { class: 'small muted' }, `${skipped} skipped. Skipped sets are not counted as done.`) : null,
      h('div', { class: 'card stack' }, h('div', { class: 'strong' }, 'How hard did it feel?'), chips(Array.from({ length: 10 }, (_, i) => [String(i + 1), String(i + 1)]), st.effort ? String(st.effort) : '', (v) => { st.effort = v ? +v : null; drawSummary(); }, 'Effort from 1 to 10'), h('p', { class: 'small muted' }, '1 is very easy, 10 is maximum effort. Optional, and used only for your recovery insights.')), field('Notes', notes), err);
    const remaining = steps.filter((x) => !draft.records[x.index]).length; const mainTotal = steps.filter((x) => x.section === 'main').length, mainDone = steps.filter((x) => x.section === 'main' && draft.records[x.index]?.done).length;
    if (st.countAsDone === undefined) st.countAsDone = !(remaining > 0 && mainTotal > 0 && mainDone / mainTotal < 0.5);
    if (remaining > 0 && draft.kind === 'scheduled') body.append(h('div', { class: 'card stack' }, h('div', { class: 'strong' }, `${remaining} step${remaining === 1 ? '' : 's'} not done`), h('label', { class: 'row between' }, h('span', {}, h('span', { class: 'strong' }, 'Count this session as done'), h('span', { class: 'small muted', style: { display: 'block' } }, st.countAsDone ? 'Your programme moves on to the next session.' : 'Your sets are saved as a partial workout. The session stays to do.')), toggle(st.countAsDone, (v) => { st.countAsDone = v; drawSummary(); }, 'Count this session as done'))));
    foot.replaceChildren(btn(st.saving ? 'Saving\u2026' : 'Finish and save', async () => {
      if (st.saving) return; st.saving = true; drawSummary();
      draft.notes = st.notes; const r = await app.finishSession(draft, { feedback: st.effort ? { effort: st.effort } : null, notes: st.notes, countAsDone: st.countAsDone !== false }); st.saving = false;
      if (!r.ok) { drawSummary(); body.append(banner([r.error.message, ' Your sets are safe. Use Calendar > Jump ahead if you meant to continue from here.'], { kind: 'err', icon: 'warn' })); return; }
      st.result = r; st.phase = 'saved'; draw();
    }, { block: true, icon: 'check', disabled: st.saving }), btn(st.returnTo !== undefined ? 'Keep training' : 'Back to last set', () => { if (st.returnTo !== undefined) { const i = st.returnTo; st.returnTo = undefined; goto(i); } else undoLast(); }, { kind: 'text' }));
  }
  function drawSaved() {
    const r = st.result, nx = app.nextSession();
    body.replaceChildren(h('div', { class: 'empty' }, icon('check', 48), h('h2', {}, r.alreadyCompleted ? 'Already saved' : 'Workout saved'), h('p', {}, r.finished ? 'You completed the whole programme. Congratulations.' : nx ? `Next: Week ${nx.week}, ${nx.name} on ${prettyDate(nx.date)}.` : 'Your progress is up to date.')),
      (r.records || []).length ? h('div', { class: 'card stack' }, h('h2', {}, 'New records'), ...r.records.map((x) => h('div', { class: 'row' }, icon('trophy', 22), h('div', { class: 'grow' }, h('div', { class: 'strong' }, x.name), h('div', { class: 'small muted' }, x.records.map((q) => q.type === 'weight' ? `Heaviest: ${q.value} kg` : q.type === 'hold' ? `Longest hold: ${q.value}s` : `Estimated max: ${q.value} kg`).join(' \u00b7 ')))))) : null);
    foot.replaceChildren(btn('Done', () => app.router.navigate('/today'), { block: true }), btn('View progress', () => app.router.navigate('/progress'), { kind: 'secondary', block: true }));
    leave();
  }

  function exitSheet() {
    openSheet({ title: 'Leave workout?', center: true, content: h('p', {}, 'Your logged sets are already saved. You can pick this workout up again from Today.'), actions: [
      { label: 'Keep going', kind: 'secondary' },
      { label: 'Finish and save now', close: false, onClick: (api) => { api.close(); finishEarly(); return false; } },
      { label: 'Save and leave', close: false, onClick: (api) => { api.close(); leave(); app.router.navigate('/today'); return false; } },
      { label: 'Discard workout', kind: 'danger', close: false, onClick: async (api) => { api.close(); if (await confirmDialog({ title: 'Discard this workout?', message: 'Everything logged in this session will be lost.', confirmLabel: 'Discard', danger: true })) { leave(); await app.discardDraft(); app.router.navigate('/today'); } return false; } }] });
  }
  function overviewSheet() {
    const os = outline(plan.session);
    openSheet({ title: 'Session overview', content: h('div', { class: 'stack' }, ...os.map((o) => h('div', {}, h('h3', { class: 'strong small muted', style: { margin: '8px 0 4px' } }, o.label), list(o.rows.map((r) => item({ title: r.title, meta: r.meta, chev: false })))))), actions: [{ label: 'Close', kind: 'secondary' }] });
  }

  st.autoSay = st.phase === 'exercise'; draw();
  return { title: 'Workout', full: true, live: false, content: root, onLeave: leave };
}
