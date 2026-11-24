import { api, errorMessage } from "./api";

export type TranslationMode = "original" | "bilingual" | "translated";

/** True when the text is already mostly Chinese (or has nothing worth translating). */
export function isMostlyChinese(text: string): boolean {
  const cjk = (text.match(/[㐀-鿿豈-﫿]/g) || []).length;
  const latin = (text.match(/[A-Za-z]/g) || []).length;
  if (cjk + latin === 0) return true;
  return cjk / (cjk + latin / 5) > 0.5; // ~5 latin letters per word vs 1 CJK char per word
}

export function needsTranslation(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 2) return false;
  if (!/[A-Za-zÀ-ɏЀ-ӿ぀-ヿ가-힯]/.test(trimmed)) return false;
  return !isMostlyChinese(trimmed);
}

export interface TranslationJob {
  cancel: () => void;
}

/**
 * Translates blocks in document order with limited concurrency. Results are reported one by
 * one so they can be shown as soon as they arrive. The backend caches every paragraph.
 */
export function translateBlocks(
  blocks: Array<{ id: string; text: string }>,
  onResult: (id: string, result: { text: string } | { error: string }) => void,
  concurrency = 2,
): TranslationJob {
  let cancelled = false;
  let cursor = 0;

  const worker = async () => {
    while (!cancelled && cursor < blocks.length) {
      const block = blocks[cursor++];
      try {
        const text = await api.translateText(block.text);
        if (!cancelled) onResult(block.id, { text });
      } catch (error) {
        if (cancelled) return;
        const message = errorMessage(error);
        onResult(block.id, { error: message });
        // Connection / configuration problems will fail every block; stop early.
        if (/连接|模型|HTTP 404|配置/.test(message)) {
          cancelled = true;
          return;
        }
      }
    }
  };

  for (let i = 0; i < concurrency; i++) void worker();
  return { cancel: () => (cancelled = true) };
}
