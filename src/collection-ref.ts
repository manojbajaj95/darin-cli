const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Path segment after /collection/ in Darin URLs. */
const COLLECTION_PATH_RE = /\/collection\/([^/?#]+)/i;

export interface ParsedCollectionRef {
  /** Original trimmed input. */
  raw: string;
  /** True when input is a UUID. */
  isUuid: boolean;
  /**
   * API origin derived from a full collection URL, e.g.
   * `https://agentr.getdarin.com` from
   * `https://agentr.getdarin.com/collection/.../recent`.
   */
  apiUrl?: string;
  /**
   * Normalized lookup tokens derived from the input
   * (slug, urlId suffix, lowercased name, etc.).
   */
  tokens: string[];
}

/**
 * Normalize a user-provided collection reference:
 * UUID, urlId, URL slug, full URL, or display name.
 *
 * Examples:
 * - `71951192-61bf-4669-8914-257d7eff77e3`
 * - `nzkrdOW9vo`
 * - `darin-product-wiki-nzkrdOW9vo`
 * - `https://agentr.getdarin.com/collection/darin-product-wiki-nzkrdOW9vo/recent`
 * - `Darin Product Wiki`
 */
export function parseCollectionRef(input: string): ParsedCollectionRef {
  const raw = input.trim();
  if (!raw) {
    throw new Error("Collection reference is empty");
  }

  if (UUID_RE.test(raw)) {
    return { raw, isUuid: true, tokens: [raw.toLowerCase()] };
  }

  let candidate = raw;
  let apiUrl: string | undefined;

  // Full URL → extract origin + /collection/<slug>
  try {
    if (/^https?:\/\//i.test(candidate)) {
      const url = new URL(candidate);
      apiUrl = url.origin;
      const m = COLLECTION_PATH_RE.exec(url.pathname);
      if (m) candidate = decodeURIComponent(m[1]);
    } else if (candidate.startsWith("/")) {
      const m = COLLECTION_PATH_RE.exec(candidate);
      if (m) candidate = decodeURIComponent(m[1]);
    }
  } catch {
    // keep candidate as-is
  }

  // Also handle pasted path without leading slash quirks
  const embedded = COLLECTION_PATH_RE.exec(candidate);
  if (embedded) candidate = decodeURIComponent(embedded[1]);

  // Strip trailing route segments if someone pasted oddly
  // e.g. darin-product-wiki-nzkrdOW9vo/recent (without /collection/)
  if (candidate.includes("/") && !candidate.includes(" ")) {
    const parts = candidate.split("/").filter(Boolean);
    candidate = parts[0] ?? candidate;
  }

  const lower = candidate.toLowerCase();
  const tokens = new Set<string>([lower]);

  // urlId is typically the last `-` segment of the slug
  const lastDash = candidate.lastIndexOf("-");
  if (lastDash > 0 && lastDash < candidate.length - 1) {
    const maybeUrlId = candidate.slice(lastDash + 1);
    if (/^[a-zA-Z0-9]{6,}$/.test(maybeUrlId)) {
      tokens.add(maybeUrlId.toLowerCase());
    }
  }

  return { raw, isUuid: false, apiUrl, tokens: [...tokens] };
}

export interface CollectionMatchInput {
  id: string;
  urlId?: string;
  name: string;
  url?: string;
}

export function matchCollection(
  collections: CollectionMatchInput[],
  ref: ParsedCollectionRef,
): CollectionMatchInput | undefined {
  if (ref.isUuid) {
    return collections.find((c) => c.id.toLowerCase() === ref.tokens[0]);
  }

  const exact: CollectionMatchInput[] = [];
  const partial: CollectionMatchInput[] = [];

  for (const c of collections) {
    const id = c.id.toLowerCase();
    const urlId = c.urlId?.toLowerCase();
    const name = c.name.toLowerCase();
    const url = c.url?.toLowerCase() ?? "";
    const slugFromUrl = (() => {
      const m = COLLECTION_PATH_RE.exec(url);
      return m ? decodeURIComponent(m[1]).toLowerCase() : "";
    })();

    for (const token of ref.tokens) {
      if (
        id === token ||
        urlId === token ||
        name === token ||
        slugFromUrl === token ||
        (urlId && token.endsWith(urlId)) ||
        (slugFromUrl && (token === slugFromUrl || slugFromUrl.endsWith(token)))
      ) {
        exact.push(c);
        break;
      }
    }

    // Unique partial name match (e.g. "product wiki" → "Darin Product Wiki")
    for (const token of ref.tokens) {
      if (token.length >= 3 && (name.includes(token) || token.includes(name))) {
        partial.push(c);
        break;
      }
    }
  }

  const uniq = (list: CollectionMatchInput[]) => {
    const seen = new Set<string>();
    return list.filter((c) => {
      if (seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    });
  };

  const exactUniq = uniq(exact);
  if (exactUniq.length === 1) return exactUniq[0];
  if (exactUniq.length > 1) {
    throw ambiguous(ref.raw, exactUniq);
  }

  const partialUniq = uniq(partial);
  if (partialUniq.length === 1) return partialUniq[0];
  if (partialUniq.length > 1) {
    throw ambiguous(ref.raw, partialUniq);
  }

  return undefined;
}

function ambiguous(raw: string, matches: CollectionMatchInput[]): Error {
  const known = matches.map((c) => `"${c.name}" (${c.urlId ?? c.id})`).join(", ");
  return new Error(`Ambiguous collection "${raw}". Matches: ${known}`);
}

export { UUID_RE, COLLECTION_PATH_RE };
