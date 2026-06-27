import RelatednotesPlugin from "./main.js";
import { BasesEntry, MetadataCache, parseFrontMatterStringArray, TFile, Vault } from "obsidian";
import { NoteClass, Relation } from "./NoteClass.js";
import { GateProperties } from "./GateClass.js";
import { StringUtils } from "./StringUtils.js";

const relationOrder: Record<Relation, number> = {
  "center": 0,
  "parent": 1,
  "child": 2,
  "friend": 3,
  "sibling": 4,
  "undefined": 5,
  "ignored": 6,
}

export interface RelatedNoteGroup {
	key: string;
	isDefined: boolean;
	entries: BasesEntry[];
}

export interface GroupedNotes {
  tag: string;
  notes: NoteClass[];
}

export class RelatedData {
  
  noteCache = new Map<string, NoteClass>(); // basename → note. Source of truth.
  allGates: GateProperties[] = []; 
  
  centerNote: NoteClass | null = null;
  siblings: NoteClass[] = [];
  
  constructor(
    private app: {workspace: any; metadataCache: MetadataCache; vault: Vault},
    public plugin: RelatednotesPlugin,
    private modelReady: () => void
  ) {
  }

  async update(activeFile: TFile | null) {
    if (!activeFile) return;

    // 1. reset used flag and relations
    for (const note of this.noteCache.values()) {
      note.used = false;
      note.relation = 'undefined';
      note.upperGate.connections = []; 
      note.lowerGate.connections = []; 
      note.friendGate.connections = [];
    }

    // 2. get center note. Reuse if it exists.
    this.centerNote = this.getNote(activeFile);
    if (!this.centerNote) return;

    this.centerNote.relation = 'center';
    
    // 3. get relatives
    await this.determineFirstDegreeNotes(this.centerNote);
    await this.determineSiblings(this.centerNote);
    await this.determineFriendConnections(this.centerNote)
    
    // 4. erase notes not being reused
    for (const [basename, note] of this.noteCache.entries()) {
      if (!note.used) {
        this.noteCache.delete(basename); // Fjern fra minne-cachen
      }
    }
    
    // 5. update gates
    this.fetchAllGates();

    // 6. report back
    this.modelReady();
  }

  private getNote(file: TFile): NoteClass | null {
    const path = file.path;
    const useAlias = this.plugin.settings.displayAliases;
    let note = this.noteCache.get(path);
    if (note) {
      if (note.used && note.relation != 'undefined') return null; // used in a more central relation 
      note.used = true;
    } else {
      const noteCache = this.app.metadataCache.getFileCache(file);
      if (!noteCache) return null;
      note = new NoteClass(useAlias, file, noteCache)
      note.used = true
      this.noteCache.set(path, note);
    }
    return note;
  }

  private fetchAllGates() {
    this.allGates = [];
    for (const note of this.noteCache.values()) {
      this.allGates.push(note.upperGate);
      this.allGates.push(note.lowerGate);
      this.allGates.push(note.friendGate);
    }
  }
  
  private setCenterNoteRelations(centerNote: NoteClass, newNote: NoteClass){
    const { relation } = newNote;

    if (relation !== "ignored") {
      const targetGate = relation === "parent" ? newNote.lowerGate : 
                         relation === "friend" ? newNote.friendGate : newNote.upperGate; // undefined/child bruker upperGate.
      
      targetGate.connections.length = 0; // Tømmer lynraskt uten å kaste arrayen i minnet
      targetGate.connections.push(centerNote);
    }

    switch (relation) {
      case "ignored":
        centerNote.ignored.push(newNote);
        break;
      
      case "parent": 
        centerNote.upperGate.connections.push(newNote); 
        break;
        
      case "friend": 
        // Vennen (som ligger i venstre kvadrant) har sin port på HØYRE side (peker inn mot center)
        newNote.friendGate.direction = 'right';
        newNote.friendGate.connections = [centerNote]; // Etablerer toveis-koblingen
                
        // Senternoten har sin venneport på VENSTRE side (peker mot venstre kvadrant)
        centerNote.friendGate.direction = 'left';
        centerNote.friendGate.connections.push(newNote); 
        break;

      case "child": 
      case "undefined":
        centerNote.lowerGate.connections.push(newNote); 
        break;
    }
  };

  private async determineSiblings(centerNote: NoteClass) {
    const parents = centerNote.upperGate.connections;
    if (parents.length === 0) return;

    // 1. Fullfør link- og backlink-analyse for alle foreldre
    for (const parentNote of parents) {
        await this.determineFirstDegreeNotes(parentNote);
    }

    // 2. Samle noder fra foreldrenes porter
    const siblingCandidates = new Set<NoteClass>();

    for (const parentNote of parents) {
        // Hent alle noder som er koblet til denne forelderen (både dens barn og dens undefined)
        const parentConnections = parentNote.lowerGate.connections;

        for (const connectedNote of parentConnections) {
            // Unngå sirkelkobling: Senternoten kan ikke være sitt eget søsken!
            if (connectedNote.basename !== centerNote.basename) {
                siblingCandidates.add(connectedNote);
            }
        }
    }

    // --- 3. Ruting til Høyre Kvadrant ---
    // Tøm listen først for å unngå duplikater ved re-tegning
    centerNote.siblings.length = 0; 

    for (const note of siblingCandidates) {
      // Hvis noden allerede er en 'friend' eller 'parent' av senternoten, lar vi den stå i sin opprinnelige kvadrant
      if (note.relation === "friend" || note.relation === "parent") {
          continue; 
      }

      // Hvis den var "child" eller "undefined" fra før, flytter vi den til høyre kvadrant
      if (note.relation === "child" || note.relation === "undefined") {
          
          // Siden centerNote ikke har en siblingGate, lagrer vi den i den rene listen!
          centerNote.siblings.push(note);
      }
    }
  }

  private async determineFriendConnections(centerNote: NoteClass) {
    const friends = centerNote.friendGate.connections;
    if (friends.length === 0) return;

    for (const friend of friends) {
      // all links and backlinks for this friend
      const filesSet = await this.getFirstDegreeFiles(friend.file);

      // check if any of the linked files already exists in cache for each of the friends
      // Targets would be any of the parents or children or siblings of main node.
      for (const relatedFile of filesSet) {

        if (relatedFile.path === friend.file.path) continue; // skip friend itself
        
        const relatedNote = this.noteCache.get(relatedFile.path);
        if (relatedNote && relatedNote.used) { // only notes that exists in view already are relevant 
        
          const relation = this.findRelation(friend, relatedNote);
          // Koble nodene sammen i de fysiske portene (upperGate, lowerGate, etc.)
          switch (relation) {
            case 'child':
              friend.lowerGate.connections.push(relatedNote);
              relatedNote.upperGate.connections.push(friend);
              break;
            
            case 'parent':        
              friend.upperGate.connections.push(relatedNote);
              relatedNote.lowerGate.connections.push(friend);
              break;
            
            case 'friend':
              if (relatedNote.basename === centerNote.basename) break;
              friend.friendGate.connections.push(relatedNote);
              relatedNote.friendGate.connections.push(friend);
              break;
            
            case 'undefined':
            default:
              break;
          }
        }
      }
    }
  } 

  

  /**
   * Returns a unique, sorted set of all linked + backlinked note properties
   * of the primaryNote. Reuses noteProperties if they exist in noteCache.
   * @param primaryNote 
   * @returns 
   */
  private async determineFirstDegreeNotes(ofNote: NoteClass): Promise<void> {
    // Hent alle unike filer (koblinger og bakkoblinger)
    const filesSet = await this.getFirstDegreeFiles(ofNote.file);

    for (const file of filesSet) {
        if (file.path === ofNote.file.path) continue; // Hopp over seg selv

        const relatedNote = this.getNote(file); // get an unused and unrelated note.
        if (relatedNote) {
          // Kalkuler relasjonen relativt til 'ofNote'
          relatedNote.relation = this.findRelation(ofNote, relatedNote);

          // Koble nodene sammen i de fysiske portene (upperGate, lowerGate, etc.)
          this.setCenterNoteRelations(ofNote, relatedNote);
        }
    }
  }

  /**
   * Hjelpefunksjon som sorterer og returnerer noder for en spesifikk port/kvadrant.
  */
  getSortedNotesForQuadrant(connections: NoteClass[], isSiblingQuadrant = false): NoteClass[] {
    if (!connections || connections.length === 0) return [];
    // Vi tar en kopi av matrisen (.slice()) for å unngå uforutsigbare sideeffekter under mutering
    return connections.slice().sort((a, b) => {
      // 1. Primærsortering kun for HØYRE kvadrant: Etter relasjonstype
      if (isSiblingQuadrant) {
          const orderA = relationOrder[a.relation] ?? 999;
          const orderB = relationOrder[b.relation] ?? 999;
          if (orderA !== orderB) return orderA - orderB;
      }

      // 2. Sekundærsortering (Primær for de andre): Første tag (Alfabetisk)
      // Obsidians .first() fungerer på deres interne samlinger, men på en vanlig JS-array
      // bruker vi indeks [0] for maksimal hastighet og typesikkerhet.
      const tagA = a.tags && a.tags.length > 0 ? a.tags[0] : null;
      const tagB = b.tags && b.tags.length > 0 ? b.tags[0] : null;

      if (tagA !== tagB) {
        if (!tagA) return 1;  // Notater uten tagger havner nederst
        if (!tagB) return -1;
        return tagA.localeCompare(tagB);
      }

      // 3. Tertiærsortering: Etter relevans (Antall koblinger i hvelvet)
      const countA = a.connectionCount ?? 0;
      const countB = b.connectionCount ?? 0;
      if (countA !== countB) return countB - countA;

      // 4. Siste fallback: Rent alfabetisk på navn
      return a.basename.localeCompare(b.basename);
    });
  }

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
  
  private findRelation(centerNote: NoteClass, otherNote: NoteClass): Relation {
    const otherPath = otherNote.file.path;
    const otherTags = otherNote.tags ?? [];

    // --- LAG 1: TIDLIG SJEKK (Ignore) ---
    if (StringUtils.foundPart(otherPath, this.plugin.optIgnoreFragments) || 
      StringUtils.hasAnyOf(otherTags, this.plugin.optIgnoreTags)) {
      return "ignored";
    }

    // --- LAG 2: FRONTMATTER EGENSKAPER ---
    if (centerNote.linksTo(otherNote, this.plugin.optParentProperties) ||
      otherNote.linksTo(centerNote, this.plugin.optChildProperties)) {
      return "parent";
    }

    if (centerNote.linksTo(otherNote, this.plugin.optChildProperties) ||
      otherNote.linksTo(centerNote, this.plugin.optParentProperties)) {
      return "child";
    }

    if (centerNote.linksTo(otherNote, this.plugin.optFriendProperties) ||
      otherNote.linksTo(centerNote, this.plugin.optFriendProperties)) {
      return "friend";
    }

    // --- LAG 3: TAG-BASERT FALLBACK ---
    if (StringUtils.hasAnyOf(otherTags, this.plugin.optParentTags)) return "parent";
    if (StringUtils.hasAnyOf(otherTags, this.plugin.optChildTags)) return "child";
    if (StringUtils.hasAnyOf(otherTags, this.plugin.optFriendTags)) return "friend";

    return "undefined";
  }
    
  groupByFirstTag(notes: NoteClass[]): GroupedNotes[] {
    const groups = notes.reduce((acc: Map<string, NoteClass[]>, note) => {
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