import type { Article } from "./api";
import { cleanArticleHtml } from "./content";

export interface ExportFile {
  path: string;
  text?: string;
  base64?: string;
}

const EXT: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp",
  "image/avif": "avif", "image/svg+xml": "svg", "image/bmp": "bmp",
};

export function safeFileName(name: string, max = 80): string {
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().replace(/^\.+/, "");
  return (cleaned || "untitled").slice(0, max).trim();
}

const yaml = (value: string) => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/**
 * Converts an article to Markdown. Inlined (archived) images are written as separate
 * files under `assets/` so the notes stay small and portable (Obsidian etc.).
 */
export function articleToMarkdown(article: Article, baseName: string, dir = "", htmlOverride?: string): ExportFile[] {
  const source = htmlOverride ?? (article.archived_html || article.content || article.summary || "");
  const { html } = cleanArticleHtml(source, article.url, article.title);
  const prefix = dir ? `${dir}/` : "";
  const doc = new DOMParser().parseFromString(html, "text/html");
  const assets: ExportFile[] = [];

  const inline = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return (node.textContent || "").replace(/\s+/g, " ");
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const el = node as HTMLElement;
    const inner = () => Array.from(el.childNodes).map(inline).join("");
    switch (el.tagName) {
      case "STRONG":
      case "B": {
        const t = inner().trim();
        return t ? `**${t}**` : "";
      }
      case "EM":
      case "I": {
        const t = inner().trim();
        return t ? `*${t}*` : "";
      }
      case "DEL":
      case "S":
        return `~~${inner()}~~`;
      case "CODE":
        return `\`${el.textContent || ""}\``;
      case "BR":
        return "  \n";
      case "A": {
        const href = el.getAttribute("href");
        const text = inner().trim();
        return href ? `[${text || href}](${href})` : text;
      }
      case "IMG":
        return image(el);
      case "SUP":
        return `^${inner()}`;
      default:
        return inner();
    }
  };

  const image = (img: HTMLElement): string => {
    const src = img.getAttribute("src") || "";
    const alt = (img.getAttribute("alt") || "").replace(/[[\]]/g, "");
    const match = src.match(/^data:([^;]+);base64,(.*)$/);
    if (match) {
      const name = `assets/${baseName}-${assets.length + 1}.${EXT[match[1]] ?? "img"}`;
      assets.push({ path: prefix + name, base64: match[2] });
      return `![${alt}](${encodeURI(name)})`;
    }
    return src ? `![${alt}](${src})` : "";
  };

  const block = (node: Node, depth = 0): string => {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = (node.textContent || "").trim();
      return t ? `${t}\n\n` : "";
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const el = node as HTMLElement;
    const tag = el.tagName;
    if (/^H[1-6]$/.test(tag)) return `${"#".repeat(Math.min(6, Number(tag[1]) + 1))} ${inline(el).trim()}\n\n`;
    switch (tag) {
      case "P":
      case "FIGCAPTION": {
        const t = inline(el).trim();
        return t ? `${t}\n\n` : "";
      }
      case "FIGURE":
        return Array.from(el.childNodes).map((c) => block(c, depth)).join("");
      case "IMG":
        return `${image(el)}\n\n`;
      case "BLOCKQUOTE": {
        const inner = Array.from(el.childNodes).map((c) => block(c, depth)).join("").trim();
        return `${inner.split("\n").map((l) => `> ${l}`.trimEnd()).join("\n")}\n\n`;
      }
      case "PRE": {
        const lang = (el.querySelector("code")?.className.match(/language-([\w+-]+)/) ?? [])[1] ?? "";
        return `\`\`\`${lang}\n${(el.textContent || "").replace(/\n$/, "")}\n\`\`\`\n\n`;
      }
      case "UL":
      case "OL": {
        const items = Array.from(el.children).filter((c) => c.tagName === "LI");
        const lines = items.map((li, i) => {
          const marker = tag === "OL" ? `${i + 1}.` : "-";
          const parts = Array.from(li.childNodes);
          const text = parts.filter((c) => !(c instanceof HTMLElement && /^(UL|OL)$/.test(c.tagName))).map(inline).join("").trim();
          const nested = parts
            .filter((c): c is HTMLElement => c instanceof HTMLElement && /^(UL|OL)$/.test(c.tagName))
            .map((c) => block(c, depth + 1).trimEnd())
            .join("\n");
          return `${"  ".repeat(depth)}${marker} ${text}${nested ? `\n${nested}` : ""}`;
        });
        return `${lines.join("\n")}\n${depth === 0 ? "\n" : ""}`;
      }
      case "HR":
        return "---\n\n";
      case "TABLE": {
        const rows = Array.from(el.querySelectorAll("tr")).map((tr) =>
          Array.from(tr.children).map((c) => inline(c).trim().replace(/\|/g, "\\|")),
        );
        if (rows.length === 0) return "";
        const width = Math.max(...rows.map((r) => r.length));
        const pad = (r: string[]) => `| ${[...r, ...Array(width - r.length).fill("")].join(" | ")} |`;
        return `${[pad(rows[0]), pad(Array(width).fill("---")), ...rows.slice(1).map(pad)].join("\n")}\n\n`;
      }
      default:
        return Array.from(el.childNodes).map((c) => block(c, depth)).join("");
    }
  };

  const body = Array.from(doc.body.childNodes).map((n) => block(n)).join("").replace(/\n{3,}/g, "\n\n").trim();
  const meta = [
    "---",
    `title: ${yaml(article.title)}`,
    `source: ${yaml(article.feed_title ?? "")}`,
    `url: ${yaml(article.url)}`,
    article.author ? `author: ${yaml(article.author)}` : null,
    article.pub_date ? `published: ${article.pub_date.slice(0, 10)}` : null,
    `saved: ${new Date().toISOString().slice(0, 10)}`,
    "---",
  ]
    .filter(Boolean)
    .join("\n");

  const markdown = `${meta}\n\n# ${article.title}\n\n${body}\n\n---\n\n原文：<${article.url}>\n`;
  return [{ path: `${prefix}${baseName}.md`, text: markdown }, ...assets];
}

export function exportBaseName(article: Article): string {
  const date = (article.pub_date ?? new Date().toISOString()).slice(0, 10);
  return safeFileName(`${date} ${article.title}`);
}
