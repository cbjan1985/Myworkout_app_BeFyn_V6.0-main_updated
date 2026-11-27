// Exercise Master, saved workouts and the Programme Builder.
import { uid, ok, fail, slug, clone } from '../core/util.js';
import * as Prog from '../domain/programme.js';
import { rowsFromTemplate, templateFromRows } from '../data/spreadsheet.js';
import { norm } from '../data/legacy-convert.js';

export const CATEGORIES = [['strength', 'Strength'], ['warm-up', 'Warm-up'], ['cool-down', 'Stretching'], ['yoga', 'Yoga'], ['cardio', 'Cardio'], ['breathing', 'Breathing'], ['flow', 'Guided flow']];
export const EQUIPMENT = ['bodyweight', 'dumbbells', 'bench', 'step board', 'barbell', 'bands', 'machine', 'mat'];

export function installLibrary(app) {
  const { repos } = app;
  const idx = () => app.state.exIndex;

  app.exerciseFacets = () => {
    const ex = app.state.exercises;
    const muscles = [...new Set(ex.flatMap((e) => e.primaryMuscles || []))].sort();
    return { categories: CATEGORIES, muscles, equipment: [...new Set([...EQUIPMENT, ...ex.flatMap((e) => e.equipment || [])])] };
  };
  app.searchExercises = (q = '', f = {}) => {
    const s = q.trim().toLowerCase();
    return app.state.exercises.filter((e) =>
      (!s || e.name.toLowerCase().includes(s) || (e.primaryMuscles || []).some((m) => m.toLowerCase().includes(s))) &&
      (!f.category || e.category === f.category) && (!f.difficulty || e.difficulty === f.difficulty) && (!f.muscle || (e.primaryMuscles || []).concat(e.secondaryMuscles || []).some((m) => m.toLowerCase().includes(f.muscle.toLowerCase()))) &&
      (!f.equipment || (e.equipment || []).includes(f.equipment))).sort((a, b) => a.name.localeCompare(b.name));
  };
  app.exercise = (id) => idx().get(id) || null;

  /** Creates or edits an exercise. Duplicate names are refused so the catalogue stays a single source of truth. */
  app.saveExercise = async (e) => {
    const name = (e.name || '').trim();
    if (!name) return fail('invalid', 'Give the exercise a name.');
    const dup = await repos.exercises.findDuplicate(name, e.id);
    if (dup) return fail('duplicate', `"${dup.name}" is already in your catalogue.`, { existingId: dup.id });
    const id = e.id || (idx().has(slug(name)) ? `${slug(name)}-${uid('x').slice(-4)}` : slug(name));
    const prev = idx().get(id);
    const rec = { description: '', startingPosition: '', instructions: '', breathing: '', commonMistakes: [], safetyNotes: [], variations: [], progressions: [], media: [], primaryMuscles: [], secondaryMuscles: [], equipment: ['bodyweight'], difficulty: '', category: 'strength', source: 'user', version: 1, ...prev, ...e, id, name, legacyMediaKey: (prev && prev.legacyMediaKey) || name.toLowerCase() };
    await repos.write([repos.exercises.op(rec)]); await app.refresh(); return ok({ exercise: rec });
  };
  app.archiveExercise = async (id, archived = true) => { const e = idx().get(id); if (!e) return fail('not-found', 'Exercise not found.'); await repos.write([repos.exercises.op({ ...e, archived })]); await app.refresh(); return ok(); };
  app.addExerciseLink = async (id, url) => {
    const e = idx().get(id); if (!e) return fail('not-found', 'Exercise not found.');
    if (!/^https?:\/\//i.test(url || '')) return fail('invalid', 'Enter a web link that starts with http:// or https://');
    if ((e.media || []).some((m) => m.url === url)) return ok();
    await repos.write([repos.exercises.op({ ...e, media: [...(e.media || []), { kind: 'youtube', url }] })]); await app.refresh(); return ok();
  };
  app.removeExerciseLink = async (id, url) => { const e = idx().get(id); if (!e) return fail('not-found', 'Exercise not found.'); await repos.write([repos.exercises.op({ ...e, media: (e.media || []).filter((m) => m.url !== url) })]); await app.refresh(); return ok(); };
  /** Where is this exercise used? (Shown before archiving so nothing disappears unexpectedly.) */
  app.exerciseUsage = (id) => {
    const names = new Set(); for (const t of app.state.templates) for (const s of t.sessions) for (const sec of Object.values(s.sections || {})) for (const b of sec) for (const it of b.items || [b]) if (it.exercise === id) names.add(t.name);
    return { templates: [...names], logs: app.state.logs.filter((l) => (l.performances || []).some((p) => p.exercise === id)).length };
  };

  /** Local image/GIF/video kept inside the app (no storage permission needed). One per exercise; replacing it removes the old one. */
  app.attachExerciseMedia = async (id, file) => {
    const e = idx().get(id); if (!e) return fail('not-found', 'Exercise not found.');
    if (!file) return fail('invalid', 'Choose a file.');
    const okType = /^(image|video)\//.test(file.type || '') || /\.(gif|png|jpe?g|webp|mp4|webm|mov|m4v|3gp)$/i.test(file.name || '');
    if (!okType) return fail('invalid', 'Choose an image, GIF or video file.');
    if (/svg/i.test(file.type || '') || /\.svg$/i.test(file.name || '')) return fail('invalid', 'SVG files are not accepted. Choose a PNG, JPEG, GIF, WebP or a video.');
    if (file.size > 40 * 1024 * 1024) return fail('too-big', 'That file is over 40 MB. Choose a smaller one.');
    const key = e.legacyMediaKey || e.name.toLowerCase();
    if (!(await app.platform.media.putBlob(key, file))) return fail('storage', 'The file could not be stored on this device.');
    const media = [...(e.media || []).filter((m) => m.kind !== 'file'), { kind: 'file', name: file.name, type: file.type || '', size: file.size, key }];
    await repos.write([repos.exercises.op({ ...e, legacyMediaKey: key, media })]); await app.refresh(); return ok();
  };
  app.removeExerciseMedia = async (id) => {
    const e = idx().get(id); if (!e) return fail('not-found', 'Exercise not found.');
    await app.platform.media.removeBlob(e.legacyMediaKey || e.name.toLowerCase());
    await repos.write([repos.exercises.op({ ...e, media: (e.media || []).filter((m) => m.kind !== 'file') })]); await app.refresh(); return ok();
  };

  /** A new, independent programme copied from an existing one (version 1 draft). */
  app.duplicateTemplate = async (id) => {
    const src = app.publishedTemplate(id) || app.state.templates.filter((t) => t.id === id).sort((a, b) => b.version - a.version)[0];
    if (!src) return fail('not-found', 'Programme not found.');
    const d = clone(src); d.id = uid('tpl'); d.version = 1; d.status = 'draft'; d.name = `${src.name} (copy)`; d.source = 'user'; d.createdAt = new Date().toISOString(); delete d.publishedAt; delete d.legacySignature;
    const r = await repos.templates.save(d); if (!r.ok) return r; await app.refresh(); return ok({ draft: d });
  };

  /* ---------------- saved workouts ---------------- */
  app.saveWorkout = async (w) => {
    if (!w.name?.trim()) return fail('invalid', 'Give the workout a name.');
    const prev = w.id ? app.state.workouts.find((x) => x.id === w.id) : null;
    const rec = { id: w.id || uid('wo'), category: 'custom', sections: {}, source: 'user', ...prev, ...w, name: w.name.trim() };
    await repos.write([repos.workouts.op(rec)]); await app.refresh(); return ok({ workout: rec });
  };
  app.deleteWorkout = async (id) => { await repos.write([repos.workouts.delOp(id)]); await app.refresh(); return ok(); };

  /* ---------------- programme builder ---------------- */
  app.newProgrammeDraft = async (params) => {
    const d = Prog.newDraft(params);
    const r = await repos.templates.save(d); if (!r.ok) return r; await app.refresh(); return ok({ draft: d });
  };
  app.saveTemplateDraft = async (d) => { const r = await repos.templates.save(d); if (r.ok) await app.refresh(); return r; };
  app.publishTemplate = async (id, version) => {
    const d = await repos.templates.get(id, version); if (!d) return fail('not-found', 'Programme not found.');
    const pub = Prog.publishTemplate(d, new Set(idx().keys()));
    if (!pub.ok) return pub;
    await repos.write([repos.templates.op(pub.template)]); await app.refresh(); return ok({ template: pub.template });
  };
  /** Editing a published programme creates version N+1 as a draft; the published version and any running instance stay untouched. */
  app.forkTemplate = async (id) => {
    const cur = app.publishedTemplate(id) || app.state.templates.filter((t) => t.id === id).sort((a, b) => b.version - a.version)[0];
    if (!cur) return fail('not-found', 'Programme not found.');
    const hasDraft = app.state.templates.find((t) => t.id === id && t.status === 'draft'); if (hasDraft) return ok({ draft: hasDraft, existing: true });
    const d = Prog.forkTemplate(cur); await repos.write([repos.templates.op(d)]); await app.refresh(); return ok({ draft: d });
  };
  app.deleteDraft = async (id, version) => {
    const t = await repos.templates.get(id, version); if (!t || t.status !== 'draft') return fail('not-draft', 'Only drafts can be deleted. Published programmes can be archived.');
    await repos.write([{ op: 'delete', store: 'templates', key: `${id}@${version}` }]); await app.refresh(); return ok();
  };
  app.archiveTemplate = async (id) => { await repos.templates.archive(id); await app.refresh(); return ok(); };

  /** Builds a programme from a weekly pattern, e.g. 3 training days repeated for N weeks with a rep progression. */
  app.buildFromPattern = async ({ name, objective, weeks, pattern, progression }) => {
    const sessions = Prog.expandWeeklyPattern({ weeks, pattern, progression });
    const d = Prog.newDraft({ name, objective, weeks, weeklyFrequency: pattern.length, sessions });
    return app.newProgrammeDraftFrom(d);
  };
  app.newProgrammeDraftFrom = async (d) => { const r = await repos.templates.save(d); if (!r.ok) return r; await app.refresh(); return ok({ draft: d }); };

  /* ---------------- spreadsheet mapping (SheetJS handled in dataio) ---------------- */
  app.exerciseNameIndex = () => new Map([...idx().values()].map((e) => [norm(e.name), e.id]));
  app.programmeRows = (id, version) => { const t = app.state.templates.find((x) => x.id === id && x.version === version); return t ? rowsFromTemplate(t) : null; };
  app.importRows = async (rows, { name } = {}) => {
    const r = templateFromRows(rows, { name: name || 'Imported programme', exerciseIndex: app.exerciseNameIndex() });
    if (!r.draft) return fail('invalid', r.issues[0] || 'Nothing could be imported.', { issues: r.issues });
    const known = new Set(idx().keys()); const missing = new Map();
    for (const s of r.draft.sessions) for (const sec of Object.values(s.sections)) for (const b of sec) for (const it of b.items || [b]) if (!known.has(it.exercise) && !missing.has(it.exercise)) missing.set(it.exercise, { id: it.exercise, name: it.name, category: 'strength', primaryMuscles: [], secondaryMuscles: [], equipment: ['bodyweight'], difficulty: '', description: '', startingPosition: '', instructions: '', breathing: '', commonMistakes: [], safetyNotes: [], variations: [], progressions: [], media: [], legacyMediaKey: it.name.toLowerCase(), source: 'import', version: 1 });
    await repos.write([repos.templates.op(r.draft), ...[...missing.values()].map((e) => repos.exercises.op(e))]); await app.refresh();
    return ok({ draft: r.draft, issues: r.issues, addedExercises: missing.size });
  };
}
export { clone };
