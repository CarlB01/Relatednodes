import { App, BasesEntry, parseFrontMatterStringArray, TFile } from "obsidian";
import RelatednotesPlugin from "./main.js";
import { NoteClass, Relation } from "./NoteClass.js";
import { StringUtils } from "./StringUtils.js";
import { BaitClass } from "./BaitClass.js";
import { SettingsManager } from "./SettingsManager.js";
import { GateProperties } from "./GateClass.js";

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
      note.discoverySource = 'bodytext';
      note.assignedArea = 'lower'; // Fallback-kvadrant
      note.relations.parents.clear();
      note.relations.children.clear();
      note.relations.friends.clear();
      note.relations.siblings.clear();
      note.relations.ignored.clear();
      note.crossingBaits.clear();
    }

    GateProperties.cachedRadius = null; 

    for (const bait of this.baitCache.values()) {
      bait.isUsed = false;
      bait.sources.clear(); // <--- KRITISK: Tømmer alle gamle kilder safely for denne runden! [dan]
    }

    // 2. SET CENTER
    this.centerNote = this.getOrCreateNote(activeFile);
    if (!this.centerNote) return;
    this.centerNote.relation = 'center';
    this.centerNote.assignedArea = 'center';
    
    // ==========================================================================
    // 3. FØRSTE-TRINN FOR NYE NODER: PRE-LOAD (Tvinger Obsidian til å hente fil-cacher)
    // Siden denne loopen nå kjører aller først, garanterer vi at alle 1. grads filer 
    // opprettes og får fylt opp sine 'rawFrontmatter' i noteCache NÅ! [dan]
    // ==========================================================================
    const firstDegreeFiles = this.getFirstDegreeFiles(this.centerNote.path);
      // Sjekk at firstDegreeFiles faktisk er en gyldig samling før vi looper
    for (const file of firstDegreeFiles) {
      if (file.path !== this.centerNote.path) {
        // getOrCreateNote vil internt kalle getFileCache() og fylle rawFrontmatter med en gang!
        const preparedNote = this.getOrCreateNote(file);
        if (preparedNote) {
          preparedNote.isUsed = true; // Sørg for at den overlever indexAllBaits dørvakten [dan]
        }
      }
    }
     
    // ==========================================================================
    // 4. BEREGN AGN (BAITS) - NÅ ER DATAGRUNNLAGET GIGANTISK OG KOMPLETT!
    // Siden PRE-LOAD loopen over akkurat fylte noteCache med alle noder, vil indexAllBaits() 
    // nå klare å pakke ut agnene fra ALLE de 1. grads notene samtidig! baitCache blir fullstendig. [dan]
    // ==========================================================================
    this.indexAllBaits();    

    // ==========================================================================
    // 5. ETABLER RELASJONER (Nå som baitCache er komplett, vil findRelation() fungere feilfritt)
    // ==========================================================================
    
    // Kjør 1. grads stempling (Nå treffer findRelation perfekt på første forsøk!) [dan]
    this.determineFirstDegreeNotes(this.centerNote);

    // Kjør asynkron søsken-beregning. Siden baitCache er proppfull av foreldrenes agn, 
    // vil 'this.baitCache.get(siblingNote.basename)' finne parentBait MED EN GANG! [dan]
    await this.determineParentConnectionsAndSiblings(this.centerNote); 
    
    // Synkrone ettersjekker
    this.determineFriendConnections(this.centerNote);
    this.matchCrossingBaits();


    // ==========================================================================
    // 6. GARBAGE COLLECTION & PORT-INNSAMLING
    // ==========================================================================
    for (const [path, note] of this.noteCache.entries()) {
      if (!note.isUsed) this.noteCache.delete(path); 
    }

    for (const [path, bait] of this.baitCache.entries()) {
      if (!bait.isUsed || bait.sources.size === 0) {
        this.baitCache.delete(path); // Slett safely fra minnet [dan]
      }
    }
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
    // Samle filtrene fra din nye SettingsManager
    const parentProps = this.settings.optParentProperties;
    const childProps  = this.settings.optChildProperties;
    const friendProps = this.settings.optFriendProperties;

    // Slå sammen alle egenskapene til én felles liste som skal skannes
    const allTargetProps = [...parentProps, ...childProps, ...friendProps];

    // Loop over alle notater som er i bruk på skjermen akkurat nå
    for (const note of this.noteCache.values()) {
      if (!note.isUsed || note.isInitiallyIgnored) continue;
      if (!note.rawFrontmatter) continue;

      // Skann gjennom hver enkelt egenskap brukeren har valgt i innstillingene
      for (const attrib of allTargetProps) {
        if (!attrib) continue;
        
        // Hent rå-verdien direkte ut fra YAML-objektet (Sikrer at [[wikilenker]] overlever!)
        const rawValue = note.rawFrontmatter[attrib];
        if (rawValue == null) continue;

        // Tving og vask innholdet gjennom din nye, lynraske og optimaliserte StringUtils-pipeline
        const cleanArray = StringUtils.normalizeToStringArray(rawValue) ?? [];

        for (const targetName of cleanArray) {
          if (!targetName) continue;

          // Tving nøkkelen til lowercase for å fjerne absolutt alt av case-sensitivitet! [dan]
          const lowercaseTarget = targetName.toLowerCase();
          
          let bait = this.baitCache.get(lowercaseTarget);
          if (!bait) {
            bait = new BaitClass(targetName);
            this.baitCache.set(lowercaseTarget, bait);
          }
          
          bait.isUsed = true;
          
          // BINGO: I stedet for å overskrive og slette gamle spor, legger vi til 
          // dette notatet og den tilhørende egenskapen i det delte sources-kartet! [dan]
          bait.sources.set(note, attrib); 
        }
      }
    }
  }

  /**
   * TRINN 3: LYNRASK KRYSSENDE BAIT-MATCHING
   * Kobler sammen alle synlige noder som deler ett eller flere baits i minnet.
   */
  private matchCrossingBaits() {
    // Loop igjennom alle agn som er aktive i denne runden
    for (const bait of this.baitCache.values()) {
      if (!bait.isUsed || bait.sources.size < 2) continue; // Kreves minst 2 kilder for at det skal krysse!

      // Hent ut alle de unike notatene som har lagt ut dette agnet
      const nodesSharingThisBait = Array.from(bait.sources.keys());

      // Vi parer notatene mot hverandre i en dobbel-loop for å koble dem sammen i minnet
      for (let i = 0; i < nodesSharingThisBait.length; i++) {
        const nodeA = nodesSharingThisBait[i];
        if (!nodeA) continue;

        for (let j = i + 1; j < nodesSharingThisBait.length; j++) {
          const nodeB = nodesSharingThisBait[j];
          if (!nodeB) continue;

          // BINGO! Siden Node A og Node B deler dette agnet, stempler vi det 
          // rett inn i settene til begge notene. Nå vet de om hverandre! [dan]
          nodeA.crossingBaits.add(bait);
          nodeB.crossingBaits.add(bait);
        }
      }
    }
  }

  private findRelation(centerNote: NoteClass, otherNote: NoteClass): "ignored" | "parent" | "child" | "friend" | "undefined" {
    if (otherNote.isInitiallyIgnored) return "ignored";

    const parentProps = this.settings.optParentProperties;
    const childProps = this.settings.optChildProperties;
    const friendProps = this.settings.optFriendProperties;

    const lowercaseOtherName = otherNote.basename.toLowerCase();
    const lowercaseCenterName = centerNote.basename.toLowerCase();

    // Hent agnene fra cachen
    const baitForOther = this.baitCache.get(lowercaseOtherName);
    const baitForCenter = this.baitCache.get(lowercaseCenterName);

    // ==========================================================================
    // SJEKK A: Sjekk om centerNote har lagt ut en link til otherNote
    // ==========================================================================
    if (baitForOther && baitForOther.sources.has(centerNote)) {
      // Hent ut nøyaktig hvilken egenskap centerNote brukte da den linket til otherNote [dan]
      const prop = baitForOther.sources.get(centerNote)!;
      otherNote.discoverySource = "frontmatter-kriterium";

      if (parentProps.includes(prop)) return "parent";
      if (childProps.includes(prop))  return "child";
      if (friendProps.includes(prop)) return "friend";
    }

    // ==========================================================================
    // SJEKK B: Sjekk om otherNote har lagt ut en link tilbake til centerNote (Speiling!)
    // ==========================================================================
    if (baitForCenter && baitForCenter.sources.has(otherNote)) {
      // Hent ut nøyaktig hvilken egenskap otherNote brukte da den linket til centerNote [dan]
      const prop = baitForCenter.sources.get(otherNote)!;
      otherNote.discoverySource = "frontmatter-kriterium";

      if (childProps.includes(prop))  return "parent"; // Linker til oss via 'barn' -> Er vår forelder [dan]
      if (parentProps.includes(prop)) return "child";  // Linker til oss via 'forelder' -> Er vårt barn [dan]
      if (friendProps.includes(prop)) return "friend"; // Linker til oss via 'partner' -> Er vår venn [dan]
    }

    // --- LAG 2 & 3: TAGGER OG FRITTSTÅENDE TEKST-LINKER (Forblir helt uendret) ---
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

    const targetName = otherNote.basename;
    const finnesIFm = (centerNote.rawFrontmatter && Object.values(centerNote.rawFrontmatter).toString().includes(targetName)) ||
                      (otherNote.rawFrontmatter && Object.values(otherNote.rawFrontmatter).toString().includes(centerNote.basename));

    if (finnesIFm) {
      otherNote.discoverySource = "frontmatter-udefinert";
    } else {
      otherNote.discoverySource = "bodytext";
    }

    return "undefined";
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
        
        const relatedNote = this.noteCache.get(relatedFile.path);

        if (relatedNote && relatedNote.isUsed) { 
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

        // Opprett nytt søsken (siden det ikke fantes i grafen fra før)
        const siblingNote = this.getOrCreateNote(relatedFile); 
        if (!siblingNote) continue;

        siblingNote.assignedArea = 'right'; // Søsken bor i høyre kvadrant!
        
        // ==========================================================================
        // OPPDATERT: Sjekk om forelderen ('parent') finnes i agnets 'sources'-kart!
        // Dette forteller oss om koblingen kom fra en aktiv frontmatter-egenskap hos parent. [dan]
        // ==========================================================================
        const parentBait = this.baitCache.get(siblingNote.basename.toLowerCase());
        const isRealFrontmatterLink = parentBait && parentBait.sources.has(parent);

        if (isRealFrontmatterLink) {
          siblingNote.relation = "sibling"; // Ekte frontmatter-søsken (Kolleksjon 1) [dan]
        } else {
          siblingNote.relation = "undefined"; // Brødtekst-søsken (Kolleksjon 2) [dan]
        }

        parent.relations.children.add(siblingNote);
        siblingNote.relations.parents.add(parent);

        centerNote.relations.siblings.add(siblingNote); 
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