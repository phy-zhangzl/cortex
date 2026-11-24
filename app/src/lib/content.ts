/**
 * Turns arbitrary feed / extracted HTML into a small, safe, consistently formatted subset.
 *
 * Everything rendered in the reader goes through here: feed HTML is untrusted, and the
 * webview can call Tauri commands, so this is an allowlist, not a blocklist.
 */

const ALLOWED_TAGS = new Set([
  "p", "br", "hr", "h1", "h2", "h3", "h4", "h5", "h6",
  "blockquote", "pre", "code", "ul", "ol", "li", "dl", "dt", "dd",
  "strong", "b", "em", "i", "u", "s", "del", "ins", "mark", "sub", "sup", "small", "kbd",
  "a", "img", "figure", "figcaption", "picture",
  "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption",
]);

/** Removed together with everything inside. */
const DROP_TAGS = new Set([
  "script", "style", "noscript", "iframe", "frame", "frameset", "object", "embed", "applet",
  "form", "input", "button", "select", "textarea", "option", "svg", "math", "canvas",
  "link", "meta", "base", "nav", "template", "audio", "video", "source", "track", "head", "title",
]);

/** Layout wrappers: unwrapped when they contain blocks, otherwise turned into <p>. */
const CONTAINER_TAGS = new Set([
  "div", "section", "article", "main", "header", "footer", "aside", "center", "details", "summary",
]);

const BLOCK_TAGS = new Set([
  "p", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre", "ul", "ol", "dl",
  "table", "figure", "hr", "div", "section", "article", "main", "header", "footer", "aside",
]);

const ALLOWED_ATTRS: Record<string, string[]> = {
  a: ["href", "title"],
  img: ["src", "alt", "title", "width", "height"],
  td: ["colspan", "rowspan"],
  th: ["colspan", "rowspan"],
  code: ["class"], // language-xxx for highlight.js
  pre: ["class"],
};

const LAZY_SRC_ATTRS = [
  "data-src", "data-original", "data-original-src", "data-actualsrc", "data-lazy-src",
  "data-croporisrc", "data-url", "data-hi-res-src", "data-full-src",
];

/** Largest candidate of a srcset ("a.jpg 480w, b.jpg 1024w" / "a.jpg 1x, b.jpg 2x"). */
function bestFromSrcset(srcset: string | null): string | null {
  if (!srcset) return null;
  let best: { url: string; score: number } | null = null;
  for (const part of srcset.split(",")) {
    const [url, descriptor = "1x"] = part.trim().split(/\s+/);
    if (!url) continue;
    const score = Number.parseFloat(descriptor) * (descriptor.endsWith("w") ? 1 : 1000);
    if (!best || score > best.score) best = { url, score: Number.isFinite(score) ? score : 0 };
  }
  return best?.url ?? null;
}

const WECHAT_PROMO = ["关注", "公众号", "扫码", "二维码", "广告", "推广", "赞助", "点击上方", "星标", "在看"];

export interface CleanResult {
  html: string;
  toc: Array<{ id: string; text: string; level: 2 | 3 }>;
  plainText: string;
}

function safeUrl(value: string | null, baseUrl: string | undefined, allowData: boolean): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (allowData && /^data:image\/(png|jpe?g|gif|webp|avif|bmp|svg\+xml);/i.test(trimmed)) return trimmed;
  try {
    const url = baseUrl ? new URL(trimmed, baseUrl) : new URL(trimmed);
    if (url.protocol === "http:" || url.protocol === "https:" || url.protocol === "mailto:") {
      return url.toString();
    }
  } catch {
    // fall through
  }
  return null;
}

function unwrap(el: Element) {
  const parent = el.parentNode;
  if (!parent) return;
  while (el.firstChild) parent.insertBefore(el.firstChild, el);
  parent.removeChild(el);
}

function rename(el: Element, tag: string): Element {
  const replacement = el.ownerDocument.createElement(tag);
  while (el.firstChild) replacement.appendChild(el.firstChild);
  el.replaceWith(replacement);
  return replacement;
}

function hasBlockChild(el: Element) {
  return Array.from(el.children).some((child) => BLOCK_TAGS.has(child.tagName.toLowerCase()));
}

const normalize = (text: string) => text.replace(/\s+/g, "").toLowerCase();

export function cleanArticleHtml(raw: string, baseUrl?: string, title?: string): CleanResult {
  const doc = new DOMParser().parseFromString(raw, "text/html");
  const body = doc.body;

  const isWechat =
    !!baseUrl && /mp\.weixin\.qq\.com|wechat2rss/.test(baseUrl)
      ? true
      : !!doc.querySelector("#js_content, .rich_media_content");
  if (isWechat) {
    const main = doc.querySelector("#js_content, .rich_media_content");
    if (main && main.innerHTML.trim()) body.innerHTML = main.innerHTML;
  }

  body.querySelectorAll("[hidden], [style*='display:none'], [style*='display: none']").forEach((n) => n.remove());

  // <picture>: keep only the <img>, borrowing the best <source> when the img has nothing usable.
  body.querySelectorAll("picture").forEach((pic) => {
    const img = pic.querySelector("img");
    if (!img) return pic.remove();
    if (!img.getAttribute("src") && !img.getAttribute("srcset")) {
      const source = Array.from(pic.querySelectorAll("source")).map((s) => s.getAttribute("srcset")).find(Boolean);
      if (source) img.setAttribute("srcset", source);
    }
    pic.replaceWith(img);
  });
  // Lazy-loaded images, while data-* attributes still exist. A tiny data: URI src is a placeholder.
  body.querySelectorAll("img").forEach((img) => {
    const src = img.getAttribute("src") || "";
    const placeholder = !src || (src.startsWith("data:") && src.length < 2000);
    if (!placeholder) return;
    const lazy =
      LAZY_SRC_ATTRS.map((attr) => img.getAttribute(attr)).find((v) => v && !v.startsWith("data:")) ||
      bestFromSrcset(img.getAttribute("data-srcset")) ||
      bestFromSrcset(img.getAttribute("srcset"));
    if (lazy) img.setAttribute("src", lazy);
  });

  // Deepest first so containers see their already-normalized children.
  const elements = Array.from(body.querySelectorAll("*")).reverse();
  for (const el of elements) {
    if (!el.isConnected) continue;
    const tag = el.tagName.toLowerCase();

    if (DROP_TAGS.has(tag)) {
      el.remove();
      continue;
    }
    if (CONTAINER_TAGS.has(tag)) {
      if (hasBlockChild(el) || !(el.textContent || "").trim()) {
        if (!(el.textContent || "").trim() && !el.querySelector("img")) el.remove();
        else unwrap(el);
      } else {
        rename(el, "p");
      }
      continue;
    }
    if (!ALLOWED_TAGS.has(tag)) {
      unwrap(el);
      continue;
    }

    const keep = ALLOWED_ATTRS[tag] ?? [];
    for (const attr of Array.from(el.attributes)) {
      if (!keep.includes(attr.name)) el.removeAttribute(attr.name);
    }
    if (tag === "a") {
      const href = safeUrl(el.getAttribute("href"), baseUrl, false);
      if (href) el.setAttribute("href", href);
      else el.removeAttribute("href");
    } else if (tag === "img") {
      const src = safeUrl(el.getAttribute("src"), baseUrl, true);
      if (!src) {
        el.remove();
        continue;
      }
      el.setAttribute("src", src);
      el.setAttribute("loading", "lazy");
      el.setAttribute("decoding", "async");
      el.setAttribute("referrerpolicy", "no-referrer");
    } else if (tag === "code" || tag === "pre") {
      const cls = (el.getAttribute("class") || "").split(/\s+/).find((c) => /^(language|lang)-[\w+-]+$/.test(c));
      if (cls) el.setAttribute("class", cls.replace(/^lang-/, "language-"));
      else el.removeAttribute("class");
    }
  }

  // Empty blocks left over from layout wrappers.
  body.querySelectorAll("p, li, h1, h2, h3, h4, h5, h6, blockquote, figcaption").forEach((el) => {
    if (!(el.textContent || "").trim() && !el.querySelector("img, code, br")) el.remove();
  });

  if (isWechat) {
    body.querySelectorAll("p, figure, figcaption, blockquote").forEach((el) => {
      const text = normalize(el.textContent || "");
      if (text && text.length <= 80 && WECHAT_PROMO.some((k) => text.includes(k))) el.remove();
    });
    body.querySelectorAll("img").forEach((img) => {
      const hint = `${img.getAttribute("alt") || ""} ${img.getAttribute("src") || ""}`.toLowerCase();
      if (/qrcode|qr_code|logo/.test(hint)) img.remove();
    });
  }

  // Readability often repeats the article title as the first heading.
  if (title) {
    const first = body.firstElementChild;
    if (first && /^h[12]$/i.test(first.tagName) && normalize(first.textContent || "") === normalize(title)) {
      first.remove();
    }
  }

  // Small images inside running text are usually formulas / emoji.
  body.querySelectorAll("img").forEach((img) => {
    const w = Number.parseInt(img.getAttribute("width") || "", 10);
    const h = Number.parseInt(img.getAttribute("height") || "", 10);
    const small = (w > 0 && w <= 64) || (h > 0 && h <= 40);
    const hint = `${img.getAttribute("alt") || ""} ${img.getAttribute("src") || ""}`.toLowerCase();
    if (small || /latex|katex|mathjax|formula/.test(hint)) img.setAttribute("data-inline", "true");
  });

  // Heading ids for the table of contents.
  const toc: CleanResult["toc"] = [];
  const used = new Map<string, number>();
  body.querySelectorAll("h2, h3").forEach((heading, index) => {
    const text = (heading.textContent || "").trim();
    if (!text) return;
    let base = text.toLowerCase().replace(/[^a-z0-9一-鿿]+/g, "-").replace(/(^-|-$)/g, "");
    if (!base) base = `section-${index + 1}`;
    const n = used.get(base) ?? 0;
    used.set(base, n + 1);
    const id = `h-${n ? `${base}-${n + 1}` : base}`;
    heading.setAttribute("id", id);
    toc.push({ id, text, level: heading.tagName === "H3" ? 3 : 2 });
  });

  // Translatable blocks get a stable index the translation layer can target.
  let tid = 0;
  body.querySelectorAll("p, li, h1, h2, h3, h4, h5, h6, blockquote, figcaption, dt, dd, td, th").forEach((el) => {
    if (el.closest("pre")) return;
    // Only leaf-ish blocks: a <li> that wraps <p>s is handled through its <p>s.
    if (el.querySelector("p, li, blockquote, ul, ol, table, pre, h1, h2, h3, h4, h5, h6")) return;
    if (!(el.textContent || "").trim()) return;
    el.setAttribute("data-tid", String(tid++));
  });

  return { html: body.innerHTML, toc, plainText: (body.textContent || "").replace(/\s+/g, " ").trim() };
}

/** Plain text from (possibly HTML) feed excerpts for list previews. */
export function htmlToText(html: string | null | undefined, max = 200): string {
  if (!html) return "";
  const doc = new DOMParser().parseFromString(html, "text/html");
  const text = (doc.body.textContent || "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function estimateReadMinutes(text: string): number {
  const cjk = (text.match(/[㐀-鿿]/g) || []).length;
  const words = text.replace(/[㐀-鿿]/g, " ").split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(cjk / 400 + words / 220));
}
