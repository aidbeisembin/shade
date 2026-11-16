// Определяет язык интерфейса после гидратации и следит за сменой в другом окне.
// Первый проход рисуется по-русски, как статическая выгрузка (lib/lang.ts), иначе текст
// не совпал бы с разметкой с сервера; здесь язык ставится сразу после монтирования.
'use client';

import { useEffect } from 'react';
import { initLang, onStorage } from '@/shade/lib/lang';

export function LangSync() {
  useEffect(() => {
    initLang();
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  return null;
}
