import { api, type Article } from "./api";
import { cleanArticleHtml } from "./content";

/**
 * Saves a self-contained copy of an article: full text, cleaned, with every image
 * inlined as a data: URI. The copy outlives the feed and the original web page.
 */
export async function archiveArticle(articleId: string): Promise<{ images: number; failedImages: number }> {
  let article: Article;
  try {
    article = await api.loadFullContent(articleId);
  } catch {
    // Extraction failed (page gone / blocked): archive whatever the feed gave us.
    article = await api.getArticle(articleId);
  }
  const raw = article.content || article.summary || "";
  if (!raw.trim()) throw new Error("文章没有可保存的内容");

  const { html } = cleanArticleHtml(raw, article.url, article.title);
  const doc = new DOMParser().parseFromString(html, "text/html");
  const images = Array.from(doc.querySelectorAll("img")).filter((img) =>
    /^https?:/i.test(img.getAttribute("src") || ""),
  );

  let failedImages = 0;
  let cursor = 0;
  const worker = async () => {
    while (cursor < images.length) {
      const img = images[cursor++];
      try {
        img.setAttribute("src", await api.fetchImage(img.getAttribute("src")!));
      } catch {
        failedImages += 1;
      }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);

  await api.saveArchive(articleId, doc.body.innerHTML);
  return { images: images.length, failedImages };
}
