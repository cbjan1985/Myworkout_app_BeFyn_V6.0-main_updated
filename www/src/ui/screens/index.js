import { today } from './today.js';
import { calendar } from './calendar.js';
import { train, exerciseDetail, builder } from './train.js';
import { progress } from './progress.js';
import { more, preferences, data, about } from './more.js';
import { health, nutrition, recovery, reminders } from './health.js';
import { workout } from './workout.js';

/** path, name, screen, tab (nav highlight), depth (shows Back), parent (fallback for Back), full (no chrome) */
export const routes = [
  { path: '/today', name: 'today', screen: today, tab: 'today' },
  { path: '/train', name: 'train', screen: train, tab: 'train' },
  { path: '/train/exercise/:id', name: 'exercise', screen: exerciseDetail, tab: 'train', depth: 1, parent: '/train' },
  { path: '/train/builder/:id/:version', name: 'builder', screen: builder, tab: 'train', depth: 1, parent: '/train' },
  { path: '/calendar', name: 'calendar', screen: calendar, tab: 'calendar' },
  { path: '/progress', name: 'progress', screen: progress, tab: 'progress' },
  { path: '/more', name: 'more', screen: more, tab: 'more' },
  { path: '/more/health', name: 'health', screen: health, tab: 'more', depth: 1, parent: '/more' },
  { path: '/more/nutrition', name: 'nutrition', screen: nutrition, tab: 'more', depth: 1, parent: '/more' },
  { path: '/more/recovery', name: 'recovery', screen: recovery, tab: 'more', depth: 1, parent: '/more' },
  { path: '/more/reminders', name: 'reminders', screen: reminders, tab: 'more', depth: 1, parent: '/more' },
  { path: '/more/preferences', name: 'preferences', screen: preferences, tab: 'more', depth: 1, parent: '/more' },
  { path: '/more/data', name: 'data', screen: data, tab: 'more', depth: 1, parent: '/more' },
  { path: '/more/about', name: 'about', screen: about, tab: 'more', depth: 1, parent: '/more' },
  { path: '/workout', name: 'workout', screen: workout, tab: 'today', full: true },
];
