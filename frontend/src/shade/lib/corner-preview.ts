// Только в разработке: угол с карточками без настоящих событий (docs/ui/notifications.md, «Заглушки»).
//  ?corner=three   три карточки: корзина, восстановлена после сбоя, обновление;
//  ?corner=four    четыре: старшая сворачивается в стопку «+1»;
//  ?corner=trash2  две встречи в корзину подряд: одна карточка «2 встречи в корзине».
// Встречи вымышленные, «Вернуть» ничего не трогает. В сборке не работает.
'use client';

import { corner } from './corner';
import { notifyRecovered, notifyTrashed } from './corner-messages';
import { displayTitleBrief } from './format';
import { t, tf } from '@/shade/strings';

const fakeRestore = async () => undefined;

export function previewCorner(params: URLSearchParams | null): void {
  if (process.env.NODE_ENV !== 'development' || !params) return;
  const kind = params.get('corner');
  if (!kind) return;
  corner.dismiss();
  // Сроки не идут: снимки и проверка без спешки
  corner.hold('preview', true);
  const trash = (n: number) => notifyTrashed({ id: `preview-trash-${n}`, title: `Meeting 20_11_26_1${n}_14_00` }, fakeRestore);
  if (kind === 'trash2') {
    trash(1);
    trash(2);
    return;
  }
  const update = () =>
    corner.show({ id: 'preview-update', timeout: null, view: { icon: 'update', title: tf('updateAvailable', { version: '0.5.0-beta.3' }), hint: t('updateHint'), action: { label: t('updateAction'), onClick: () => undefined } } });
  const recovered = () => notifyRecovered({ meeting_id: 'preview-recovered', title: 'Meeting 16_11_26_15_02_17', duration_seconds: 1740, partial: false });
  if (kind === 'four') {
    corner.show({ timeout: null, view: { icon: 'done', title: t('restored'), hint: displayTitleBrief('Meeting 19_11_26_11_40_00') } });
  }
  trash(1);
  recovered();
  update();
}
