// Автообновление (lib/updates.ts): случаи из таблицы PR открытой беты.
import { describe, expect, test } from 'bun:test';
import { scheduleChecks, UpdateController, type UpdateDeps, type UpdateHandle } from './updates';

function handle(version = '0.5.0-beta.2', opts: { download?: () => Promise<void>; install?: () => Promise<void> } = {}) {
  const calls = { download: 0, install: 0 };
  const h: UpdateHandle = {
    version,
    download: async () => {
      calls.download++;
      await opts.download?.();
    },
    install: async () => {
      calls.install++;
      await opts.install?.();
    },
  };
  return { h, calls };
}

function deps(over: Partial<UpdateDeps> = {}) {
  const calls = { check: 0, relaunch: 0, logs: [] as string[] };
  const d: UpdateDeps = {
    check: async () => null,
    isRecording: async () => false,
    relaunch: async () => {
      calls.relaunch++;
    },
    log: (m) => calls.logs.push(m),
    ...over,
  };
  const check = d.check;
  d.check = async () => {
    calls.check++;
    return check();
  };
  return { d, calls };
}

describe('проверка', () => {
  test('нет сети при проверке: тихо пропущено, карточки нет', async () => {
    const { d, calls } = deps({ check: async () => Promise.reject(new Error('error sending request')) });
    const c = new UpdateController(d);
    expect(await c.check()).toBe('skipped');
    expect(c.getPhase()).toEqual({ kind: 'idle' });
    expect(c.visible()).toBe(false);
    expect(calls.logs[0]).toContain('skipped');
  });

  test('обновлений нет: ничего не показываем', async () => {
    const c = new UpdateController(deps().d);
    expect(await c.check()).toBe('none');
    expect(c.visible()).toBe(false);
  });

  test('новая версия: скачана и проверена, потом карточка «Доступна версия X»', async () => {
    const u = handle();
    const c = new UpdateController(deps({ check: async () => u.h }).d);
    expect(await c.check()).toBe('ready');
    expect(u.calls.download).toBe(1);
    expect(u.calls.install).toBe(0); // сам не ставит
    expect(c.getPhase()).toEqual({ kind: 'ready', version: '0.5.0-beta.2' });
    expect(c.visible()).toBe(true);
  });

  test('битая подпись latest.json: download отклонён ядром, тихо пропущено, карточки нет', async () => {
    const u = handle('0.5.0-beta.2', { download: async () => Promise.reject(new Error('signature verification failed')) });
    const { d, calls } = deps({ check: async () => u.h });
    const c = new UpdateController(d);
    expect(await c.check()).toBe('skipped');
    expect(c.getPhase()).toEqual({ kind: 'idle' });
    expect(c.visible()).toBe(false);
    expect(calls.logs[0]).toContain('signature');
  });

  test('проверки не идут вдвоём', async () => {
    let release!: () => void;
    const u = handle();
    const c = new UpdateController(deps({ check: () => new Promise((r) => (release = () => r(u.h))) }).d);
    const first = c.check();
    expect(await c.check()).toBe('busy');
    release();
    expect(await first).toBe('ready');
  });
});

describe('запись', () => {
  test('во время записи не проверяем и не качаем; после записи проверка сразу', async () => {
    const u = handle();
    const { d, calls } = deps({ check: async () => u.h });
    const c = new UpdateController(d);
    c.setRecording(true);
    expect(await c.check()).toBe('deferred');
    expect(calls.check).toBe(0);
    expect(u.calls.download).toBe(0);
    c.setRecording(false);
    await new Promise((r) => setTimeout(r, 0));
    expect(calls.check).toBe(1);
    expect(c.getPhase().kind).toBe('ready');
  });

  test('запись началась, пока ждали ответа: не качаем, откладываем', async () => {
    const u = handle();
    let c!: UpdateController;
    c = new UpdateController(
      deps({
        check: async () => {
          c.setRecording(true);
          return u.h;
        },
      }).d,
    );
    expect(await c.check()).toBe('deferred');
    expect(u.calls.download).toBe(0);
  });

  test('обновление во время записи: карточка спрятана, «Обновить» не ставит', async () => {
    const u = handle();
    const c = new UpdateController(deps({ check: async () => u.h }).d);
    await c.check();
    c.setRecording(true);
    expect(c.visible()).toBe(false);
    expect(await c.install()).toBe('blocked');
    expect(u.calls.install).toBe(0);
    c.setRecording(false);
    expect(c.visible()).toBe(true);
  });

  test('ядро говорит, что запись идёт (интерфейс не успел): не ставим', async () => {
    const u = handle();
    const c = new UpdateController(deps({ check: async () => u.h, isRecording: async () => true }).d);
    await c.check();
    expect(await c.install()).toBe('blocked');
    expect(u.calls.install).toBe(0);
    expect(c.getPhase().kind).toBe('ready');
  });

  test('ядро не ответило про запись: не ставим', async () => {
    const u = handle();
    const c = new UpdateController(deps({ check: async () => u.h, isRecording: async () => Promise.reject(new Error('ipc')) }).d);
    await c.check();
    expect(await c.install()).toBe('blocked');
    expect(u.calls.install).toBe(0);
  });
});

describe('установка', () => {
  test('«Обновить»: ставит и перезапускает', async () => {
    const u = handle();
    const { d, calls } = deps({ check: async () => u.h });
    const c = new UpdateController(d);
    await c.check();
    expect(await c.install()).toBe('installed');
    expect(u.calls.install).toBe(1);
    expect(calls.relaunch).toBe(1);
  });

  test('установка не удалась: «Не получилось обновить», без перезапуска; крестик убирает', async () => {
    const u = handle('0.5.0-beta.2', { install: async () => Promise.reject(new Error('Permission denied')) });
    const { d, calls } = deps({ check: async () => u.h });
    const c = new UpdateController(d);
    await c.check();
    expect(await c.install()).toBe('failed');
    expect(calls.relaunch).toBe(0);
    expect(c.getPhase()).toEqual({ kind: 'failed', version: '0.5.0-beta.2' });
    expect(c.visible()).toBe(true);
    c.dismiss();
    expect(c.visible()).toBe(false);
  });

  test('крестик: эта версия до следующего запуска не показывается, не ставится сама', async () => {
    const u = handle();
    const c = new UpdateController(deps({ check: async () => u.h }).d);
    await c.check();
    c.dismiss();
    expect(c.visible()).toBe(false);
    expect(await c.check()).toBe('ready'); // повторная проверка не качает заново
    expect(u.calls.download).toBe(1);
    expect(c.visible()).toBe(false);
  });

  test('без готового обновления установка ничего не делает', async () => {
    const c = new UpdateController(deps().d);
    expect(await c.install()).toBe('nothing');
  });
});

describe('расписание', () => {
  test('первая проверка после задержки, дальше по интервалу; отмена останавливает', async () => {
    let n = 0;
    const stop = scheduleChecks(() => n++, 5, 10);
    expect(n).toBe(0);
    await new Promise((r) => setTimeout(r, 40));
    stop();
    const seen = n;
    expect(seen).toBeGreaterThanOrEqual(2);
    await new Promise((r) => setTimeout(r, 30));
    expect(n).toBe(seen);
  });

  test('интервал по умолчанию раз в сутки', async () => {
    const { CHECK_INTERVAL_MS } = await import('./updates');
    expect(CHECK_INTERVAL_MS).toBe(86_400_000);
  });
});
