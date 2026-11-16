import { describe, expect, it } from 'bun:test';
import { classifyFailure, isBusy, missingModelName, nextPhase, type RerecPhase } from './rerecognize';

describe('«Распознать заново»: отказы и их слова', () => {
  it('модель Whisper не скачана: понятная фаза и имя модели', () => {
    const msg = 'model-missing:large-v3-turbo-q5_0';
    expect(classifyFailure(msg)).toBe('model-missing');
    expect(missingModelName(msg, 'x')).toBe('large-v3-turbo-q5_0');
    expect(missingModelName('что-то другое', 'запасное')).toBe('запасное');
  });
  it('остановлено посередине: не ошибка, прежний текст не тронут', () => {
    expect(classifyFailure('Retranscription cancelled')).toBe('stopped');
    let phase: RerecPhase = 'confirm';
    phase = nextPhase(phase, { kind: 'start' });
    phase = nextPhase(phase, { kind: 'running' });
    expect(isBusy(phase)).toBe(true);
    phase = nextPhase(phase, { kind: 'error', message: 'Retranscription cancelled' });
    expect(phase).toBe('stopped');
    expect(isBusy(phase)).toBe(false);
  });
  it('занято, пустой результат, всё остальное', () => {
    expect(classifyFailure('Retranscription already in progress')).toBe('busy');
    expect(classifyFailure('No text recognized, old transcript kept')).toBe('no-text');
    expect(classifyFailure('No speech detected in audio file')).toBe('no-text');
    expect(classifyFailure('Decode task panicked: boom')).toBe('failed');
    expect(classifyFailure(undefined)).toBe('failed');
  });
  it('скачивание модели: старт, неудача возвращает к предложению скачать, готово ведёт к распознаванию', () => {
    let phase: RerecPhase = nextPhase('confirm', { kind: 'start' });
    phase = nextPhase(phase, { kind: 'error', message: 'model-missing:m' });
    expect(phase).toBe('model-missing');
    phase = nextPhase(phase, { kind: 'download' });
    expect(phase).toBe('downloading');
    expect(nextPhase(phase, { kind: 'download-failed' })).toBe('model-missing');
    expect(nextPhase(phase, { kind: 'model-ready' })).toBe('running');
  });
  it('готово: итоговая фаза done, а событие прогресса её не откатывает', () => {
    const done = nextPhase('running', { kind: 'complete' });
    expect(done).toBe('done');
    expect(nextPhase(done, { kind: 'running' })).toBe('done');
  });
});
