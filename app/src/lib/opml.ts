import type { Category, Feed, ImportItem } from "./api";

const escapeXml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function buildOpml(categories: Category[], feeds: Feed[]): string {
  const outline = (feed: Feed) =>
    `      <outline type="rss" text="${escapeXml(feed.title)}" title="${escapeXml(feed.title)}" xmlUrl="${escapeXml(
      feed.url,
    )}"${feed.site_url ? ` htmlUrl="${escapeXml(feed.site_url)}"` : ""}/>`;

  const groups = categories
    .map((category) => {
      const items = feeds.filter((f) => f.category_id === category.id);
      return `    <outline text="${escapeXml(category.name)}" title="${escapeXml(category.name)}">\n${items
        .map(outline)
        .join("\n")}\n    </outline>`;
    })
    .join("\n");
  const loose = feeds
    .filter((f) => !f.category_id || !categories.some((c) => c.id === f.category_id))
    .map((f) => outline(f).replace(/^ {6}/, "    "))
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head>
    <title>Cortex subscriptions</title>
    <dateCreated>${new Date().toUTCString()}</dateCreated>
  </head>
  <body>
${[groups, loose].filter(Boolean).join("\n")}
  </body>
</opml>
`;
}

/** Parses OPML, or the JSON backup format written by Cortex ≤ 0.2. */
export function parseSubscriptions(text: string): ImportItem[] {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    const data = JSON.parse(trimmed) as {
      feeds?: Array<{ title?: string; url?: string; site_url?: string | null; category_name?: string | null }>;
    };
    return (data.feeds ?? [])
      .filter((f) => f.url)
      .map((f) => ({
        title: f.title ?? f.url!,
        url: f.url!,
        site_url: f.site_url ?? null,
        category: f.category_name ?? null,
      }));
  }

  const doc = new DOMParser().parseFromString(trimmed, "text/xml");
  if (doc.querySelector("parsererror")) throw new Error("OPML 文件格式不正确");
  const items: ImportItem[] = [];
  doc.querySelectorAll("outline[xmlUrl]").forEach((node) => {
    const parent = node.parentElement;
    const category =
      parent && parent.tagName.toLowerCase() === "outline" && !parent.getAttribute("xmlUrl")
        ? parent.getAttribute("title") || parent.getAttribute("text")
        : null;
    items.push({
      title: node.getAttribute("title") || node.getAttribute("text") || node.getAttribute("xmlUrl")!,
      url: node.getAttribute("xmlUrl")!,
      site_url: node.getAttribute("htmlUrl"),
      category,
    });
  });
  return items;
}
