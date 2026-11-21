// Знак «сведения» залитый, без круга: у Phosphor Info нарисован в круге (знак со встроенной
// подложкой, docs/ui/foundations.md, «Иконки»), а круг уже даёт карточка. Точка и скруглённая
// перекладина той же толщины, что у CheckFat и XFatIcon; цвет currentColor, размер 1em.
import type { SVGProps } from 'react';

export function InfoFatIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="1em" height="1em" viewBox="0 0 256 256" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" {...props}>
      <circle cx="128" cy="52" r="26" />
      <rect x="106" y="100" width="44" height="132" rx="22" />
    </svg>
  );
}
