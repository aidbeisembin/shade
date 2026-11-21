// Крестик залитый: у Phosphor X в заливке нарисован квадратом с вырезом, «толстого» варианта
// (как CheckFat у галочки) нет. Две скруглённые перекладины той же толщины, что у CheckFat;
// цвет currentColor, размер задаёт класс, по умолчанию 1em как у иконок Shade (ShadeIcons).
import type { SVGProps } from 'react';

export function XFatIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="1em" height="1em" viewBox="0 0 256 256" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" {...props}>
      <rect x="20" y="106" width="216" height="44" rx="22" transform="rotate(45 128 128)" />
      <rect x="20" y="106" width="216" height="44" rx="22" transform="rotate(-45 128 128)" />
    </svg>
  );
}
