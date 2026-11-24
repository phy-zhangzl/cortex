import { api, type Article } from "./api";
import { cleanArticleHtml } from "./content";

/**
 * Downloads every remote image in `html` and inlines it as a data: URI.
 * Images that can't be fetched keep their remote URL.
 */
export async function inlineImages(html: string, referer: string | null): Promise<{ html: string; images: number; failed: number }> {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const images = Array.from(doc.querySelectorAll("img")).filter((img) => /^https?:/i.test(img.getAttribute("src") || ""));
  const cache = new Map<string, Promise<string>>();
  let failed = 0;
  let cursor = 0;
  const worker = async () => {
    while (cursor < images.length) {
      const img = images[cursor++];
      const src = img.getAttribute("src")!;
      if (!cache.has(src)) cache.set(src, api.fetchImage(src, referer));
      try {
        img.setAttribute("src", await cache.get(src)!);
      } catch {
        failed += 1;
      }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  return { html: doc.body.innerHTML, images: images.length, failed };
}

/** Full text of an article (extracting the page if needed); falls back to what the feed gave. */
export async function loadBestContent(articleId: string): Promise<Article> {
  try {
    return await api.loadFullContent(articleId);
  } catch {
    return api.getArticle(articleId);
  }
}

/**
 * Saves a self-contained copy of an article: full text, cleaned, with every image
 * inlined. The copy outlives the feed and the original web page.
 */
export async function archiveArticle(articleId: string): Promise<{ images: number; failedImages: number }> {
  const article = await loadBestContent(articleId);
  const raw = article.content || article.summary || "";
  if (!raw.trim()) throw new Error("文章没有可保存的内容");
  const { html } = cleanArticleHtml(raw, article.url, article.title);
  const result = await inlineImages(html, article.url);
  await api.saveArchive(articleId, result.html);
  return { images: result.images, failedImages: result.failed };
}
