import { h } from '../dom.js';
import { openSheet, toast } from '../dom.js';
import { btn, card, field, input, select, list, item, pill, banner } from '../components.js';
import { icon } from '../icons.js';
import { openMissedSheet } from '../sheets.js';
import { openProgrammeSheet } from './train.js';
import { prettyDate } from '../../core/util.js';

const GOALS = [['build', 'Build muscle'], ['strength', 'Get stronger'], ['fit', 'Stay fit and healthy'], ['mobility', 'Mobility and calm'], ['', 'Not sure yet']];

/** First-use flow for brand-new installs. Skippable at every step; nothing is required to use BeFyn. */
export async function maybeOnboard(app) {
  const s = app.state; if (s.prefs.profile?.onboarded || s.programme || s.logs.length) return;
  let step = 0; const name = input({ placeholder: 'Optional', maxlength: 40, autocomplete: 'given-name' }), goal = select(GOALS, '');
  const sheet = openSheet({ title: 'Welcome to BeFyn', content: '', actions: [] });
  const finish = async () => { await app.setPref('profile', { name: name.value.trim(), goal: goal.value, onboarded: true }); sheet.close(); };
  const draw = () => {
    if (step === 0) { sheet.setContent(h('div', { class: 'stack' }, h('p', {}, 'Train with a programme that adapts to real life. Miss a week and your plan waits for you, so you never fall behind.'), h('ul', { style: { paddingLeft: '20px', margin: 0 } }, h('li', {}, 'Everything stays on your phone.'), h('li', {}, 'Optional connections, such as Health Connect, only when you choose.'), h('li', {}, 'You can skip anything and change it later.')))); sheet.setActions([{ label: 'Skip', kind: 'secondary', close: false, onClick: async () => { await finish(); return false; } }, { label: 'Get started', close: false, onClick: () => { step = 1; draw(); return false; } }]); }
    else if (step === 1) { sheet.setContent(h('div', { class: 'stack' }, field('What should we call you?', name), field('Your main goal', goal), h('p', { class: 'small muted' }, 'Both optional. They only personalise wording on this phone.'))); sheet.setActions([{ label: 'Back', kind: 'secondary', close: false, onClick: () => { step = 0; draw(); return false; } }, { label: 'Next', close: false, onClick: () => { step = 2; draw(); return false; } }]); }
    else { const tpls = app.latestTemplates().filter((t) => t.status === 'published'); sheet.setContent(h('div', { class: 'stack' }, h('p', {}, 'Pick a programme to start, or build your own later in Train.'), list(tpls.map((t) => item({ title: t.name, meta: `${t.weeks} weeks`, lead: 'train', onClick: async () => { await finish(); openProgrammeSheet(app, t); } }))))); sheet.setActions([{ label: 'Back', kind: 'secondary', close: false, onClick: () => { step = 1; draw(); return false; } }, { label: 'Not now', close: false, onClick: async () => { await finish(); toast('You can start a programme any time in Train.'); return false; } }]); }
  };
  draw();
}

/** One-time summary after a V5.0 -> V6.0 upgrade. Says plainly what moved and what needs a decision. */
export async function showUpgradeSummary(app, mig) {
  const r = mig.report, st = app.scheduleStatus(); const missed = st?.missed.length || 0;
  const sheet = openSheet({ title: 'Welcome to BeFyn', content: h('div', { class: 'stack' }, h('p', {}, 'Your V5.0 data moved over safely. A backup of the original was saved first.'), list([item({ title: `${r.sessionLogs} workouts and ${r.sets} sets`, meta: 'Your history', chev: false, lead: 'check' }), item({ title: r.programme === 'edited' ? 'Your edited programme' : '8-week programme', meta: `${r.sessionsCompleted} of ${r.scheduledSessions} sessions marked done`, chev: false, lead: 'train' }), r.savedWorkouts ? item({ title: `${r.savedWorkouts} saved workouts`, meta: 'In Train > Workouts', chev: false, lead: 'list' }) : null]), mig.warnings?.length ? banner(mig.warnings.join(' '), { kind: 'info' }) : null, missed ? banner([h('strong', {}, `${missed} sessions are waiting. `), 'Your programme has not moved on without you. Choose how to carry on.'], { icon: 'info' }) : null, app.legacyVaultPresent() ? banner('Your protected health records from V5.0 are still locked. Import them in More > Health when you are ready.', { kind: 'info', icon: 'lock' }) : null), actions: [missed && { label: 'Choose how to continue', close: false, onClick: (api) => { api.close(); openMissedSheet(app, () => app.refresh()); return false; } }, { label: missed ? 'Later' : 'Continue', kind: missed ? 'secondary' : '' }].filter(Boolean), onClose: () => app.setPref('profile', { ...app.state.prefs.profile, onboarded: true }) });
}
