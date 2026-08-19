import { App, CachedMetadata, FrontMatterCache, LinkCache, TagCache } from "obsidian";

declare module 'obsidian' {
  interface App {
    plugins: {
      enabledPlugins: Set<string>;
      plugins: Record<string, any>;
    };
  }
}
export class ExternalFeederScanner {
  public static scanActiveView(app: App): CachedMetadata | null {
    const meldEncrypt = app.plugins?.plugins?.["meld-encrypt"];
    if (!meldEncrypt) return null;

    const root = this.getActiveSourceRoot();
    if (!root) return null;

    const frontmatter = this.extractFrontmatter(root);

    const bodyLinks = this.extractLinksFromBody(root);
    const fmLinks = this.extractLinksFromFrontmatter(frontmatter);

    const links = this.mergeLinks(bodyLinks, fmLinks);
    const tags = this.extractTagCacheFromFrontmatter(frontmatter);

    if (!links.length && !tags.length && !frontmatter) return null;

    return {
      links: links.length ? links : undefined,
      tags: tags.length ? tags : undefined,
      frontmatter: frontmatter ?? undefined,
      frontmatterPosition: this.syntheticFrontmatterPosition
    };
  }

  // ---------------------------------------------------------------------------
  // Root
  // ---------------------------------------------------------------------------

  private static getActiveSourceRoot(): HTMLElement | null {
    const activeLeaf = document.querySelector<HTMLElement>(".workspace-leaf.mod-active");
    if (activeLeaf) {
      const source = activeLeaf.querySelector<HTMLElement>(".markdown-source-view");
      if (source) return source;
    }
    return document.querySelector<HTMLElement>(".markdown-source-view");
  }

  // ---------------------------------------------------------------------------
  // Frontmatter from metadata UI
  // ---------------------------------------------------------------------------

  private static extractFrontmatter(root: HTMLElement): FrontMatterCache | null {
    const container = root.querySelector<HTMLElement>(".metadata-container");
    if (!container) return null;

    const props = container.querySelectorAll<HTMLElement>(".metadata-property[data-property-key]");
    if (!props.length) return null;

    const fm = {} as FrontMatterCache;

    props.forEach((prop) => {
      const key = (prop.getAttribute("data-property-key") ?? "").trim();
      if (!key) return;

      const valueType = (
        prop.querySelector<HTMLElement>(".metadata-property-value")?.getAttribute("data-property-type") ?? ""
      ).trim();

      const parsed = this.parsePropertyValue(prop, valueType);
      if (parsed === undefined) return;

      if (key === "tags") {
        const tags = this.toStringArray(parsed)
          .map((t) => this.normalizeFrontmatterTag(t))
          .filter((t): t is string => Boolean(t));
        if (tags.length) (fm as Record<string, unknown>)[key] = this.dedupe(tags);
        return;
      }

      if (key === "alias" || key === "aliases") {
        const aliases = this.toStringArray(parsed);
        if (aliases.length) (fm as Record<string, unknown>)["aliases"] = this.dedupe(aliases);
        return;
      }

      (fm as Record<string, unknown>)[key] = parsed;
    });

    return Object.keys(fm).length ? fm : null;
  }

  private static parsePropertyValue(prop: HTMLElement, propertyType: string): unknown {
    if (propertyType === "tags" || propertyType === "multitext") {
      const pills = Array.from(prop.querySelectorAll<HTMLElement>(".multi-select-pill-content"))
        .map((pill) => (pill.getAttribute("data-href") ?? pill.textContent ?? "").trim())
        .filter(Boolean);
      return pills.length ? pills : undefined;
    }

    const input = prop.querySelector<HTMLInputElement>(".metadata-property-value input");
    if (input?.value?.trim()) return this.parseLooseScalarOrList(input.value.trim());

    const editable = prop.querySelector<HTMLElement>(".metadata-property-value [contenteditable='true']");
    if (editable) {
      const v = (editable.textContent ?? "").trim();
      if (v) return this.parseLooseScalarOrList(v);
    }

    const raw = (prop.querySelector(".metadata-property-value")?.textContent ?? "").trim();
    if (raw) return this.parseLooseScalarOrList(raw);

    return undefined;
  }

  // ---------------------------------------------------------------------------
  // Links
  // ---------------------------------------------------------------------------

  // 1) Links from body spans
  private static extractLinksFromBody(root: HTMLElement): LinkCache[] {
    const out: LinkCache[] = [];
    const seen = new Set<string>();

    root.querySelectorAll<HTMLElement>("span[data-link-path]").forEach((el) => {
      const path = (el.getAttribute("data-link-path") ?? "").trim();
      if (!path) return;

      const href = (el.getAttribute("data-link-data-href") ?? path).trim();
      if (!href) return;

      const key = href.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);

      out.push({
        link: href,
        original: `[[${href}]]`,
        position: this.syntheticFrontmatterPosition
      });
    });

    return out;
  }

  // 2) Links inferred from frontmatter values
  private static extractLinksFromFrontmatter(frontmatter: FrontMatterCache | null): LinkCache[] {
    if (!frontmatter) return [];

    const out: LinkCache[] = [];
    const seen = new Set<string>();
    const obj = frontmatter as Record<string, unknown>;

    for (const [key, raw] of Object.entries(obj)) {
      if (raw == null) continue;

      // skip tags field - not links
      if (key === "tags") continue;

      const values = this.toStringArray(raw);
      for (const v of values) {
        const candidate = this.normalizePossibleLinkValue(v);
        if (!candidate) continue;

        const dedupeKey = candidate.toLowerCase();
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);

        out.push({
          link: candidate,
          original: `[[${candidate}]]`,
          position: this.syntheticFrontmatterPosition
        });
      }
    }

    return out;
  }

  private static mergeLinks(a: LinkCache[], b: LinkCache[]): LinkCache[] {
    const out: LinkCache[] = [];
    const seen = new Set<string>();

    [...a, ...b].forEach((link) => {
      const key = link.link.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push(link);
    });

    return out;
  }

  // ---------------------------------------------------------------------------
  // Tags from frontmatter only
  // ---------------------------------------------------------------------------

  private static extractTagCacheFromFrontmatter(frontmatter: FrontMatterCache | null): TagCache[] {
    if (!frontmatter) return [];

    const raw = (frontmatter as Record<string, unknown>)["tags"];
    if (raw == null) return [];

    const out: TagCache[] = [];
    const seen = new Set<string>();

    this.toStringArray(raw).forEach((t) => {
      const normalized = this.normalizeTagCacheTag(t);
      if (!normalized) return;
      if (seen.has(normalized)) return;
      seen.add(normalized);

      out.push({
        tag: normalized,
        position: this.syntheticFrontmatterPosition
      });
    });

    return out;
  }

  // ---------------------------
  // Synthetic positions
  // ---------------------------

  private static loc = { line: 0, col: 0, offset: 0 };

  private static syntheticFrontmatterPosition = { start: this.loc, end: this.loc };


  // ---------------------------------------------------------------------------
  // Normalizers / parsers
  // ---------------------------------------------------------------------------

  private static parseLooseScalarOrList(v: string): unknown {
    const trimmed = v.trim();
    const low = trimmed.toLowerCase();

    if (low === "true") return true;
    if (low === "false") return false;
    if (low === "null") return null;

    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      const inner = trimmed.slice(1, -1).trim();
      if (!inner) return [];
      return inner.split(",").map((x) => x.trim()).filter(Boolean);
    }

    if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
      const n = Number(trimmed);
      if (!Number.isNaN(n)) return n;
    }

    return trimmed;
  }

  private static normalizePossibleLinkValue(input: string): string | null {
    let v = input.trim();
    if (!v) return null;

    // Remove wikilink wrappers if present: [[note]] / [[note|alias]]
    if (v.startsWith("[[") && v.endsWith("]]")) {
      v = v.slice(2, -2).trim();
      const pipe = v.indexOf("|");
      if (pipe >= 0) v = v.slice(0, pipe).trim();
    }

    // reject obvious non-link scalar values
    const low = v.toLowerCase();
    if (!v || low === "true" || low === "false" || low === "null") return null;
    if (/^-?\d+(\.\d+)?$/.test(v)) return null;

    // treat hashtags as tags, not links
    if (v.startsWith("#")) return null;

    return v;
  }

  private static toStringArray(value: unknown): string[] {
    if (Array.isArray(value)) return value.map((x) => String(x).trim()).filter(Boolean);
    if (value == null) return [];
    return [String(value).trim()].filter(Boolean);
  }

  private static normalizeFrontmatterTag(tag: string): string | null {
    const t = tag.trim();
    if (!t) return null;
    return t.startsWith("#") ? (t.slice(1).trim() || null) : t;
    }

  private static normalizeTagCacheTag(tag: string): string | null {
    const bare = this.normalizeFrontmatterTag(tag);
    return bare ? `#${bare}` : null;
  }

  private static dedupe(arr: string[]): string[] {
    return Array.from(new Set(arr));
  }
}