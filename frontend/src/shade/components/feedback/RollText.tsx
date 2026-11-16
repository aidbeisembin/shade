// Текст, который перекатывается при смене: старый уезжает и гаснет, новый въезжает с другой стороны
// на пружине LABEL_ROLL (260 / 22). Подпись под звёздами и заголовок карточки отзыва. Направление
// задаёт dir: 1 вверх (оценка выросла, шаг вперёд), -1 вниз. Прервали посреди хода (указатель бежит
// по звёздам): уходящим становится текст, который въезжал, новый начинает ход с начала; подпись
// короткая, скачок в долю строки глазом не виден, зато текст под указателем всегда последний.
// Reduced motion: смена сразу. Для чтения с экрана виден только новый текст (старый aria-hidden).
'use client';

import * as React from 'react';
import { spring } from '@/shade/lib/motion/spring';
import { LABEL_ROLL } from '@/shade/lib/motion/shade-springs';
import { cn } from '@/shade/lib/utils';

const useIsoLayoutEffect = typeof window === 'undefined' ? React.useEffect : React.useLayoutEffect;

export function RollText({
  text,
  dir,
  className,
  as: Tag = 'span',
  id,
}: {
  text: string;
  dir?: 1 | -1;
  className?: string;
  as?: 'span' | 'p' | 'h2';
  id?: string;
}) {
  const [shown, setShown] = React.useState({
    cur: text,
    prev: null as string | null,
    dir: 1 as 1 | -1,
  });
  const curRef = React.useRef<HTMLSpanElement>(null);
  const prevRef = React.useRef<HTMLSpanElement>(null);
  const dirRef = React.useRef<1 | -1>(1);

  const [s] = React.useState(() =>
    spring(1, {
      ...LABEL_ROLL,
      onUpdate: (p) => {
        const d = dirRef.current;
        const q = Math.max(0, Math.min(1, p));
        if (curRef.current) {
          curRef.current.style.transform = `translateY(${((1 - p) * d * 100).toFixed(2)}%)`;
          curRef.current.style.opacity = q.toFixed(3);
        }
        if (prevRef.current) {
          prevRef.current.style.transform = `translateY(${(-p * d * 100).toFixed(2)}%)`;
          prevRef.current.style.opacity = (1 - q).toFixed(3);
        }
      },
      onRest: () => setShown((v) => (v.prev === null ? v : { ...v, prev: null })),
    }),
  );

  if (text !== shown.cur) {
    // Смена во время рендера (без лишнего кадра со старым текстом)
    setShown({ cur: text, prev: shown.cur, dir: dir ?? 1 });
  }

  useIsoLayoutEffect(() => {
    if (shown.prev === null) return;
    dirRef.current = shown.dir;
    s.set(0);
    s.to(1);
  }, [shown.cur]);

  React.useEffect(() => () => s.stop(), [s]);

  return (
    <Tag id={id} className={cn('relative block overflow-hidden', className)}>
      {shown.prev !== null && (
        <span ref={prevRef} aria-hidden className="absolute inset-x-0 top-0 block truncate">
          {shown.prev}
        </span>
      )}
      <span ref={curRef} className="block truncate">
        {shown.cur}
      </span>
    </Tag>
  );
}
