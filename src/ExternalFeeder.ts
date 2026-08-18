import { App, CachedMetadata, LinkCache, Pos, TagCache, FrontMatterCache, Loc } from "obsidian";
type FrontmatterScalar = string | number | boolean | null;
type FrontmatterValue = FrontmatterScalar | FrontmatterScalar[];

/**
 * Produces a CachedMetadata object from the active Obsidian Live Preview DOM.
 * Goal: mimic Obsidian parser output shape as closely as possible.
 */
export class ExternalFeederScanner {
  public static scanActiveView(app: App): CachedMetadata | null {
    const encryptPlugin = (app as any)?.plugins?.plugins?.["meld-encrypt"];
    if (!encryptPlugin) return null;

    const activeViewRoot = this.getActiveViewRoot();
    if (!activeViewRoot) return null;

    const links = this.extractLinks(activeViewRoot);
    const tagsFromLinks = this.extractTagsFromLinkSpans(activeViewRoot);
    const frontmatter = this.extractFrontmatter(activeViewRoot);

    // Optional: include frontmatter tags as TagCache too, for parity with index behavior
    const tagsFromFrontmatter = this.extractTagCacheFromFrontmatter(frontmatter);

    const allTags = this.mergeTagCaches(tagsFromLinks, tagsFromFrontmatter);

    const result: CachedMetadata = {
      links: links.length ? links : undefined,
      tags: allTags.length ? allTags : undefined,
      frontmatter: frontmatter ?? undefined,
      // Synthetic, because DOM has no source-file byte offsets for YAML block.
      frontmatterPosition: frontmatter ? this.syntheticFrontmatterPosition : undefined
    };

    // If completely empty, return null for caller ergonomics
    if (!result.links && !result.tags && !result.frontmatter) return null;
    return result;
  }

  // ---------------------------
  // Active root / scope
  // ---------------------------

  private static getActiveViewRoot(): HTMLElement | null {
    // Prefer active markdown source view content
    const activeLeaf = document.querySelector<HTMLElement>(".workspace-leaf.mod-active");
    if (!activeLeaf) return null;

    const sourceView = activeLeaf.querySelector<HTMLElement>(".markdown-source-view");
    if (!sourceView) return null;

    const viewContent = sourceView.querySelector<HTMLElement>(".view-content");
    return viewContent ?? sourceView;
  }

  // ---------------------------
  // Links / inline tags
  // ---------------------------

  private static extractLinks(root: HTMLElement): LinkCache[] {
    const linkElements = root.querySelectorAll<HTMLElement>("span[data-link-path]");
    const unique = new Set<string>();
    const links: LinkCache[] = [];

    linkElements.forEach((el) => {
      const path = (el.getAttribute("data-link-path") ?? "").trim();
      if (!path) return;

      // key on path+href combo for safer dedup if aliases differ
      const href = (el.getAttribute("data-link-data-href") ?? path).trim();
      const key = `${path}::${href}`;
      if (unique.has(key)) return;
      unique.add(key);

      links.push({
        link: href,
        original: `[[${href}]]`,
        position: this.syntheticFrontmatterPosition
      });
    });

    return links;
  }

  private static extractTagsFromLinkSpans(root: HTMLElement): TagCache[] {
    const linkElements = root.querySelectorAll<HTMLElement>("span[data-link-tags]");
    const tags: TagCache[] = [];
    const seen = new Set<string>();

    linkElements.forEach((el) => {
      const raw = (el.getAttribute("data-link-tags") ?? "").trim();
      if (!raw) return;

      raw.split(/\s+/).forEach((part) => {
        const normalized = this.normalizeTagForTagCache(part);
        if (!normalized) return;
        if (seen.has(normalized)) return;
        seen.add(normalized);

        tags.push({
          tag: normalized, // TagCache convention uses "#tag"
          position: this.syntheticFrontmatterPosition
        });
      });
    });

    return tags;
  }

  // ---------------------------
  // Frontmatter extraction
  // ---------------------------

private static extractFrontmatter(root: HTMLElement): FrontMatterCache | null {
  const metadataContainer = root.querySelector<HTMLElement>(".metadata-container");
  if (!metadataContainer) return null;

  const propertyNodes = metadataContainer.querySelectorAll<HTMLElement>(".metadata-property[data-property-key]");
  if (!propertyNodes.length) return null;

  // Viktig: FrontMatterCache her
  const frontmatter = {} as FrontMatterCache;
  propertyNodes.forEach((propNode) => {
    const key = (propNode.getAttribute("data-property-key") ?? "").trim();
    if (!key) return;

    const valueNode = propNode.querySelector<HTMLElement>(".metadata-property-value");
    const type = (valueNode?.getAttribute("data-property-type") ?? "").trim();

    const parsed = this.parsePropertyValue(propNode, type);
    if (parsed === undefined) return;

    if (key === "tags") {
      const normalized = this.normalizeFrontmatterTagsValue(parsed);
      if (normalized !== undefined) {
        (frontmatter as any)[key] = normalized;
      }
      return;
    }

    (frontmatter as any)[key] = parsed;
  });

  return Object.keys(frontmatter).length ? frontmatter : null;
}

  private static parsePropertyValue(propNode: HTMLElement, propertyType: string): FrontmatterValue | undefined {
    // 1) Multi-select style (tags, list, multitext)
    if (propertyType === "tags" || propertyType === "multitext") {
      const pills = Array.from(propNode.querySelectorAll<HTMLElement>(".multi-select-pill-content"))
        .map((pill) => {
          // Prefer canonical href for internal links
          const dataHref = pill.getAttribute("data-href");
          const txt = pill.textContent;
          return (dataHref ?? txt ?? "").trim();
        })
        .filter(Boolean);

      if (!pills.length) return undefined;

      if (propertyType === "tags") {
        // Return as plain strings for YAML/frontmatter realism
        return pills
          .map((t) => this.normalizeTagForFrontmatter(t))
          .filter((t): t is string => Boolean(t));
      }

      // multitext -> array of scalar strings
      return pills;
    }

    // 2) Direct input (if any)
    const input = propNode.querySelector<HTMLInputElement>(".metadata-property-value input");
    if (input) {
      const value = input.value.trim();
      if (!value) return undefined;
      return this.parseScalarOrInlineList(value);
    }

    // 3) Contenteditable field fallback
    const editable = propNode.querySelector<HTMLElement>(".metadata-property-value [contenteditable='true']");
    if (editable) {
      const value = (editable.textContent ?? "").trim();
      if (!value) return undefined;
      return this.parseScalarOrInlineList(value);
    }

    // 4) Last-resort text content
    const raw = (propNode.querySelector(".metadata-property-value")?.textContent ?? "").trim();
    if (!raw) return undefined;
    return this.parseScalarOrInlineList(raw);
  }

  private static parseScalarOrInlineList(raw: string): FrontmatterValue {
    const trimmed = raw.trim();
    const lower = trimmed.toLowerCase();

    if (lower === "true") return true;
    if (lower === "false") return false;
    if (lower === "null") return null;

    if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
      const n = Number(trimmed);
      if (!Number.isNaN(n)) return n;
    }

    // YAML-ish inline list support: [a, b, c]
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      const inner = trimmed.slice(1, -1).trim();
      if (!inner) return [];
      return inner.split(",").map((v) => v.trim());
    }

    return trimmed;
  }

  // ---------------------------
  // Tag normalization helpers
  // ---------------------------

  /** For TagCache: always "#tag" form */
  private static normalizeTagForTagCache(raw: string): string | null {
    const t = raw.trim();
    if (!t) return null;
    const bare = t.startsWith("#") ? t.slice(1) : t;
    if (!bare) return null;
    return `#${bare}`;
  }

  /** For frontmatter tags: always "tag" (no #) */
  private static normalizeTagForFrontmatter(raw: string): string | null {
    const t = raw.trim();
    if (!t) return null;
    const bare = t.startsWith("#") ? t.slice(1) : t;
    return bare || null;
  }

  private static normalizeFrontmatterTagsValue(value: FrontmatterValue): FrontmatterValue | undefined {
    if (Array.isArray(value)) {
      const normalized = value
        .map((v) => String(v))
        .map((v) => this.normalizeTagForFrontmatter(v))
        .filter((v): v is string => Boolean(v));

      if (!normalized.length) return undefined;
      return normalized;
    }

    const one = this.normalizeTagForFrontmatter(String(value));
    return one ?? undefined;
  }

  private static extractTagCacheFromFrontmatter(frontmatter: FrontMatterCache | null): TagCache[] {
    if (!frontmatter) return [];
    const tagsValue = (frontmatter as any)["tags"];
    if (tagsValue === undefined) return [];

    const seen = new Set<string>();
    const out: TagCache[] = [];

    const values = Array.isArray(tagsValue) ? tagsValue : [tagsValue];
    values.forEach((v) => {
      const tag = this.normalizeTagForTagCache(String(v));
      if (!tag) return;
      if (seen.has(tag)) return;
      seen.add(tag);

      out.push({
        tag,
        position: this.syntheticFrontmatterPosition
      });
    });

    return out;
  }

  private static mergeTagCaches(a: TagCache[], b: TagCache[]): TagCache[] {
    if (!a.length) return b;
    if (!b.length) return a;

    const seen = new Set<string>();
    const out: TagCache[] = [];

    [...a, ...b].forEach((t) => {
      if (seen.has(t.tag)) return;
      seen.add(t.tag);
      out.push(t);
    });

    return out;
  }

  // ---------------------------
  // Synthetic positions
  // ---------------------------

  private static zeroRange = { start: 0, end: 0 };

  private static loc = { line: 0, col: 0, offset: 0 };

  private static syntheticFrontmatterPosition = { start: this.loc, end: this.loc };

}