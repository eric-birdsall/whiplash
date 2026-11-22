const KEY = 'whiplash.save.v1';

export interface Best { deaths: number; time: number; }
export interface Save { unlocked: number; best: Record<number, Best>; }

export function loadSave(): Save {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || '');
    if (typeof s.unlocked === 'number') return { unlocked: s.unlocked, best: s.best || {} };
  } catch { /* fresh save */ }
  return { unlocked: 0, best: {} };
}

export function recordWin(save: Save, level: number, deaths: number, time: number, total: number) {
  save.unlocked = Math.min(total - 1, Math.max(save.unlocked, level + 1));
  const b = save.best[level];
  if (!b || time < b.time) save.best[level] = { deaths, time };
  localStorage.setItem(KEY, JSON.stringify(save));
}
