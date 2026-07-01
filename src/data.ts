import RelatednotesPlugin from "./main.js";
import { App, BasesEntry, MetadataCache, parseFrontMatterStringArray, sortSearchResults, TFile, Vault } from "obsidian";
import { NoteClass, Relation } from "./NoteClass.js";
import { GateProperties } from "./GateClass.js";
import { StringUtils } from "./StringUtils.js";
import { BaitClass } from "./BaitClass.js";
import { RV_CLASSES } from "./constants.js";
import { SettingsManager } from "./SettingsManager.js";

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

// Definerer et ryddig grensesnitt for samlingene som render-maskinen skal bruke
export interface TagGroupedCollection {
  tag: string;
  notes: NoteClass[];
}

export class RelatedData {
  noteCache = new Map<string, NoteClass>(); // path -> NoteClass
  baitCache = new Map<string, BaitClass>(); // path/basename -> BaitClass
  ignoredNotes = new Set<NoteClass>();
  centerNote: NoteClass | null = null;

  allGates: GateProperties[] = []; 

  private app: App; 
  private plugin: RelatednotesPlugin;
  private settings: SettingsManager;

  constructor(
    plugin: RelatednotesPlugin,
    settingsManager: SettingsManager
  ) {
    this.plugin = plugin;
    this.settings = settingsManager;
    this.app = plugin.app; 
  }

  async update(activeFile: TFile | null) {
    if (!activeFile) return;

    // 1. RESET
    this.ignoredNotes.clear();
    for (const note of this.noteCache.values()) {
      note.isUsed = false;
      note.relation = 'undefined';
      note.assignedArea = 'lower'; // Fallback-kvadrant
      note.relations.parents.clear();
      note.relations.children.clear();
      note.relations.friends.clear();
      note.relations.siblings.clear();
      note.relations.ignored.clear();
      note.crossingBaits.clear();
    }

    for (const bait of this.baitCache.values()) {
     bait.isUsed = false;
      bait.activeConnections.clear();
    }

    // 2. SET CENTER
    this.centerNote = this.getOrCreateNote(activeFile);
    if (!this.centerNote) return;
    this.centerNote.relation = 'center';
    this.centerNote.assignedArea = 'center';
    /*
    // 3. FETCH 1st GRADE RELATIVES
    this.determineFirstDegreeNotes(this.centerNote);

    // 3a. INDEX BAITS
    this.indexAllBaits();
    this.matchCrossingBaits();

    // 3b. CALCULATE SIBLINGS and FRIENDS 
    await this.determineParentConnectionsAndSiblings(this.centerNote); // asynchronous because of creating new nodes 
    this.determineFriendConnections(this.centerNote);
    

    // 4. GARBAGE COLLECTION (Slett elementer som ikke ble gjenbrukt)
    for (const [path, note] of this.noteCache.entries()) {
      if (!note.isUsed) this.noteCache.delete(path); 
    }
    for (const [path, bait] of this.baitCache.entries()) {
      if (!bait.isUsed || bait.sourceNote === null) this.baitCache.delete(path);
    }
    
    // 5. UPDATE GATES (allGates samling for global tilgang)
    this.fetchAllGates();
*/
    // 6. REPORT BACK
    //this.modelReady();
  }

  public getOrCreateNote(file: TFile): NoteClass | null {
    const path = file.path;
    
    // 1. Sjekk om noten allerede ligger i databasen vår (Gjenbruk)
    let note = this.noteCache.get(path);

    if (note) {
      // Hvis den finnes, gjenbruker vi den bare og markerer den som aktiv
      note.isUsed = true;
    } else {
      // 2. Hvis den IKKE finnes, henter vi fil-cachen fra Obsidian...
      const fileCache = this.app.metadataCache.getFileCache(file);
      if (!fileCache) return null;

      const useAlias = this.plugin.settings.displayAliases;
      
      note = NoteClass.createFromObsidian(file, fileCache, useAlias, this.settings.optIgnoreFragments, this.settings.optIgnoreTags);
      note.isUsed = true;
      
      // 3. Lagre den nye noten i databasen vår for fremtidig gjenbruk
      this.noteCache.set(path, note);
    }

    return note;
  }

  /**
   * TRINN 3a: INDEKSERING AV BAITS
   * Går igjennom alle aktive noder, finner deres frontmatter-koblinger, 
   * og registrerer dem som aktive agn i baitCache.
   */
  private indexAllBaits() {
    // Samle alle unike egenskaper brukeren har definert i innstillingene
    const parentProps = this.settings.optParentProperties;
    const childProps = this.settings.optChildProperties;
    const friendProps = this.settings.optFriendProperties;

    for (const note of this.noteCache.values()) {
      if (!note.isUsed || note.isInitiallyIgnored) continue;
      if (!note.rawFrontmatter) continue;

      // Hjelpefunksjon for å skanne spesifikke egenskaper for denne noten
      const scanProperties = (properties: string[], typeGroup: string) => {
        for (const attrib of properties) {
          if (!attrib) continue;
          
          const cleanArray = parseFrontMatterStringArray(note.rawFrontmatter, attrib) ?? [];

          const cleanTargets = cleanArray
              .flatMap(item => StringUtils.splitAndClean(item))
              .map(StringUtils.cleanLink);
          
          for (const targetName of cleanTargets) {
            // Vi bruker targetName (basename) som nøkkel i baitCache!
            let bait = this.baitCache.get(targetName);
            if (!bait) {
              bait = new BaitClass(targetName);
              this.baitCache.set(targetName, bait);
            }
            
            bait.isUsed = true;
            bait.sourceNote = note;           // Noten som eier denne frontmatteren
            bait.foundInProperty = attrib;     // Hvilken egenskap linken lå i
          }
        }
      };

      // Skann frontmatter for denne noten mot alle tre bruker-kriterier
      scanProperties(parentProps, "parent");
      scanProperties(childProps, "child");
      scanProperties(friendProps, "friend");
    }
  }

  /**
   * TRINN 3: LYNRASK KRYSSENDE BAIT-MATCHING
   * Kobler sammen alle synlige noder som deler ett eller flere baits i minnet.
   */
  private matchCrossingBaits() {
    for (const bait of this.baitCache.values()) {
      if (!bait.isUsed) continue;

      // Sjekk om dette spesifikke agnet (f.eks. et alias eller filnavn) 
      // eksisterer som en aktiv, synlig note i noteCache!
      const matchingNoteInGraph = this.noteCache.get(bait.path) || Array.from(this.noteCache.values()).find(n => n.basename === bait.basename);

      if (matchingNoteInGraph && matchingNoteInGraph.isUsed) {
        const source = bait.sourceNote;
        
        // Hvis kilden til baitet og den matchende noten i grafen er to forskjellige noder:
        if (source && source !== matchingNoteInGraph) {
          
          // BINGO! Vi har funnet en reell kryssing i grafen.
          // Vi lagrer denne koblingen direkte i minne-settene til begge notene:
          source.crossingBaits.add(bait);
          matchingNoteInGraph.crossingBaits.add(bait);

          // Registrer dem også inni selve bait-objektet så agnet vet hvem som "bet på"
          bait.activeConnections.add(source);
          bait.activeConnections.add(matchingNoteInGraph);
        }
      }
    }
  }

  private findRelation(centerNote: NoteClass, otherNote: NoteClass): "ignored" | "parent" | "child" | "friend" | "undefined" {
    if (otherNote.isInitiallyIgnored) return "ignored";

    const targetName = otherNote.basename;
    const parentProps = this.settings.optParentProperties;
    const childProps = this.settings.optChildProperties;
    const friendProps = this.settings.optFriendProperties;

    // --- LAG 1: SJEKK BRUKERSTYRTE FRONTMATTER-KRITERIER (To-veis) ---
    const baitFromCenter = this.baitCache.get(targetName);
    const baitFromOther = this.baitCache.get(centerNote.basename);

    // Sjekk A: Center har en egenskap som peker på andre note
    if (baitFromCenter && baitFromCenter.sourceNote === centerNote) {
      const prop = baitFromCenter.foundInProperty;
      otherNote.discoverySource = "frontmatter-kriterium"; // Funnet under en aktiv egenskap!

      if (parentProps.includes(prop)) return "parent";
      if (childProps.includes(prop)) return "child";
      if (friendProps.includes(prop)) return "friend";
    }
 
    // Sjekk B: Andre note har en egenskap som peker på center
    if (baitFromOther && baitFromOther.sourceNote === otherNote) {
      const prop = baitFromOther.foundInProperty;
      otherNote.discoverySource = "frontmatter-kriterium"; // Funnet under en aktiv egenskap!

      // Husk asymmetrien: Hvis andre peker på center via en parent-property, er andre parent til center
      if (parentProps.includes(prop)) return "parent"; 
      if (childProps.includes(prop)) return "child";
      if (friendProps.includes(prop)) return "friend";
    }

    // --- LAG 2: SJEKK TAG-BASERTE FALLBACKS (Også en del av brukerens kriterier) ---
    if (StringUtils.hasAnyOf(otherNote.tags, this.settings.optParentTags)) {
      otherNote.discoverySource = "frontmatter-kriterium";
      return "parent";
    }
    if (StringUtils.hasAnyOf(otherNote.tags, this.settings.optChildTags)) {
      otherNote.discoverySource = "frontmatter-kriterium";
      return "child";
    }
    if (StringUtils.hasAnyOf(otherNote.tags, this.settings.optFriendTags)) {
      otherNote.discoverySource = "frontmatter-kriterium";
      return "friend";
    }

    // --- LAG 3: KOBLEDES, MEN FALLER UTENFOR BRUKERENS KRITERIER ("Undefined") ---
    // Her sjekker vi om koblingen i det hele tatt finnes i frontmatter (men uten å matche egenskapene over)
    const finnesIFm = (centerNote.rawFrontmatter && Object.values(centerNote.rawFrontmatter).toString().includes(targetName)) ||
                      (otherNote.rawFrontmatter && Object.values(otherNote.rawFrontmatter).toString().includes(centerNote.basename));

    if (finnesIFm) {
      otherNote.discoverySource = "frontmatter-udefinert"; // Det var en fm-link, men ikke valgt av bruker!
    } else {
      otherNote.discoverySource = "bodytext"; // Fant overhodet ingen spor i frontmatter -> Rent brødtekst-funn
    }
    return "undefined";
  }

  private fetchAllGates() {
    this.allGates = [];
    for (const note of this.noteCache.values()) {
      // Dytter kun de 3 reelle portene inn i den globale listen
      this.allGates.push(note.upperGate);
      this.allGates.push(note.lowerGate);
      this.allGates.push(note.friendGate);
    }
  }
    
  private setCenterNoteRelations(centerNote: NoteClass, newNote: NoteClass){
    const { relation } = newNote;

    // HÅNDTERING AV IGNORERTE NOTATER
    if (relation === "ignored") {
      newNote.assignedArea = "ignored"; // Eget område-stempel så den ikke tegnes i 5x5 korset
      newNote.isUsed = true;             // SIKRER GJENBRUK: Overlever trinn 4 (Garbage Collection)

      // Etabler toveis-koblingen for ignorert status
      this.ignoredNotes.add(newNote);            // Globalt i RelatedData for totaltelling
      centerNote.relations.ignored.add(newNote); // Lokalt på center-noten
      return;
    }
      

    switch (relation) {
      case "parent": 
        newNote.assignedArea = "upper";
        newNote.relations.children.add(centerNote);
        centerNote.relations.parents.add(newNote);
        break;
      case "friend": 
        newNote.assignedArea = "left";
        newNote.relations.friends.add(centerNote);
        centerNote.relations.friends.add(newNote);
        break;
      case "child": 
      case "undefined": // PRINSIPP: Alle udefinerte relasjoner for center samles her!
        newNote.assignedArea = "lower";
        newNote.relations.parents.add(centerNote);
        centerNote.relations.children.add(newNote);
        break;
    }
  };

  private async determineParentConnectionsAndSiblings(centerNote: NoteClass) {
    const parents = centerNote.relations.parents;
    if (parents.size === 0) return;

    for (const parent of parents) {
      const filesSet = this.getFirstDegreeFiles(parent.path);

      for (const relatedFile of filesSet) {
        if (relatedFile.path === parent.path) continue; // skip self
        
        // if other relations in graph exists (friend, child, other parent), make link
        const relatedNote = this.noteCache.get(relatedFile.path);

        if (relatedNote && relatedNote.isUsed) { // only notes that exists in view already are relevant 
          const relation = this.findRelation(parent, relatedNote);
          
          switch (relation) {
            case 'child':
            case 'undefined':
              if (relatedNote.basename === centerNote.basename) break;
              parent.relations.children.add(relatedNote);
              relatedNote.relations.parents.add(parent);
              break;
            case 'parent':
              parent.relations.parents.add(relatedNote);
              relatedNote.relations.children.add(parent);
              break;
            case 'friend': 
              parent.relations.friends.add(relatedNote);
              relatedNote.relations.friends.add(parent);
              break;
          }
          continue;
        }

        // create new sibling, as it didn't exist in graph already
        const siblingNote = this.getOrCreateNote(relatedFile); // get an unused and unrelated note.
        if (!siblingNote) continue;

        siblingNote.assignedArea = 'right'; // Søsken tvinges til å bo i høyre kvadrant!
        
        // --- NYTT: SKILL MELLOM EKTE OG BRØDTEKST-SØSKEN ---
        // Vi sjekker om det finnes et aktivt frontmatter-agn (bait) lagt ut av parent på dette søskenet
        const parentBait = this.baitCache.get(siblingNote.basename);
        const isRealFrontmatterLink = parentBait && parentBait.sourceNote === parent;

        if (isRealFrontmatterLink) {
          siblingNote.relation = "sibling"; // Solid frontmatter-link!
        } else {
          siblingNote.relation = "undefined"; // Kun funnet i brødteksten!
        }

        parent.relations.children.add(siblingNote);
        siblingNote.relations.parents.add(parent);

        centerNote.relations.siblings.add(siblingNote); // Registrer i centers søsken-register
      }
    }
  }

  /**
   * Determine if friends of centernote (lives in left area) 
   * have other connections to any of the notes in the graph.
   * @param centerNote 
   * @returns 
   */
  private determineFriendConnections(centerNote: NoteClass) {
    const friends = centerNote.relations.friends;
    if (friends.size === 0) return;

    for (const friend of friends) {
      // all links and backlinks for this friend
      const filesSet = this.getFirstDegreeFiles(friend.path);

      // check if any of the linked files already exists in cache for each of the friends
      // Targets would be any of the parents or children or siblings of main node.
      for (const relatedFile of filesSet) {
        if (relatedFile.path === friend.path) continue; // skip friend itself
        
        const relatedNote = this.noteCache.get(relatedFile.path);
        if (relatedNote && relatedNote.isUsed) { // only notes that exists in view already are relevant
          const relation = this.findRelation(friend, relatedNote);

          switch (relation) {
            case 'child':
              friend.relations.children.add(relatedNote);
              relatedNote.relations.parents.add(friend);
              break;
            case 'parent':        
              friend.relations.parents.add(relatedNote);
              relatedNote.relations.children.add(friend);
              break;
            
            case 'friend':
              if (relatedNote.basename === centerNote.basename) break;
              friend.relations.friends.add(relatedNote);
              relatedNote.relations.friends.add(friend);
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
  private determineFirstDegreeNotes(ofNote: NoteClass) {
    // Hent alle unike filer (koblinger og bakkoblinger)
    const filesSet = this.getFirstDegreeFiles(ofNote.path);

    for (const file of filesSet) {
      if (file.path === ofNote.path) continue; // Hopp over seg selv

      const relatedNote = this.getOrCreateNote(file); // Hent eksisterende eller lag ny safely
      if (relatedNote) {
        relatedNote.relation = this.findRelation(ofNote, relatedNote);
        this.setCenterNoteRelations(ofNote, relatedNote);
      }
    }
  }

  /**
   * Hjelpefunksjon som tar inn noder fra en relasjon, sorterer dem, og returnerer en ren liste.
   */
  public getSortedNotesForQuadrant(connections: NoteClass[] | Set<NoteClass>, isSiblingQuadrant = false): NoteClass[] {
    if (!connections) return [];
    
    // Array.from() lager en fersk kopi i minnet med en gang, 
    // så vi slipper .slice() for å unngå uforutsigbare sideeffekter!
    const notesArray = Array.from(connections);
    if (notesArray.length === 0) return [];

    return notesArray.sort((a, b) => {
      // 1. Primærsortering kun for HØYRE kvadrant: Etter relasjonstype
      if (isSiblingQuadrant) {
          const orderA = relationOrder[a.relation] ?? 999;
          const orderB = relationOrder[b.relation] ?? 999;
          if (orderA !== orderB) return orderA - orderB;
      }

      // 2. Sekundærsortering: Første tag (Alfabetisk)
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
   * Fetches incoming backlinks lightning fast.
   * Accesses obsidan's readily indexed resolvedLinks
   */
  private getIncomingBacklinks(file: TFile): Set<TFile> {
    const backlinkSources = new Set<TFile>();
    const targetPath = file.path;
    const resolvedLinks = this.app.metadataCache.resolvedLinks;

    for (const sourcePath in resolvedLinks) {
      if (sourcePath === targetPath) continue; // Hopp over selvreferanse

      // Sjekk om kildearkivet faktisk har en registrert lenke til vår målfil
      const sourceLinks = resolvedLinks[sourcePath];
      if (sourceLinks && sourceLinks[targetPath] !== undefined) {
        const sourceFile = this.app.vault.getFileByPath(sourcePath);
        if (sourceFile) {
          backlinkSources.add(sourceFile);
        }
      }
    }
    return backlinkSources;
  }

  /**
   * Returns all first-degree connected files (both outgoing links + incoming backlinks).
   */
  private getFirstDegreeFiles(filePath: string): Set<TFile> {
    const connections = new Set<TFile>();

    const file = this.app.vault.getFileByPath(filePath);
    if (!file) return connections; 

    // === 1. Forward links ===
    const resolvedFromThisFile = this.app.metadataCache.resolvedLinks?.[filePath];
    if (resolvedFromThisFile) {
      for (const targetPath in resolvedFromThisFile) {
        if (targetPath === filePath) continue;
        const targetFile = this.app.vault.getFileByPath(targetPath);
        if (targetFile) connections.add(targetFile);
      }
    }

    // === 2. Incoming Backlinks ===
    const incoming = this.getIncomingBacklinks(file);
    for (const source of incoming) {
      connections.add(source);
    }

    return connections;
  }
    
  /**
   * Tar inn et Set eller et Array med noder, og grupperer dem etter første tag.
   */
  public groupByFirstTag(notes: NoteClass[] | Set<NoteClass>): TagGroupedCollection[] {
    // Array.from() gjør det trygt å sende inn enten Set eller Array
    const notesArray = Array.from(notes);

    const groups = notesArray.reduce((acc: Map<string, NoteClass[]>, note) => {
      const firstTag = note.tags?.[0]?.trim();
      const groupKey = firstTag ? firstTag : "untagged";

      if (!acc.has(groupKey)) {
        acc.set(groupKey, []);
      }
      acc.get(groupKey)!.push(note);

      return acc;
    }, new Map<string, NoteClass[]>());

    return Array.from(groups.entries())
      .map(([tag, notes]) => ({ tag, notes }))
      .sort((a, b) => {
        if (a.tag === "untagged") return 1;
        if (b.tag === "untagged") return -1;
        return a.tag.localeCompare(b.tag);
      });
  }

  public handleFileRename(file: TFile, oldPath: string) {
    // 1. Flytt og oppdater noten i noteCache
    if (this.noteCache.has(oldPath)) {
      const note = this.noteCache.get(oldPath)!;
      note.path = file.path;
      note.basename = file.basename;
      
      if (note.displayText === file.basename || !note.displayText) {
        note.displayText = file.basename;
      }
      
      this.noteCache.set(file.path, note);
      this.noteCache.delete(oldPath); 
    }

    // 2. Flytt og oppdater agnet i baitCache
    const oldBasename = oldPath.match(/([^/]+)\.md$/)?.[1] || oldPath;
    const newBasename = file.basename;

    if (this.baitCache.has(oldBasename)) {
      const bait = this.baitCache.get(oldBasename)!;
      (bait as any).path = file.path;
      (bait as any).basename = newBasename;
      
      this.baitCache.set(newBasename, bait);
      this.baitCache.delete(oldBasename);
    }

    if (this.centerNote) {
      const currentCenterFile = this.app.vault.getFileByPath(this.centerNote.path);
      if (currentCenterFile) {
        this.update(currentCenterFile); // Trigger vaskesyklus og re-render automatisk! [dan]
      }
    }
  }

  /**
   * Håndterer live-endringer i dataene når brukeren skriver.
   * Returnerer 'true' dersom endringen faktisk påvirket grafen vår.
   */
  public async handleFileResolve(file: TFile): Promise<boolean> {
    // 1. DØRVAKT: Sjekk lynraskt om denne endringen i det hele tatt påvirker oss
    const påvirkerVisning = this.noteCache.has(file.path) || 
                            this.baitCache.has(file.path);
    
    if (påvirkerVisning) {  
      // 2. Hent den aktive filen brukeren står i akkurat nå
      const activeFile = this.app.workspace.getActiveFile();
      
      if (activeFile) {        
        // 3. Oppdater minnedataene sentralt (Nå gyldig med async/await!)
        await this.update(activeFile);
        return true; // Gi beskjed om at dataene har endret seg!
      }
    }
    
    return false; // Ingenting ble endret
  }

}