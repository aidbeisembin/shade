// Тесты выбора и хранения языка интерфейса: bun test src/shade (pnpm test).
// Окружение браузера подставляется вручную: window, sessionStorage, localStorage, document.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  LANG_DEMO_KEY,
  LANG_KEY,
  LANG_TAB_KEY,
  getLang,
  initLang,
  localeOf,
  onStorage,
  parseLang,
  resetLangForTests,
  resolveLang,
  setDemoLang,
  setLang,
  subscribeLang,
} from './lang';

class Store {
  data = new Map<string, string>();
  broken = false;
  getItem(k: string) {
    if (this.broken) throw new Error('storage disabled');
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    if (this.broken) throw new Error('storage disabled');
    this.data.set(k, v);
  }
  removeItem(k: string) {
    if (this.broken) throw new Error('storage disabled');
    this.data.delete(k);
  }
}

const g = globalThis as unknown as Record<string, unknown>;
let local: Store;
let session: Store;
let doc: { documentElement: { lang: string } };

function env(search = '') {
  g.window = { location: { search }, localStorage: local, sessionStorage: session };
}

beforeEach(() => {
  local = new Store();
  session = new Store();
  doc = { documentElement: { lang: '' } };
  g.document = doc;
  resetLangForTests('ru');
  env();
});

afterEach(() => {
  delete g.window;
  delete g.document;
});

describe('resolveLang: что поверх чего', () => {
  test('ничего не задано: русский', () => {
    expect(resolveLang({})).toBe('ru');
  });
  test('сохранённый выбор', () => {
    expect(resolveLang({ saved: 'en' })).toBe('en');
  });
  test('сценарий заглушек сильнее сохранённого', () => {
    expect(resolveLang({ demo: 'en', saved: 'ru' })).toBe('en');
  });
  test('язык вкладки сильнее сценария и сохранённого', () => {
    expect(resolveLang({ tab: 'ru', demo: 'en', saved: 'en' })).toBe('ru');
  });
  test('?lang в адресе сильнее всего', () => {
    expect(resolveLang({ url: 'en', tab: 'ru', demo: 'ru', saved: 'ru' })).toBe('en');
  });
  test('мусор в источнике пропускается, берётся следующий', () => {
    expect(resolveLang({ url: 'de', tab: '', demo: null, saved: 'en' })).toBe('en');
    expect(resolveLang({ url: 'EN', saved: 'ru' })).toBe('ru');
  });
  test('parseLang и localeOf', () => {
    expect(parseLang('ru')).toBe('ru');
    expect(parseLang('fr')).toBeNull();
    expect(localeOf('ru')).toBe('ru-RU');
    expect(localeOf('en')).toBe('en-US');
  });
});

describe('initLang на клиенте', () => {
  test('нет ничего: русский, html lang=ru остаётся', () => {
    expect(initLang()).toBe('ru');
    expect(getLang()).toBe('ru');
  });

  test('сохранённый en применяется при запуске', () => {
    local.setItem(LANG_KEY, 'en');
    expect(initLang()).toBe('en');
    expect(doc.documentElement.lang).toBe('en');
  });

  test('?lang=en поверх сохранённого ru: вкладка английская, сохранённое не тронуто', () => {
    local.setItem(LANG_KEY, 'ru');
    env('?mock=full&lang=en');
    expect(initLang()).toBe('en');
    expect(local.getItem(LANG_KEY)).toBe('ru');
    expect(session.getItem(LANG_TAB_KEY)).toBe('en');
  });

  test('?lang=ru поверх сохранённого en', () => {
    local.setItem(LANG_KEY, 'en');
    env('?lang=ru');
    expect(initLang()).toBe('ru');
    expect(local.getItem(LANG_KEY)).toBe('en');
  });

  test('переход без query (router.push теряет ?lang): язык вкладки держится', () => {
    env('?lang=en');
    initLang();
    resetLangForTests('ru');
    env('');
    expect(initLang()).toBe('en');
  });

  test('неизвестный ?lang=fr игнорируется', () => {
    local.setItem(LANG_KEY, 'en');
    env('?lang=fr');
    expect(initLang()).toBe('en');
    expect(session.getItem(LANG_TAB_KEY)).toBeNull();
  });

  test('сценарий demo-en: английский без записи в localStorage; сценарий снят: снова сохранённый', () => {
    local.setItem(LANG_KEY, 'ru');
    setDemoLang('en');
    expect(session.getItem(LANG_DEMO_KEY)).toBe('en');
    expect(initLang()).toBe('en');
    expect(local.getItem(LANG_KEY)).toBe('ru');
    setDemoLang(null);
    expect(initLang()).toBe('ru');
  });

  test('?lang=ru поверх demo-en', () => {
    setDemoLang('en');
    env('?lang=ru');
    expect(initLang()).toBe('ru');
  });
});

describe('setLang: переключатель в настройках', () => {
  test('сразу применяет язык, сохраняет выбор и ставит html lang', () => {
    setLang('en');
    expect(getLang()).toBe('en');
    expect(local.getItem(LANG_KEY)).toBe('en');
    expect(doc.documentElement.lang).toBe('en');
  });

  test('подписчики получают уведомление один раз на смену, повтор того же языка молчит', () => {
    let calls = 0;
    const off = subscribeLang(() => calls++);
    setLang('en');
    setLang('en');
    setLang('ru');
    expect(calls).toBe(2);
    off();
    setLang('en');
    expect(calls).toBe(2);
  });

  test('явный выбор сильнее ?lang вкладки: язык вкладки сбрасывается', () => {
    env('?lang=en');
    initLang();
    setLang('ru');
    expect(getLang()).toBe('ru');
    expect(session.getItem(LANG_TAB_KEY)).toBeNull();
    resetLangForTests('en');
    env('');
    expect(initLang()).toBe('ru');
  });

  test('хранилище недоступно: язык меняется в памяти, ошибок нет', () => {
    local.broken = true;
    session.broken = true;
    expect(() => setLang('en')).not.toThrow();
    expect(getLang()).toBe('en');
    expect(() => initLang()).not.toThrow();
  });
});

describe('другое окно сменило язык', () => {
  test('событие storage по ключу языка подхватывается', () => {
    local.setItem(LANG_KEY, 'en');
    onStorage({ key: LANG_KEY });
    expect(getLang()).toBe('en');
  });
  test('чужой ключ не трогает язык', () => {
    local.setItem(LANG_KEY, 'en');
    onStorage({ key: 'shade.theme' });
    expect(getLang()).toBe('ru');
  });
});
