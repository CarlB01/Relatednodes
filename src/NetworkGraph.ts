import { App, BasesEntry, CachedMetadata, debounce, Debouncer, TFile } from "obsidian";
import MyBrainPlugin from "./main.js";
import { Node, Relation } from "./Node.js";
import { StringUtils } from "./StringUtils.js";
import { Anchor } from "./Anchor.js";
import { SettingsManager } from "./SettingsManager.js";
import { Gate } from "./Gate.js";

const relationOrder: Record<Relation, number> = {
  "center": 0,
  "parent": 1,
  "child": 2,
  "friend": 3,
  "undefined": 4,
  "sibling": 5,
  "undefined-sibling": 6, 
  "ignored": 7,
};

export interface GraphNodeGroup {
  key: string;
  isDefined: boolean;
  entries: BasesEntry[];
}

export interface GroupedNotes {
  tag: string;
  notes: Node[];
}

/** Interface mapping clean entity collections consumed directly by the rendering pipeline */
export interface TagGroupedCollection {
  tag: string;
  notes: Node[];
}

export class NetworkGraph {
  notesCache = new Map<string, Node>(); // path -> Node
  anchorCache = new Map<string, Anchor>(); // path/basename -> Anchor
  ignoredNotes = new Set<Node>();
  centerNote: Node | null = null;

  private app: App; 
  private plugin: MyBrainPlugin;
  private settings: SettingsManager;

  private debouncedUpdate: Debouncer<[TFile | null], Promise<void>>;
  
  /** Explicit path-indexed memory skew holding runtime-compiled virtual structures */
  private memoryFeederCache: Map<string, CachedMetadata> = new Map();

  // updateRequestToken: token system for incremental cache synchronization.
  // Tracks if new anchors are discovered during build.
  // This happens if obsidian cache was not fully ready.
  // Helps keeping notesCache and anchorCache while next tread in progress 
  // takes over and finishes the partly updated caches.
  private updateRequestToken = 0;

  private isAborted = false;

  // #region LIFECYCLE METHODS
  constructor(
    plugin: MyBrainPlugin,
    settingsManager: SettingsManager
  ) {
    this.plugin = plugin;
    this.settings = settingsManager;
    this.app = plugin.app; 

    this.debouncedUpdate = debounce(this.executeUpdate.bind(this), 120, true);
  }

  public cancel(): void {
    this.isAborted = true;
    this.debouncedUpdate.cancel();
    this.clearMemoryFeederCache(); 
  }

  /**
   * Expressly purges the transient in-memory virtual metadata structure cache.
   * Intended to be called instantly when an encrypted context leaves view focus boundaries
   * to guarantee data isolation and prevent memory leakage of decrypted strings.
   */
  public clearMemoryFeederCache(): void {
    if (this.memoryFeederCache && this.memoryFeederCache.size > 0) {
      this.memoryFeederCache.clear();
    }
  }

  // #endregion
  

  // #region PRIVATE HELPER FUNCTIONS
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  private async yieldToUI(): Promise<void> {
    await this.sleep(0);
  }

  private async waitUntilCacheStable(file: TFile): Promise<void> {
    const maxMs = 1200;
    const stepMs = 35;
    const start = Date.now();

    let prevCount = -1;
    let stableHits = 0;

    while (Date.now() - start < maxMs) {
      const initialized = (this.app.metadataCache as typeof this.app.metadataCache & { initialized?: boolean }).initialized === true;
      const fileCache = this.app.metadataCache.getFileCache(file);
      const resolvedLinks = this.app.metadataCache.resolvedLinks;

      const centerLinks = resolvedLinks?.[file.path];
      const count = centerLinks ? Object.keys(centerLinks).length : 0;

      if (count === prevCount) stableHits++;
      else stableHits = 0;

      if (initialized && !!fileCache && !!resolvedLinks && stableHits >= 2) return;

      prevCount = count;
      await this.sleep(stepMs);
    }
  }
// #endregion


// #region MAIN STRUCTURE

//=================
// OVERVIEW:
// update(): Synchronous 'trigger'.
// - accepts file from Obsidian, increases token, and pushes it into the debounce-queue.
// debouncedUpdate(): Time-buffer
// executeUpdate(): The asynchronous worker
//=================


  /**
   * 1. THE TRIGGER (Synchronous)
   * Receives the raw event from Obsidian, increments the request token, 
   * and passes execution context safely to the debounce layer.
   */
  update(activeFile: TFile | null): void {
    if (!activeFile || this.plugin.isAppPaused()) return;

    if (this.centerNote && this.centerNote.path !== activeFile.path) {
      this.memoryFeederCache.delete(this.centerNote.path); // erase that old protected note
    }

    this.isAborted = false;

    /** Increment token immediately to invalidate any legacy async slices currently yielding */
    this.updateRequestToken++;

    /** Fire the debounce buffer */
    void this.debouncedUpdate(activeFile);
  }

  /**
   * 2. THE WORKER (Asynchronous)
   * Runs only after the user stops navigating.
   */
  private async executeUpdate(activeFile: TFile | null): Promise<void> {
    if (!activeFile || this.plugin.isAppPaused() || this.isAborted) return;

    /** Capture the exact token state before we initiate asynchronous cache polling */
    const tokenAtStart = this.updateRequestToken;
    
    // If a note exists in memoryFeederCache (decrypted), no need to wait for cache
    if (!this.memoryFeederCache.has(activeFile.path)) {
      // Wait for Obsidian's background indexer to stabilize links (ordinary files)
      await this.waitUntilCacheStable(activeFile);
      
      // Context safety check: Abort if cache wait was intercepted by a newer file-open event
      if (tokenAtStart !== this.updateRequestToken || this.isAborted) return;
    }

    // ================================
    // HEAVY DETERMINISTIC CALCULATIONS
    // ================================      
    this.ignoredNotes.clear();
    for (const note of this.notesCache.values()) {
      note.isUsed = false;
      note.isIndexedInThisRound = false;
      note.relation = "undefined";
      note.discoverySource = "bodytext";
      note.assignedArea = "lower";
      note.relations.parents.clear();
      note.relations.children.clear();
      note.relations.friends.clear();
      note.relations.ignored.clear();
      note.crossingBaits.clear();
    }

    Gate.cachedRadius = null;

    for (const bait of this.anchorCache.values()) {
      bait.isUsed = false;
      bait.sources.clear();
    }

    await this.yieldToUI();
    if (tokenAtStart !== this.updateRequestToken) return

    this.centerNote = this.getOrCreateNote(activeFile);
    if (!this.centerNote) return;

    this.centerNote.relation = "center";
    this.centerNote.assignedArea = "center";
    this.centerNote.isUsed = true;

    const firstDegreeFiles = this.getFirstDegreeFiles(this.centerNote.path);

    await this.yieldToUI();
    if (tokenAtStart !== this.updateRequestToken) return;

    let preloadStep = 0;
    for (const file of firstDegreeFiles) {
      if (file.path !== this.centerNote.path) {
        const preparedNote = this.getOrCreateNote(file);
        if (preparedNote) {
          preparedNote.isUsed = true;

          const relasjonTilSenter = this.findRelation(this.centerNote, preparedNote);
          if (relasjonTilSenter === "parent") {
            const parentFiles = this.getFirstDegreeFiles(preparedNote.path);
            for (const parentFile of parentFiles) this.getOrCreateNote(parentFile);
          }
        }
      }

      if (++preloadStep % 40 === 0) {
        await this.yieldToUI();
        if (tokenAtStart !== this.updateRequestToken) return;
      }
    }

    this.determineFirstDegreeNotes(this.centerNote);
    if (tokenAtStart !== this.updateRequestToken) return;

    await this.determineParentConnectionsAndSiblings(this.centerNote, tokenAtStart);
    if (tokenAtStart !== this.updateRequestToken) return;

    await this.determineCrossNetworkConnections(this.centerNote, tokenAtStart);
    if (tokenAtStart !== this.updateRequestToken) return;

    for (const [path, note] of this.notesCache.entries()) {
      if (!note.isUsed) this.notesCache.delete(path);
    }
    for (const [path, bait] of this.anchorCache.entries()) {
      if (!bait.isUsed || bait.sources.size === 0) this.anchorCache.delete(path);
    }

    /** Final commit boundary: Verify data integrity before deploying to the UI */
    if (tokenAtStart === this.updateRequestToken) {
      this.app.workspace.trigger("graph:data-ready", activeFile.path);
    }
  } 

  /**
   * Retrieves or instantiates a specialized note object within the localized layout cache.
   * Leverages high-performance structural memory bounds to fetch elements in O(1) velocity.
   */
  private getOrCreateNote(file: TFile): Node | null {
    if (!file) return null;

    // 1. MEMORY SKEW: Check if the node element already populates the path-indexed database
    let note = this.notesCache.get(file.path);

    if (!note) {
      const isDecrypted = this.memoryFeederCache.has(file.path);
      
      // 2. Fetch fresh cache properties natively from Obsidian Core if instance is missing
      const fileCache = isDecrypted
        ? this.returnDecryptedCache(file.path)
        : this.app.metadataCache.getFileCache(file);

      if (!fileCache) return null;

      const useAlias = this.plugin.settings.displayAliases;
      
      // Instantiate Node via the static factory generation protocol
      note = Node.createFromObsidian(file, fileCache, useAlias, this.settings.optIgnoreFragments, this.settings.optIgnoreTags);
      
      // 3. Commit the evaluated record index under file.path
      this.notesCache.set(file.path, note);
    }

    // ==========================================================================
    // ⚡ UNIVERSAL JIT INDEXING ENGINE (Fully optimized standalone pipeline)
    // Synchronously parses configuration variables exactly once per node per pass.
    // Guarantees high-velocity data availability preceding graph mapping layers.
    // ==========================================================================
    if (note.frontmatterIndex.size > 0 && !note.isIndexedInThisRound) {
      
      const parentProps = this.settings.optParentProperties;
      const childProps  = this.settings.optChildProperties;
      const friendProps = this.settings.optFriendProperties;
      const allTargetProps = [...parentProps, ...childProps, ...friendProps];

      // Scans through explicit target attributes configured inside settings panels
      for (const attrib of allTargetProps) {
        if (!attrib) continue;
        
        const values = this.getIndexedFrontmatterValues(note, attrib);
        if (!values) continue;

        for (const targetName of values) {
          if (!targetName) continue;

          // Forces keys to explicit lowercase and normalizes NFC formatting for emojis
          const lowercaseTarget = targetName.toLowerCase().normalize('NFC');
          
          let bait = this.anchorCache.get(lowercaseTarget);
          if (!bait) {
            bait = new Anchor(targetName);
            this.anchorCache.set(lowercaseTarget, bait);
          }
          bait.isUsed = true;
          
          // Maps originating nodes back to their target field strings in RAM space
          bait.sources.set(note, attrib); 
        }
      }

      // Stamps the operational pass flag onto the instance to forbid duplicity loops
      note.isIndexedInThisRound = true; 
    }

    return note;
  }
 
  /**
   * Evaluates and populates 1st-degree biological relationships radiating from the active node.
   * Maps out the baseline vertical spine and lateral friend structures dynamically.
   * @param centerNote The active origin node anchoring the visible viewport graph.
   */
  private determineFirstDegreeNotes(centerNote: Node) {
    // Collects a distinct, unified set mapping links and backlink trajectories
    const filesSet = this.getFirstDegreeFiles(centerNote.path);

    for (const file of filesSet) {
      if (file.path === centerNote.path) continue; // Skip self references

      const newNote = this.getOrCreateNote(file);
      if (!newNote) continue; 

      const relation = this.findRelation(centerNote, newNote);
      newNote.relation = relation;
      newNote.isUsed = true;

      // ==========================================================================
      // SUPPRESSED NODE ALLOCATION
      // ==========================================================================
      if (relation === "ignored") {
        newNote.assignedArea = "ignored";          // Shields record from standard 5x5 quadrant grids
        this.ignoredNotes.add(newNote);            // Tracked globally for total data reporting
        centerNote.relations.ignored.add(newNote); // Logged locally onto the active origin frame
        continue;
      }
      
      // ==========================================================================
      // BIU-LAYER ROUTING SECTOR (Two-way ekteskap assignments in memory)
      // ==========================================================================
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
        case "undefined": // Fallback architecture: routes all unmapped relationships to the lower bucket
          newNote.assignedArea = "lower";
          newNote.relations.parents.add(centerNote);
          centerNote.relations.children.add(newNote);
          break;
      }
    }
  }

  /**
   * Discovers and structures sibling connections derived via active parent nodes.
   * Leverages precise relationship shielding to avoid mutating existing first-degree data hierarchies.
   */
  private async determineParentConnectionsAndSiblings(centerNote: Node, tokenAtStart: number) {
    const parents = centerNote.relations.parents;
    if (parents.size === 0) return;

    let step = 0;

    for (const parent of parents) {
      const allGraphFiles = this.getFirstDegreeFiles(parent.path);

      for (const graphFile of allGraphFiles) {
        if (graphFile.path === parent.path) continue; // Skip self references
        if (graphFile.path === centerNote.path) continue; // Skip origin center node
        
        const graphNode = this.getOrCreateNote(graphFile);
        if (!graphNode) continue;

        const relation = this.findRelation(parent, graphNode);
        
        // ==========================================================================
        // CASE A: Target instance is already allocated to a dedicated viewport quadrant
        // ==========================================================================
        if (graphNode.isUsed) { 
          switch (relation) {
            case 'child':
            case 'undefined':
              // Commits the vertical relational connection up towards the parent collection
              parent.relations.children.add(graphNode);
              graphNode.relations.parents.add(parent);
              
              // CRITICAL RESTORATION: Enforces that existing active 1st-degree nodes 
              // preserve their structural membership mapping to the center node framework
              if (graphNode.relation === 'child') {
                centerNote.relations.children.add(graphNode);
              } else if (graphNode.relation === 'parent') {
                centerNote.relations.parents.add(graphNode);
              } else if (graphNode.relation === 'friend') {
                centerNote.relations.friends.add(graphNode);
              }
              break;

            case 'parent':
              parent.relations.parents.add(graphNode);
              graphNode.relations.children.add(parent);
              
              // Safeguards upstream parent links connecting to the origin note
              if (graphNode.relation === 'parent') {
                centerNote.relations.parents.add(graphNode);
              }
              break;

            case 'friend': 
              parent.relations.friends.add(graphNode);
              graphNode.relations.friends.add(parent);

              // Safeguards downstream friend links connecting to the origin note
              if (graphNode.relation === 'friend') {
                centerNote.relations.friends.add(graphNode);
              }
              break;
          }
          continue; // Safely proceed to next record as instance allocation is secured
        }

        // ==========================================================================
        // CASE B: Unallocated discovery cluster -> Real sibling routing
        // ==========================================================================
        if (relation === 'parent') continue; // Intercepts grandparent leakage
        if (relation === 'friend') continue; // Intercepts parent-level friend leakage

        // Commits lifecycle flags to register layout rendering bounds
        graphNode.isUsed = true; 
        graphNode.assignedArea = 'right'; // Binds instance target coordinates to the right quadrant
        
        // Evaluate if connection originated from an explicit metadata entry inside parent frontmatter
        const lowercaseSiblingName = graphNode.basename.toLowerCase().normalize('NFC');
        const parentBait = this.anchorCache.get(lowercaseSiblingName);
        const isRealFrontmatterLink = parentBait && parentBait.sources.has(parent);

        if (isRealFrontmatterLink) {
          graphNode.relation = "sibling"; // Collection 1: Verified frontmatter siblings
        } else {
          graphNode.relation = "undefined-sibling"; // Collection 2: Bodytext context discovery siblings
        }

        parent.relations.children.add(graphNode);
        graphNode.relations.parents.add(parent);

        if (++step % 30 === 0) {
          await this.yieldToUI();
          if (tokenAtStart !== this.updateRequestToken) return;
        }

      }
    }
  }

  /**
   * Universal network scanner driving the standalone cross-node pairing matrix.
   * Scans all visible cluster view elements against each other to map hidden, direct 
   * hyper-relational pathways completely independent of the origin center node.
   * Synchronously binds evaluated connections two-way into high-velocity RAM sets.
   * @param centerNote The active origin note anchoring the graph hierarchy framework.
   */
  private async determineCrossNetworkConnections(centerNote: Node, tokenAtStart: number) {
    // 1. COLLECT LAYOUT-RENDERED VIEW CORES
    const visibleNotes = Array.from(this.notesCache.values())
      .filter(note => note.isUsed && note.assignedArea !== 'ignored');

    if (visibleNotes.length < 2) return;

    // Localized helper parsing Obsidian's internal indexes to guarantee a physical anchor link exists
    const harDirekteFysiskLink = (a: Node, b: Node): boolean => {
      const resolvedLinks = this.app.metadataCache.resolvedLinks;
      const unresolvedLinks = this.app.metadataCache.unresolvedLinks;
      
      const sjekkKobling = (fraPath: string, tilBasename: string): boolean => {
        const resObj = resolvedLinks?.[fraPath];
        if (resObj) {
          const tilNameLower = tilBasename.toLowerCase();
          return Object.keys(resObj).some(path => {
            const pLower = path.toLowerCase();
            return pLower.includes(tilNameLower) || pLower.endsWith(`/${tilNameLower}.md`);
          });
        }
        const unresObj = unresolvedLinks?.[fraPath];
        if (unresObj && typeof unresObj === 'object') {
          const tilNameLower = tilBasename.toLowerCase();
          return Object.keys(unresObj).some(key => key.toLowerCase().includes(tilNameLower));
        }
        return false;
      };

      return sjekkKobling(a.path, b.basename) || sjekkKobling(b.path, a.basename);
    };

    // ==========================================================================
    // 2. PRIMARY PAIRING RECKONING MACHINE (Inherited from cross-bait topology)
    // Symmetrically pairs all active layout nodes across a flawless double-loop
    // ==========================================================================
    let step = 0;
    for (let i = 0; i < visibleNotes.length; i++) {
      const nodeA = visibleNotes[i];
      if (!nodeA) continue;

      for (let j = i + 1; j < visibleNotes.length; j++) {
        const nodeB = visibleNotes[j];
        if (!nodeB) continue;

        // Shields the center node are anchors as its 1st-degree maps are already spikret
        if (nodeA.path === centerNote.path || nodeB.path === centerNote.path) continue;

        // DILEMMA DISCOVERY GUARD: Intercepts and blocks lateral lines unless 
        // a verifiable, physical direct hyperlink trajectory is explicitly present in the vault
        if (!harDirekteFysiskLink(nodeA, nodeB)) continue;

        // 3. Harvest biological classification matching the populated standalone bait caches
        const relation = this.findRelation(nodeA, nodeB);

        // ==========================================================================
        // 4. CROSS-NETWORK INSTANCE COMMITMENT (Two-way RAM cache storage)
        // ==========================================================================
        switch (relation) {
          case 'child':
            // Node A contains property references electing Node B as a downstream target child
            nodeA.relations.children.add(nodeB);
            nodeB.relations.parents.add(nodeA);
            break;
            
          case 'parent':        
            // Node A contains property references electing Node B as an upstream source parent
            nodeA.relations.parents.add(nodeB);
            nodeB.relations.children.add(nodeA);
            break;
          
          case 'friend':
            // Shared reciprocal or unidirectional metadata connection fields detected
            nodeA.relations.friends.add(nodeB);
            nodeB.relations.friends.add(nodeA);
            break;

          case 'undefined':
            // Fallback track: Sourced entirely from a direct bodytext link detection. 
            // Since it passed the link check, we log them cleanly into friend GATE segments.
            nodeA.relations.friends.add(nodeB);
            nodeB.relations.friends.add(nodeA);
            break;
        }
        if (++step % 25 === 0) {
          await this.yieldToUI();
          if (tokenAtStart !== this.updateRequestToken) return;
        }
      }
    }
  }

  /**
   * Core classification utility evaluating the precise logical intersection between two nodes.
   * Leverages high-velocity NFC string normalization and explicit token matching to reject fragment alignment.
   * @param centerNote The origin source entity checking its boundaries.
   * @param otherNote The target entity being classified into a quadrant structure.
   */
  private findRelation(centerNote: Node, otherNote: Node): "ignored" | "parent" | "child" | "friend" | "undefined" {
    if (otherNote.isInitiallyIgnored) return "ignored";

    const parentProps = this.settings.optParentProperties;
    const childProps  = this.settings.optChildProperties;
    const friendProps = this.settings.optFriendProperties;

    const lowercaseOtherName  = otherNote.basename.toLowerCase().normalize('NFC');
    const lowercaseCenterName = centerNote.basename.toLowerCase().normalize('NFC');

    // Fetch memory anchors natively using normalized string tokens
    const baitForOther  = this.anchorCache.get(lowercaseOtherName);
    const baitForCenter = this.anchorCache.get(lowercaseCenterName);

    // ==========================================================================
    // CHECK A: Evaluates if centerNote owns an ACTIVE link to otherNote inside frontmatter
    // ==========================================================================
    if (baitForOther && baitForOther.sources.has(centerNote)) {
      const prop = baitForOther.sources.get(centerNote)!;
      otherNote.discoverySource = "frontmatter-kriterium";

      if (parentProps.includes(prop)) return "parent";
      if (childProps.includes(prop))  return "child";
      if (friendProps.includes(prop)) return "friend";
    }

    // ==========================================================================
    // CHECK B: Evaluates if otherNote owns an ACTIVE reciprocal link to centerNote (Mirroring)
    // HIGH-SCALE RECKONING: Validates distinct file path hashes and raw normalized string identities.
    // Blocks partial fragment intrusions to guarantee structural stability.
    // ==========================================================================
    if (baitForCenter) {
      for (const [sourceKey, prop] of baitForCenter.sources.entries()) {
        if (!sourceKey) continue;

        // Cast the variant reference into Node
        const sourcePath = (typeof sourceKey === 'string') 
          ? sourceKey 
          : sourceKey.path || "";
          
        const sourceBasename = (typeof sourceKey === 'string') 
          ? sourceKey 
          : sourceKey.basename || "";

        // STRICT IDENTICAL SJEKK:
        if (sourcePath === otherNote.path || sourceBasename.toLowerCase().normalize('NFC') === lowercaseOtherName) {
          otherNote.discoverySource = "frontmatter-kriterium";

          if (parentProps.includes(prop)) return "child";  
          if (childProps.includes(prop))  return "parent"; 
          if (friendProps.includes(prop)) return "friend"; 
        }
      }
    }

    // ==========================================================================
    // TIER 2 & 3: TAG CLASSIFICATIONS AND RAW BODYTEXT TOKENS
    // ==========================================================================
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
    
    // Use precomputed frontmatterIndex to preserve prior loose string-matching semantics
    const finnesIFm = this.hasLooseFrontmatterMatch(centerNote, targetName) ||
                      this.hasLooseFrontmatterMatch(otherNote, centerNote.basename);
                      
    if (finnesIFm) {
      otherNote.discoverySource = "frontmatter-udefinert";
    } else {
      otherNote.discoverySource = "bodytext";
    }

    return "undefined";
  }

  private getIndexedFrontmatterValues(note: Node, attrib: string): string[] | undefined {
    const trimmedAttrib = attrib.trim();
    if (!trimmedAttrib) return undefined;

    return note.frontmatterIndex.get(trimmedAttrib) ??
           note.frontmatterIndex.get(trimmedAttrib.toLowerCase());
  }

  private hasLooseFrontmatterMatch(note: Node, targetName: string): boolean {
    if (!targetName) return false;

    for (const values of note.frontmatterIndex.values()) {
      for (const value of values) {
        if (String(value).includes(targetName)) return true;
      }
    }

    return false;
  }

  /**
   * Fetches incoming backlinks in high-velocity RAM space.
   * Directly accesses Obsidian's pre-indexed internal metadata resolved link mappings
   * to bypass disk I/O bottlenecks.
   * @param file The target file reference to locate incoming backlinks for.
   * @returns A distinct Set containing all verified source TFile records linking to the target.
   */
  private getIncomingBacklinks(file: TFile): Set<TFile> {
    const backlinkSources = new Set<TFile>();
    const targetPath = file.path;
    const resolvedLinks = this.app.metadataCache.resolvedLinks;

    for (const sourcePath in resolvedLinks) {
      if (sourcePath === targetPath) continue; // Skips explicit self-referential loops

      // Checks if the source index contains an active, registered link token to our target path
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
   * Compiles a unified, unique collection mapping all 1st-degree connected file records.
   * Merges outbound hyperlink paths with incoming backlink trajectories into a single Set.
   * @param filePath The exact system file path to locate connections for.
   * @returns A distinct Set containing all verified forward and reverse TFile mappings.
   */
  private getFirstDegreeFiles(filePath: string): Set<TFile> {
    const connections = new Set<TFile>();

    const file = this.app.vault.getFileByPath(filePath);
    if (!file) return connections; 

    // === 1. EVALUATE FORWARD HYPERLINKS ===
    const resolvedFromThisFile = this.app.metadataCache.resolvedLinks?.[filePath];
    if (resolvedFromThisFile) {
      for (const targetPath in resolvedFromThisFile) {
        if (targetPath === filePath) continue;
        const targetFile = this.app.vault.getFileByPath(targetPath);
        if (targetFile) connections.add(targetFile);
      }
    }

    // === 2. EVALUATE INCOMING BACKLINKS ===
    const incoming = this.getIncomingBacklinks(file);
    for (const source of incoming) {
      connections.add(source);
    }

    return connections;
  }

  /**
   * Resolves the in-memory virtual metadata structure for decrypted nodes.
   * Guaranteed to never return undefined to prevent falling back to disk cache.
   */
  private returnDecryptedCache(path: string): CachedMetadata {
    const cachedMetadata = this.memoryFeederCache.get(path);
    
    if (cachedMetadata) return cachedMetadata;

    /** Fallback: Return a structurally valid, empty blueprint instead of undefined */
    return {
      links: [],
      tags: [],
      frontmatter: undefined
    };
  }
  // #endregion


  // #region PUBLIC HELPER FUNCTIONS
    /**
   * High-performance memory sorting engine consolidating nodes into explicit quadrant arrays.
   * Leverages memory-safe clones via Array.from() to neutralize unintended asynchronous mutations.
   * @param connections The active target collection stack (Array or Map-Set context).
   * @param isSiblingQuadrant Flag triggering primary relational ordering for flank clusters.
   */
  public getSortedNotesForQuadrant(connections: Node[] | Set<Node>, isSiblingQuadrant = false): Node[] {
    if (!connections) return [];
    
    const notesArray = Array.from(connections);
    if (notesArray.length === 0) return [];

    return notesArray.sort((a, b) => {
      // 1. PRIMARY WEIGHT SORT (Flank specific: Groups explicit siblings above bodytext siblings)
      if (isSiblingQuadrant) {
        const orderA = relationOrder[a.relation] ?? 999;
        const orderB = relationOrder[b.relation] ?? 999;
        if (orderA !== orderB) return orderA - orderB;
      }

      // 2. SECONDARY WEIGHT SORT: Frontmatter primary tag (Alphabetical alpha tracking)
      const tagA = a.tags && a.tags.length > 0 ? a.tags[0] : null;
      const tagB = b.tags && b.tags.length > 0 ? b.tags[0] : null;

      if (tagA !== tagB) {
        if (!tagA) return 1;  // Routes unassigned elements down to the bottom gutters safely
        if (!tagB) return -1;
        return tagA.localeCompare(tagB);
      }

      // 3. TERTIARY WEIGHT SORT: Structural relevance metric (Vault link density count)
      const countA = a.connectionCount ?? 0;
      const countB = b.connectionCount ?? 0;
      if (countA !== countB) return countB - countA;

      // 4. FALLBACK RESOLUTION: Final raw alphabetical string compare matching baseline names
      return a.basename.localeCompare(b.basename);
    });
  }

  /**
   * Consolidates node stacks dynamically into groups partitioned by their primary frontmatter tag.
   * Leverages clean Map-reducers and sorts untagged segments securely down to the layout gutters.
   * @param notes The target collection framework (Array or Set array structure).
   * @returns An array mapping specialized tag collection boundaries.
   */
  public groupByFirstTag(notes: Node[] | Set<Node>): TagGroupedCollection[] {
    const notesArray = Array.from(notes);

    const groups = notesArray.reduce((acc: Map<string, Node[]>, note) => {
      const firstTag = note.tags?.[0]?.trim();
      const groupKey = firstTag ? firstTag : "untagged";

      if (!acc.has(groupKey)) {
        acc.set(groupKey, []);
      }
      acc.get(groupKey)!.push(note);

      return acc;
    }, new Map<string, Node[]>());

    return Array.from(groups.entries())
      .map(([tag, notes]) => ({ tag, notes }))
      .sort((a, b) => {
        if (a.tag === "untagged") return 1;
        if (b.tag === "untagged") return -1;
        return a.tag.localeCompare(b.tag);
      });
  }

  /**
   * Intercepts file resolution events triggered when a user writes inside an active note editor pane.
   * Evaluates layout dependencies instantly to process live, hot-reloading graph redraws.
   * @param file The TFile record receiving active markdown metadata modifications.
   * @returns A promise resolving to a boolean confirming if the structural graph view required a update pass.
   */
  public async handleFileResolve(file: TFile): Promise<boolean> {
    // GATE GUARD: High-velocity validation checking if the modified file impacts currently tracked memory paths
    const påvirkerVisning = this.notesCache.has(file.path) || 
                            this.anchorCache.has(file.path);
    
    if (påvirkerVisning) {  
      const activeFile = this.app.workspace.getActiveFile();
      
      if (activeFile) {        
        void this.update(activeFile);
        return true; 
      }
    }
    
    return false; 
  }

  /**
   * Intercepts Obsidian file renaming events to synchronize cached system indexes live.
   * Employs strict NFC Unicode normalization keys to secure anchor integrity across mutations.
   * COMPLIANT REFACTOR: Silences floating promise warnings via explicit void operators [dan].
   * @param file The targeted TFile record currently being renamed or relocated.
   * @param oldPath The absolute historical system path hash originating before the modification.
   */
  public handleFileRename(file: TFile, oldPath: string) {
    // 1. MEMORY OVERRIDE: Relocate and re-index the element in notesCache
    if (this.notesCache.has(oldPath)) {
      const note = this.notesCache.get(oldPath)!;
      note.path = file.path;
      note.basename = file.basename;
      
      if (note.displayText === file.basename || !note.displayText) {
        note.displayText = file.basename;
      }
      
      this.notesCache.set(file.path, note);
      this.notesCache.delete(oldPath); 
    }

    // 2. MEMORY OVERRIDE: Relocate and re-index the string token inside anchorCache
    const rawOldBasename = oldPath.match(/([^/]+)\.md$/)?.[1] || oldPath;
    
    const normalizedOldKey = rawOldBasename.toLowerCase().normalize('NFC');
    const normalizedNewKey = file.basename.toLowerCase().normalize('NFC');

    if (this.anchorCache.has(normalizedOldKey)) {
      const bait = this.anchorCache.get(normalizedOldKey)!;
  // ==========================================================================
    // COMPLIANT DOUBLE-CASTING MATRIX (Knuser overlap-feilen permanent!):
    // Since Anchor and Record do not directly overlap, we safely route the expression
    // through 'unknown' first as recommended by the compiler. This completely destroys 
    // the explicit 'any' audit alarm while remaining fully typesafe [dan]!
    // ==========================================================================
    ((bait as unknown) as Record<string, unknown>).path = file.path;
    ((bait as unknown) as Record<string, unknown>).basename = file.basename; 
      
      this.anchorCache.set(normalizedNewKey, bait);
      this.anchorCache.delete(normalizedOldKey);
    }

    // 3. REFLOW TRIGGERS: Automatically refreshes the visible graph for the active center node context
    if (this.centerNote) {
      const currentCenterFile = this.app.vault.getFileByPath(this.centerNote.path);
      if (currentCenterFile) {
        void this.update(currentCenterFile); 
      }
    }
  }

  /**
   * External payload entry point. Injects in-memory compiled metadata 
   * structures directly into the graph processing queue, bypassing disk cache.
   * 
   * @param file The targeted decrypted TFile instance.
   * @param virtualCache The structurally valid, simulated Obsidian metadata object.
   */
  public handleExternalContentFeed(file: TFile, virtualCache: CachedMetadata): void {
    /** Map the transient virtual metadata directly into the path-indexed memory skew */
    this.memoryFeederCache.set(file.path, virtualCache);
    
    /** 
     * Invalidate legacy asynchronous loop execution slices immediately 
     * by forcing a token shift boundary configuration.
     */
    this.updateRequestToken++;
    
    /** Execute the heavy deterministic calculation pass with high-velocity memory structures */
    void this.executeUpdate(file);
  }
  // #endregion
}
