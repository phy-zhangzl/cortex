import { useState } from "react";
import type { Feed } from "@/lib/api";

function faviconUrl(feed: Pick<Feed, "site_url" | "url">): string | null {
  try {
    return `${new URL(feed.site_url || feed.url).origin}/favicon.ico`;
  } catch {
    return null;
  }
}

export function FeedIcon({ feed, size = 16 }: { feed: Pick<Feed, "site_url" | "url" | "title">; size?: number }) {
  const [failed, setFailed] = useState(false);
  const src = faviconUrl(feed);
  if (!src || failed) {
    return (
      <span
        className="inline-flex shrink-0 items-center justify-center rounded bg-muted text-[9px] font-semibold uppercase text-muted-foreground"
        style={{ width: size, height: size }}
      >
        {feed.title.trim().charAt(0) || "?"}
      </span>
    );
  }
  return (
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      referrerPolicy="no-referrer"
      className="shrink-0 rounded-sm"
      onError={() => setFailed(true)}
    />
  );
}
