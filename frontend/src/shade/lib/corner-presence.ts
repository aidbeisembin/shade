// Где стоит уходящая карточка угла, пока идёт её анимация ухода (CornerStack, usePresence).
// Уходящая остаётся на своём прежнем месте: если поставить её в другое место, React перенесёт
// DOM-узел, анимация появления запустится заново и закрытая карточка «мигнёт» (так было до
// 22.11.2026: все уходящие вставали в начало стека).
export interface Presence<T> {
  entry: T;
  leaving: boolean;
}

/**
 * Живые по порядку хранилища, уходящие на своём прежнем месте среди них: сразу после
 * ближайшей карточки, которая стояла выше и ещё видна. prevIds: порядок прошлой отрисовки.
 */
export function placeLeaving<T extends { id: string }>(prevIds: string[], live: T[], gone: T[]): Array<Presence<T>> {
  const out: Array<Presence<T>> = live.map((entry) => ({ entry, leaving: false }));
  const liveIds = new Set(live.map((e) => e.id));
  const rank = (id: string) => {
    const i = prevIds.indexOf(id);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  const leaving = gone.filter((g) => !liveIds.has(g.id)).sort((a, b) => rank(a.id) - rank(b.id));
  for (const entry of leaving) {
    const at = prevIds.indexOf(entry.id);
    // Не было в прошлой отрисовке: в конец (новые и так снизу)
    let index = at < 0 ? out.length : 0;
    for (let k = at - 1; k >= 0; k--) {
      const j = out.findIndex((p) => p.entry.id === prevIds[k]);
      if (j >= 0) {
        index = j + 1;
        break;
      }
    }
    out.splice(index, 0, { entry, leaving: true });
  }
  return out;
}
