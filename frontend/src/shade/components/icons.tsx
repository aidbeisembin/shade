// Одна толщина линий у всех значков Shade (docs/ui/foundations.md, «Иконки»): ICON_LINE = 24 из 256,
// как у Phosphor bold (шевроны, лупа): 1,875 px при 20 px, 1,5 px при 16 px.
//  - Галочка, крестик и «i» свои, линией этой толщины: у Phosphor залитые Check и X нарисованы
//    квадратом, а CheckFat (61/256) и прежние XFatIcon, InfoFatIcon (44/256) были в 2-2,5 раза толще.
//  - Залитые знаки Phosphor с тонкими линиями 16/256 (стрелки, часы, ножка микрофона, лучи солнца,
//    волны звука, ползунки) берутся отсюда: обводка 8/256 по контуру доводит линии до 24, залитые
//    части прибавляют по 4/256 с каждой стороны (0,3 px при 20 px), на глаз не меняются.
//  - Waveform в заливке нарисован на плашке (запрещено), здесь он bold: те же столбики толщиной 24.
// Цвет currentColor, размер 1em, задаёт класс, как у остальных значков Shade.
'use client';

import { forwardRef, type ReactNode, type SVGProps } from 'react';
import {
  ArrowClockwise as PhArrowClockwise,
  ArrowCounterClockwise as PhArrowCounterClockwise,
  ArrowDown as PhArrowDown,
  ArrowUpRight as PhArrowUpRight,
  ClockCounterClockwise as PhClockCounterClockwise,
  Microphone as PhMicrophone,
  MicrophoneSlash as PhMicrophoneSlash,
  SlidersHorizontal as PhSlidersHorizontal,
  SpeakerHigh as PhSpeakerHigh,
  Sun as PhSun,
  UserSound as PhUserSound,
  Waveform as PhWaveform,
  type Icon,
  type IconProps,
} from '@phosphor-icons/react';

/** Толщина линии значка в единицах сетки 256 (Phosphor bold). */
export const ICON_LINE = 24;

type LineProps = SVGProps<SVGSVGElement> & {
  /** Толщина линии в единицах сетки 256; по умолчанию ICON_LINE. Тоньше только для оптической
   *  компенсации рядом с текстом, с причиной в комментарии на месте. */
  line?: number;
};

function lineSvg(children: ReactNode, { line = ICON_LINE, ...props }: LineProps) {
  return (
    <svg
      width="1em"
      height="1em"
      viewBox="0 0 256 256"
      fill="none"
      stroke="currentColor"
      strokeWidth={line}
      strokeLinecap="round"
      strokeLinejoin="round"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

/** Галочка «готово». Рисунок Phosphor Check, линией ICON_LINE. */
export function CheckIcon(props: LineProps) {
  return lineSvg(<polyline points="40 144 96 200 224 72" />, props);
}

/** Крестик «закрыть», «отменить». Рисунок Phosphor X, линией ICON_LINE. */
export function XIcon(props: LineProps) {
  return lineSvg(<path d="M56 56 200 200M200 56 56 200" />, props);
}

/** Знак «сведения» без круга (круг даёт карточка). Перекладина ICON_LINE, точка чуть крупнее линии, как у Phosphor. */
export function InfoIcon(props: LineProps) {
  return lineSvg(
    <>
      <circle cx="128" cy="76" r="16" fill="currentColor" stroke="none" />
      <path d="M128 124v84" />
    </>,
    props,
  );
}

// Обводка поверх заливки: линии 16/256 становятся ICON_LINE
const THICKEN = { stroke: 'currentColor', strokeWidth: ICON_LINE - 16, strokeLinejoin: 'round' } as const;

function thickened(Base: Icon, name: string): Icon {
  const C = forwardRef<SVGSVGElement, IconProps>((props, ref) => <Base ref={ref} {...THICKEN} {...props} weight="fill" />);
  C.displayName = name;
  return C as Icon;
}

export const ArrowClockwise = thickened(PhArrowClockwise, 'ArrowClockwise');
export const ArrowCounterClockwise = thickened(PhArrowCounterClockwise, 'ArrowCounterClockwise');
export const ArrowDown = thickened(PhArrowDown, 'ArrowDown');
export const ArrowUpRight = thickened(PhArrowUpRight, 'ArrowUpRight');
export const ClockCounterClockwise = thickened(PhClockCounterClockwise, 'ClockCounterClockwise');
export const Microphone = thickened(PhMicrophone, 'Microphone');
export const MicrophoneSlash = thickened(PhMicrophoneSlash, 'MicrophoneSlash');
export const SlidersHorizontal = thickened(PhSlidersHorizontal, 'SlidersHorizontal');
export const SpeakerHigh = thickened(PhSpeakerHigh, 'SpeakerHigh');
export const Sun = thickened(PhSun, 'Sun');
export const UserSound = thickened(PhUserSound, 'UserSound');

const WaveformBold = forwardRef<SVGSVGElement, IconProps>((props, ref) => <PhWaveform ref={ref} {...props} weight="bold" />);
WaveformBold.displayName = 'Waveform';
export const Waveform = WaveformBold as Icon;

/** Имена, которые в слое Shade берутся только отсюда (страж lib/icons-guard.test.ts). */
export const LINE_FIXED = [
  'Check',
  'CheckFat',
  'X',
  'ArrowClockwise',
  'ArrowCounterClockwise',
  'ArrowDown',
  'ArrowUpRight',
  'ClockCounterClockwise',
  'Microphone',
  'MicrophoneSlash',
  'SlidersHorizontal',
  'SpeakerHigh',
  'Sun',
  'UserSound',
  'Waveform',
] as const;
