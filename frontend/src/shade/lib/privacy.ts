// Где обрабатываются данные встречи: по провайдерам транскрипции и итогов.
// Источник: команды ядра api_get_transcript_config и api_get_model_config.

'use client';

import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { subscribe } from './tauri-events';
import { t } from '@/shade/strings';

export type PrivacyLevel = 'local' | 'cloud' | 'unknown';

export interface ProviderPrivacy {
  /** id провайдера из конфигурации ядра, null если конфиг не прочитался */
  provider: string | null;
  level: PrivacyLevel;
}

export interface PrivacyInfo {
  level: PrivacyLevel;
  transcript: ProviderPrivacy;
  summary: ProviderPrivacy;
}

/** Названия провайдеров: имена собственные, одинаковы на любом языке. */
const LABELS: Record<string, string> = {
  localWhisper: 'Whisper',
  whisper: 'Whisper',
  parakeet: 'Parakeet',
  deepgram: 'Deepgram',
  elevenLabs: 'ElevenLabs',
  groq: 'Groq',
  openai: 'OpenAI',
  ollama: 'Ollama',
  claude: 'Claude',
  openrouter: 'OpenRouter',
};

const LOCAL_TRANSCRIPT = ['localWhisper', 'whisper', 'parakeet'];
const CLOUD_TRANSCRIPT = ['deepgram', 'elevenLabs', 'groq', 'openai'];
const LOCAL_SUMMARY = ['builtin-ai'];
const CLOUD_SUMMARY = ['claude', 'groq', 'openai', 'openrouter'];

function isLocalHost(endpoint: string): boolean {
  try {
    const host = new URL(endpoint).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
  } catch {
    return false;
  }
}

/** Подпись провайдера на текущем языке. Считается при показе, а не при загрузке настроек: язык может смениться. */
export function providerLabel(p: ProviderPrivacy): string {
  if (!p.provider) return t('privacyNotSet');
  if (p.provider === 'builtin-ai') return t('privacyBuiltIn');
  if (p.provider === 'custom-openai') return t('privacyOwnServer');
  return LABELS[p.provider] ?? p.provider;
}

export function transcriptPrivacy(provider: string | null | undefined): ProviderPrivacy {
  if (!provider) return { provider: null, level: 'unknown' };
  if (LOCAL_TRANSCRIPT.includes(provider)) return { provider, level: 'local' };
  if (CLOUD_TRANSCRIPT.includes(provider)) return { provider, level: 'cloud' };
  return { provider, level: 'unknown' };
}

export function summaryPrivacy(provider: string | null | undefined, ollamaEndpoint?: string | null): ProviderPrivacy {
  if (!provider) return { provider: null, level: 'unknown' };
  if (LOCAL_SUMMARY.includes(provider)) return { provider, level: 'local' };
  if (CLOUD_SUMMARY.includes(provider)) return { provider, level: 'cloud' };
  if (provider === 'ollama') {
    // Ollama по умолчанию работает на этом компьютере; удалённый адрес уже не локально
    if (!ollamaEndpoint || isLocalHost(ollamaEndpoint)) return { provider, level: 'local' };
    return { provider, level: 'cloud' };
  }
  // custom-openai и незнакомые провайдеры: адрес сервера не проверяем, честно «неизвестно»
  return { provider, level: 'unknown' };
}

export function combinePrivacy(a: PrivacyLevel, b: PrivacyLevel): PrivacyLevel {
  if (a === 'cloud' || b === 'cloud') return 'cloud';
  if (a === 'local' && b === 'local') return 'local';
  return 'unknown';
}

interface ModelConfigResponse {
  provider?: string | null;
  ollamaEndpoint?: string | null;
}

interface TranscriptConfigResponse {
  provider?: string | null;
}

const UNKNOWN: PrivacyInfo = {
  level: 'unknown',
  transcript: transcriptPrivacy(null),
  summary: summaryPrivacy(null),
};

export function usePrivacy(): { privacy: PrivacyInfo; loading: boolean } {
  const [privacy, setPrivacy] = useState<PrivacyInfo>(UNKNOWN);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [summaryRes, transcriptRes] = await Promise.allSettled([
      invoke<ModelConfigResponse | null>('api_get_model_config'),
      invoke<TranscriptConfigResponse | null>('api_get_transcript_config'),
    ]);
    const summaryCfg = summaryRes.status === 'fulfilled' ? summaryRes.value : null;
    const transcriptCfg = transcriptRes.status === 'fulfilled' ? transcriptRes.value : null;
    const transcript = transcriptPrivacy(transcriptCfg?.provider);
    const summary = summaryPrivacy(summaryCfg?.provider, summaryCfg?.ollamaEndpoint);
    setPrivacy({ level: combinePrivacy(transcript.level, summary.level), transcript, summary });
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
    const off = subscribe('model-config-updated', () => void load());
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    return () => {
      off();
      window.removeEventListener('focus', onFocus);
    };
  }, [load]);

  return { privacy, loading };
}
