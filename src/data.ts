import { BasesEntry, MetadataCache, parseFrontMatterAliases, parseFrontMatterTags, TFile, Vault } from "obsidian";
import RelatednotesPlugin from "./main.js";
import { updateMessage } from "./view.js";

type Notetype = "file" | "other";
export type Relation = "center" | "parent" | "child" | "friend"| "sibling" | "undefined" | "ignored";
export type Direction = "up" | "down" | "left" | "right";

const relationOrder: Record<Relation, number> = {
  "center": 0,
  "parent": 1,
  "child": 2,
  "friend": 3,
  "sibling": 4,
  "undefined": 5,
  "ignored": 6,
}

const DEFAULT_GATE: Gate = {
  direction: undefined,
  svg: undefined,
  connections: [],
  unspecified: []
}

export interface RelatedNoteGroup {
	key: string;
	isDefined: boolean;
	entries: BasesEntry[];
}

export interface Gate {
	direction: Direction | undefined;
	svg: SVGSVGElement | undefined;
	connections: NoteProperties[];
	unspecified: NoteProperties[];
};

export interface NoteProperties {
  filename: string;
  basename: string;
  aliases?: string[];
  tags?: string[];
  properties: [string, any][];
  connectionCount: number;
  sharedLinksWithStart: number;
  degree: 'zero' | 'first' | 'second';
  file: TFile;
  type?: Notetype;
	relation?: Relation;
	div?: HTMLElement;
	info?: string;
	ignored?: NoteProperties[];
	upperGate?: Gate;
	lowerGate?: Gate;
	friendGate?: Gate;
}

export interface GroupedNotes {
  tag: string;
  notes: NoteProperties[];
}

interface GateGroups {
  connections: GroupedNotes[];
  unspecified: GroupedNotes[];
}

export class RelatedData {
  private readonly displayAliases;
  private readonly parentProperties;
  private readonly parentTags;
  private readonly childProperties;
  private readonly childTags;
  private readonly friendProperties;
  private readonly friendTags;
  private readonly ignoreFragments;
  private readonly ignoreTags;
    // Main cache
  private noteCache = new Map<string, NoteProperties>(); // basename → note. Source of truth.

  centerNote: NoteProperties | undefined;
  siblings: NoteProperties[] = [];

  mostRecentActiveFile: TFile | null = null;

  constructor(
    private app: {
      workspace: any; metadataCache: MetadataCache; vault: Vault},
      public plugin: RelatednotesPlugin,
      private callback: (callId: updateMessage) => void
  ) {
      this.displayAliases = this.plugin.settings!.displayAliases;
      this.parentProperties = this.itemsOf(this.plugin.settings!.parentProperties);
      this.parentTags = this.itemsOf(this.plugin.settings!.parentTags);
      this.childProperties = this.itemsOf(this.plugin.settings!.childProperties);
      this.childTags = this.itemsOf(this.plugin.settings!.childTags);
      this.friendProperties = this.itemsOf(this.plugin.settings!.friendProperties);
      this.friendTags = this.itemsOf(this.plugin.settings!.friendTags);
      this.ignoreFragments = this.itemsOf(this.plugin.settings!.ignoreNameFragments);
      this.ignoreTags = this.itemsOf(this.plugin.settings!.ignoreTags);
  }

  async update(activeFile: TFile | null) {
    if (!activeFile) return;

    this.mostRecentActiveFile = activeFile;

    // Clear previous data
    this.siblings.length = 0;
    this.noteCache.clear();

    // Create center note
    this.centerNote = this.getNoteProperties(activeFile, 'center');
    this.noteCache.set(this.centerNote.basename, this.centerNote);

    // Process all related notes
    await this.updateNotesRelatedTo(this.centerNote!, 'center');
    
    await this.buildSiblingNotes();

    this.callback('dataModelReady');
}

    // Helper method (recommended)
  getFirstTag(note: NoteProperties): string | undefined {
    if (!note.tags) return undefined;
    if (Array.isArray(note.tags)) {
        return note.tags[0];                    // first tag
    }
    if (typeof note.tags === 'string') {
        return note.tags;
    }
    return undefined;
  }

  // ===================== Update notestree data =====================
  
  private setCenterNoteRelation(
    centerNote: NoteProperties, 
    newNote: NoteProperties
  ){
    switch (newNote.relation) {
      case "ignored":
        centerNote.ignored!.push(newNote) ;
        break;
      case "parent": 
        newNote.lowerGate!.connections = [centerNote];
        centerNote.upperGate!.connections.push(newNote); 
        break;
      case "child": 
        newNote.upperGate!.connections = [centerNote];
        centerNote.lowerGate!.connections.push(newNote); 
        break;
        case "friend": 
        newNote.friendGate!.connections = [centerNote];
        newNote.friendGate!.direction = 'right';
        centerNote.friendGate!.connections.push(newNote); 
        break;
      default: 
        newNote.upperGate!.connections = [centerNote];
        centerNote.lowerGate!.unspecified.push(newNote); break;
    }
  };

  private async buildSiblingNotes() {
    const parents = this.getNotesByRelationFromCache('parent');

    for (const parent of parents) {
        await this.updateNotesRelatedTo(parent, "parent");
    }

    this.siblings = this.getNotesByRelationFromCache('sibling');
}

  private async updateNotesRelatedTo(primaryNote: NoteProperties, relation: Relation) {
    const secondaries = await this.getSecondariesFrom(primaryNote);

    for (const secondaryNote of secondaries) {
        if (this.noteCache.has(secondaryNote.basename)) continue;

        secondaryNote.relation = this.findRelation(primaryNote, secondaryNote);

        if (relation === 'parent') {
            this.setSiblingNoteRelation(primaryNote, secondaryNote);
        } else if (relation === 'center') {
            this.setCenterNoteRelation(primaryNote, secondaryNote);
        }

        this.noteCache.set(secondaryNote.basename, secondaryNote);
    }
}

  /** All notes of a specific relation */
  getNotesByRelationFromCache(relation: Relation): NoteProperties[] {
    return Array.from(this.noteCache.values())
      .filter(note => note.relation === relation);
  }

  private setSiblingNoteRelation(
    primaryNote: NoteProperties, 
    newNote: NoteProperties
  ) {
      if (this.noteCache.has(newNote.basename)) return;

      this.noteCache.set(newNote.basename, newNote);

      if (newNote.relation! == 'ignored') {
        primaryNote.ignored!.push(newNote);
        return;
      }

      if (!['child', 'undefined'].includes(newNote.relation!)) {
        return;
      }
      
      newNote.relation = 'sibling';
      this.noteCache.set(newNote.basename!, newNote);
      
      newNote.upperGate!.connections = [primaryNote];
      primaryNote.lowerGate?.connections.push(newNote);
  }

  private async getSecondariesFrom(primaryNote: NoteProperties): Promise<NoteProperties[]> {
    const filesSet = await this.getFirstDegreeFiles(primaryNote.file);

    const secondaries: NoteProperties[] = [];

    for (const file of filesSet) {
        if (file.path === primaryNote.file.path) continue; // skip self

        const noteProps = this.getNoteProperties(file, 'undefined');
        secondaries.push(noteProps);
    }

    // Sort: first by tag, then by connection count
    return secondaries.sort((a, b) => {
        const tagA = this.getFirstTag(a);
        const tagB = this.getFirstTag(b);

        if (tagA !== tagB) {
            if (!tagA) return 1;
            if (!tagB) return -1;
            return tagA.localeCompare(tagB);
        }
        return (b.connectionCount ?? 0) - (a.connectionCount ?? 0);
    });
}

  // ===================== helper functions =====================

  /**
   * Helper to safely get backlinks, with optional Backlink Cache plugin support.
   * Returns a Set of all files that link to the given file (incoming backlinks).
   */
  private async getIncomingBacklinks(file: TFile): Promise<Set<TFile>> {
    const backlinkSources = new Set<TFile>();

    // 1. Primary method: getBacklinks (async)
    const backlinks = await this.getBacklinks(file);

    if (backlinks?.data) {
        for (const sourcePath of Object.keys(backlinks.data)) {
            const sourceFile = this.app.vault.getFileByPath(sourcePath);
            if (sourceFile) {
                backlinkSources.add(sourceFile);
            }
        }
    }

    // 2. Backup method using resolvedLinks (catches more cases)
    const resolvedLinks = this.app.metadataCache.resolvedLinks;
    for (const [sourcePath, links] of Object.entries(resolvedLinks)) {
        if (links[file.path] && sourcePath !== file.path) {
            const sourceFile = this.app.vault.getFileByPath(sourcePath);
            if (sourceFile) {
                backlinkSources.add(sourceFile);
            }
        }
    }

    // Remove self-references if any
    backlinkSources.delete(file);

    return backlinkSources;
  }


  private async getBacklinks(file: TFile): Promise<any> {
    const mc = this.app.metadataCache;

    // Safer readiness check (avoids TS error)
    const isReady = (mc as any).initialized === true || 
                    Object.keys(mc.resolvedLinks ?? {}).length > 0;

    if (!isReady) {
        await this.waitForResolvedLinks();
    }

    // 1. Best: Backlink Cache plugin (if installed)
    if ((mc as any).getBacklinksForFile?.safe) {
        try {
            return await (mc as any).getBacklinksForFile.safe(file);
        } catch (e) {
            console.debug("Backlink Cache .safe() failed", e);
        }
    }

    // 2. Fallback to standard (undocumented) method
    if ((mc as any).getBacklinksForFile) {
        try {
            return (mc as any).getBacklinksForFile(file);
        } catch (e) {
            console.warn("getBacklinksForFile failed", e);
        }
    }

    // 3. Ultimate fallback: empty result
    return { data: {} };
  }

  /** Helper to wait for metadata cache */
  private async waitForResolvedLinks(timeout = 8000): Promise<void> {
    const start = Date.now();
    const mc = this.app.metadataCache;

    while (Date.now() - start < timeout) {
      const isInitialized = (mc as any).initialized === true;
      const hasLinks = Object.keys(mc.resolvedLinks ?? {}).length > 0;

      if (isInitialized || hasLinks) {
        return;
      }

      await new Promise(resolve => setTimeout(resolve, 120));
    }

    console.warn("Timeout waiting for Obsidian metadata cache to initialize");
  }
  
  /**
   * Returns all first-degree connected files (both outgoing links + incoming backlinks).
   */
  private async getFirstDegreeFiles(file: TFile): Promise<Set<TFile>> {
    const connections = new Set<TFile>();

    // === Outgoing Links ===
    const cache = this.app.metadataCache.getFileCache(file);

    // Method 1: From file cache links
    if (cache?.links) {
      for (const link of cache.links) {
        const target = this.app.metadataCache.getFirstLinkpathDest(link.link, file.path);
        if (target instanceof TFile) {
          connections.add(target);
        }
      }
    }

    // Method 2: From resolvedLinks (extra coverage)
    const resolvedFromThisFile = this.app.metadataCache.resolvedLinks?.[file.path];
    if (resolvedFromThisFile) {
      for (const targetPath in resolvedFromThisFile) {
        const targetFile = this.app.vault.getFileByPath(targetPath);
        if (targetFile) {
          connections.add(targetFile);
        }
      }
    }

    // === Incoming Backlinks (now async) ===
    const incoming = await this.getIncomingBacklinks(file);
    incoming.forEach(source => connections.add(source));

    // Remove self-references if any
    connections.delete(file);

    return connections;
}

  private getNoteProperties(
    file: TFile,
    relation: Relation,
    type: Notetype = 'file',
    degree: 'zero' |'first' | 'second' = 'zero',
    connectionCount: number = 0,
    sharedLinksWithStart: number = 0
  ): NoteProperties {
    const cache = this.app.metadataCache.getFileCache(file);
    const frontmatter = cache?.frontmatter ?? {};

    return {
      filename: file.name,
      basename: file.basename,
      aliases: parseFrontMatterAliases(cache?.frontmatter) ?? [],
      tags: parseFrontMatterTags(cache?.frontmatter) ?? [],
      properties: Object.entries(frontmatter)
          .filter(([key]) => !['aliases', 'tags'].includes(key)),
      connectionCount,
      sharedLinksWithStart,
      degree,
      relation,
      type,
      file,
      ignored: [],
      upperGate: {
        ...DEFAULT_GATE,
        connections: [],
        unspecified: []
      },
      lowerGate: {
        ...DEFAULT_GATE,
        connections: [],
        unspecified: []
      },
      friendGate: {
        ...DEFAULT_GATE,
        connections: [],
        unspecified: []
      }
    };
  }
  
  private getPropertyAsArray(node: NoteProperties, key: string): string[] {
    const value = node.properties.find(([k]) => k === key)?.[1];

    if (Array.isArray(value)) {
        return value.filter((v): v is string => typeof v === 'string');
    }
    if (typeof value === 'string') return [value];
    return [];
  }

  private findRelation(
    noteA: NoteProperties,
    noteB: NoteProperties,
  ): Relation {

    const aName = noteA.basename; 
    const bName = noteB.basename;
    const bPath = noteB.file.path;
    const bTags = noteB.tags ?? [];

    // Early ignore check
    if (this.foundPart(bPath, this.ignoreFragments) || 
        this.checkTags(bTags, this.ignoreTags)) {
        return "ignored";
    }

    // Parent relationship (A links to B as parent OR B links to A as child)
    if (this.linksTo(noteA, noteB, bName, this.parentProperties) ||
        this.linksTo(noteB, noteA, aName, this.childProperties)) {
        return "parent";
    }

    // Child relationship
    if (this.linksTo(noteA, noteB, bName, this.childProperties) ||
        this.linksTo(noteB, noteA, aName, this.parentProperties)) {
        return "child";
    }

    // Friend relationship
    if (this.linksTo(noteA, noteB, bName, this.friendProperties) ||
        this.linksTo(noteB, noteA, aName, this.friendProperties)) {
        return "friend";
    }

    // Tag-based fallbacks
    if (this.checkTags(bTags, this.parentTags)) return "parent";
    if (this.checkTags(bTags, this.childTags)) return "child";
    if (this.checkTags(bTags, this.friendTags)) return "friend";

    return "undefined";
  }

  private linksTo(
    noteA: NoteProperties,
    noteB: NoteProperties,
    basename: string,
    propertiesToLookFor: string[]
  ): boolean {  

    if (!propertiesToLookFor?.length) return false;

    return propertiesToLookFor.some(attrib => {
        if (!attrib) return false;

        const values = this.getPropertyAsArray(noteA, attrib);
        return this.foundInlinks(values, basename);
    });
  }

  /**
 * Checks if the given values contain a link to the target basename
 * (handles wikilinks, pipes, commas, etc.)
 */
  private foundInlinks(values: unknown[] | unknown, basename: string): boolean {
    if (values == null) return false;

    const normalized = this.normalizeToStringArray(values);
    
    // Fast early exit - cheap string check
    if (!normalized.some(v => v.includes(basename))) {
        return false;
    }

    // More precise check after cleaning wikilinks
    return normalized
        .map(this.cleanLink)
        .includes(basename);
  }

  /**
   * Normalizes any input (string, array, null, etc.) into a clean string array
   */
  private normalizeToStringArray(input: unknown): string[] {
      if (input == null) return [];

      // If it's already an array, process each item
      if (Array.isArray(input)) {
          return input
              .flatMap(item => this.splitAndClean(item))
              .filter(Boolean);
      }

      // Single value (string, number, etc.)
      return this.splitAndClean(input);
  }

  /**
   * Splits by comma and cleans each part (handles wikilinks with | )
   */
  private splitAndClean(value: unknown): string[] {
    if (value == null) return [];

    const str = String(value).trim();
    if (!str) return [];

    return str.split(',')
        .flatMap(part => this.extractLinkTargets(part))
        .filter(Boolean);
  }

  /**
   * Handles both [[Link]] and [[Link|Display Text]] → returns clean link targets
   */
  private extractLinkTargets(text: string): string[] {
      const trimmed = text.trim();
      if (!trimmed) return [];

      // Split on pipe (|) and take the first part (the actual link target)
      const segments = trimmed.split('|').map(s => s.trim());

      return segments.map(segment => this.trimWikilinks(segment));
  }

  /**
   * Removes [[ and ]] from both sides
   */
  private trimWikilinks(str: string): string {
      if (typeof str !== 'string' || !str) return '';

      return str
          .trim()
          .replace(/^\[+/, '')   // remove one or more [ at start
          .replace(/\]+$/, '')   // remove one or more ] at end
          .trim();
  }

  /**
   * Optional: Cleaner alias for trimWikilinks if you prefer the name
   */
  private cleanLink = (str: string): string => this.trimWikilinks(str);


  
  private checkTags(taggedWith: string[],
                wantedTags: string[]): boolean {
    //tagged with any of the wanted tags
    const taggedWithSet = new Set(taggedWith ?? []);
    if (wantedTags.some(tag => taggedWithSet.has(tag))) {
      return true;
    }
    return false;
  };
    
  private foundPart(text: string, wantedParts: string | string[]): boolean {
    if (!text) return false;
    const lowerText = text.toLowerCase();

    const parts = Array.isArray(wantedParts) ? wantedParts : [wantedParts];

    return parts.some(part => 
        part && lowerText.includes(part.toLowerCase())
    );
  }
    
  //return an array 
  public itemsOf(value: unknown): string[] {
    if (value == null) return [];

    const str = String(value).trim();
    if (!str) return [];

    return str.split(',')
      .flatMap(part => part.trim())
      .filter(Boolean);
  }

  sortedSiblings(): NoteProperties[] {
    return [...this.siblings].sort((a, b) => {
        // 1. Primary sort: by relation
        const orderA = relationOrder[a.relation as Relation] ?? 999;
        const orderB = relationOrder[b.relation as Relation] ?? 999;

        if (orderA !== orderB) {
            return orderA - orderB;
        }

        // 2. Secondary sort: by first tag (alphabetically)
        const tagA = this.getFirstTag(a);
        const tagB = this.getFirstTag(b);

        if (tagA && tagB) {
            return tagA.localeCompare(tagB);
        }
        if (tagA) return -1;   // notes with tags come first
        if (tagB) return 1;
        return 0;
    });
  }

  groupByFirstTag(notes: NoteProperties[]): GroupedNotes[] {
    const groups = notes.reduce((acc: Map<string, NoteProperties[]>, note) => {
      const firstTag = note.tags?.[0]?.trim();
      const groupKey = firstTag ? firstTag : "untagged";

      if (!acc.has(groupKey)) {
        acc.set(groupKey, []);
      }
      acc.get(groupKey)!.push(note);

      return acc;
    }, new Map());

    return Array.from(groups.entries())
      .map(([tag, notes]) => ({ tag, notes }))
      .sort((a, b) => {
        if (a.tag === "untagged") return 1;
        if (b.tag === "untagged") return -1;
      return a.tag.localeCompare(b.tag);
      });
  };

}