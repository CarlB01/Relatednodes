import myBrainPlugin from './main.js';
import { HoverPopover, TFile, WorkspaceLeaf, HoverParent, MarkdownView, FileView, Platform, ItemView, App, EventRef } from 'obsidian';
import { AreaManager } from './AreaManager.js';
import { RV } from './constants.js';

export class MyBrainView extends ItemView implements HoverParent {

  private plugin: myBrainPlugin;
  app: App;
  public areaManager!: AreaManager;
  
  currentFilePath: string = ""; // Tracks the unique file path this window is presently displaying
  private lastMouseEvent: MouseEvent | null = null;
  private lastMouseTarget: HTMLElement | null = null;
  public hoverPopover: HoverPopover | null = null;
  public resolveDebounceTimer: number | null = null; 
  public renameDebounceTimer: number | null = null;

  private layoutDebounceTimer: number | null = null;
  private orientationDebounceTimer: number | null = null;
  private activeLeafDebounceTimer: number | null = null;
  private visibilityResumeTimer: number | null = null;
  private isSuspended: boolean = false;
  private isDomSuspended: boolean = false;

  private lastResumeAt = 0;
  private visibilityObserver: IntersectionObserver | null = null;
  

  public isRenamingShield: boolean = false;
  /** Public visibility state constraint protecting viewport boundaries from early lifecycle pops */
  public isFullyStarted: boolean = false;
  
  // DEBOUNCE LOOP TRACKER: Tracks dynamic workspace visibility state transitions.
  // Set to true by default to force a clean, definitive re-sync pass on initial boots [dan]!
  private wasPanelHidden: boolean = true;
  
  constructor(leaf: WorkspaceLeaf, plugin: myBrainPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.app = plugin.app;
  }

  // ==========================================================================
  // VIEW IDENTIFIERS & META ATTRIBUTES
  // ==========================================================================
  
  getViewType(): string { return RV.MYBRAIN_VIEW_TYPE; }
  getDisplayText(): string { return "myBrain"; }

  /**
   * Robust high-velocity file resolver parsing incoming strings using multi-layered fallbacks.
   * Accesses cached indices natively to guarantee fast, disk-free string matching.
   * @param filename The raw link path string or target file name.
   * @param sourcePath Originating container pathway hash used to resolve relative targets.
   * @returns The resolved TFile instance or null matching strict Obsidian API configurations.
   */
  private getFile(filename: string, sourcePath: string = ''): TFile | null {
    if (!filename?.trim()) return null;

    const cleanName = filename.trim();

    // 1. Primary fallback: Core linkpath metadata dictionary (handles aliases and deep relative anchors)
    let file = this.app.metadataCache.getFirstLinkpathDest(cleanName, sourcePath);
    if (file instanceof TFile) return file;

    // 2. Secondary fallback: Absolute physical path dictionary lookup
    file = this.app.vault.getFileByPath(cleanName);
    if (file instanceof TFile) return file;

    // 3. Tertiary fallback: Automatically inject markdown extension tails if absent
    if (!cleanName.endsWith('.md') && !cleanName.includes('.')) {
        file = this.app.vault.getFileByPath(cleanName + '.md');
        if (file instanceof TFile) return file;
    }

    // 4. Quaternary fallback: Structural scan across all markdown file basenames
    const markdownFiles = this.app.vault.getMarkdownFiles();
    file = markdownFiles.find(f => f.basename === cleanName) ?? null;
    if (file instanceof TFile) return file;

    // 5. Final fallback: Scans nested frontmatter metadata schemas for registered aliases
    file = markdownFiles.find((f) => {
      const cache = this.app.metadataCache.getFileCache(f);

      // Cast the cache frontmatter layer strictly to a Record map or null [dan].
      const frontmatterIndex = (cache?.frontmatter || null) as Record<string, unknown> | null;
      const aliases = frontmatterIndex?.aliases;

      if (Array.isArray(aliases)) {
          return aliases.some(alias => 
              typeof alias === 'string' && 
              alias.trim().toLowerCase() === cleanName.toLowerCase()
          );
      }
      if (typeof aliases === 'string') {
          return aliases.trim().toLowerCase() === cleanName.toLowerCase();
      }
      return false;
    }) ?? null;

    if (file instanceof TFile) return file;

    return null;
  }

  /**
   * Scans workspace viewports to evaluate if a target file is currently open in an active tab leaf.
   * @param targetFile The file instance to verify within open panes.
   * @returns The active WorkspaceLeaf housing the file, or null if unmounted.
   */
  private findLeafWithFile(targetFile: TFile): WorkspaceLeaf | null {
    let found: WorkspaceLeaf | null = null;

    this.app.workspace.iterateAllLeaves((leaf) => {
      if (leaf.view instanceof FileView) {
        if (leaf.view.file?.path === targetFile.path) {
          found = leaf;
        }
      }
    });
    return found;
  }

  /**
   * Intelligently dispatches a file open routing cycle targeting adjacent split editor panes.
   * Leverages active history maps to safely locate the most recently active container view.
   * @param filename The raw target filename text to navigate towards.
   */
  private async openLinkInAdjacentPane(filename: string) {
    const file = this.getFile(filename);
    if (!file) return;

    const centerNote = this.plugin.networkGraph.centerNote;
    if (!centerNote) return;
    
    // Safely reads the concrete absolute file reference mapped to the historical central node
    const oldCenterFile = this.app.vault.getFileByPath(centerNote.path);
    if (!oldCenterFile) return;
    
    // 1. Target the specific layout leaf currently rendering the historical central anchor note
    let targetLeaf = this.findLeafWithFile(oldCenterFile);

    // 2. Fallback: Intercept and recycle the most recently utilized markdown editor leaf pane
    if (!targetLeaf) {
      const recentLeaf = this.app.workspace.getMostRecentLeaf();
      if (recentLeaf && ['empty', 'markdown'].contains(recentLeaf.view.getViewType())){
        targetLeaf = recentLeaf;
      }
    }

    // 3. Ultimate safeguard: Deploy a fresh vertical split workspace view split partition layout
    if (!targetLeaf) {
        targetLeaf = this.app.workspace.getLeaf('split', 'vertical');
    }

    await targetLeaf.openFile(file);
    await this.app.workspace.revealLeaf(targetLeaf);
    await this.setFocusOnSelf();    
  }

  /**
   * Refocuses UI viewport boundaries onto the plugin view container.
   */
  private async setFocusOnSelf() {
    const { workspace } = this.app;
    
    const leaves = this.app.workspace.getLeavesOfType(RV.MYBRAIN_VIEW_TYPE); 
    const targetLeaf = leaves[0];

    if (targetLeaf === undefined) return;
    
    await workspace.revealLeaf(targetLeaf);
    workspace.setActiveLeaf(targetLeaf);
  }

  /**
   * Extracts the most recently focused active markdown document instance from workspace layout maps.
   * Synchronizes via sorting active time properties on open viewports.
   */
  private getMostRecentMarkdownFile(): TFile | null {
    const { workspace } = this.app;
    const mdLeaves = workspace.getLeavesOfType('markdown');
    
    if (mdLeaves.length === 0) return null;

    // TYPESAFE TIMING ACCESS: Defines a localized intersection type 
    // encapsulating the internal activeTime property.
    type TimedLeaf = import("obsidian").WorkspaceLeaf & { activeTime?: number };

    // Sorts open leaf tabs according to internal focus time stamps to isolate the active editor panel
    mdLeaves.sort((a, b) => {
      const timeA = (a as TimedLeaf).activeTime ?? 0;
      const timeB = (b as TimedLeaf).activeTime ?? 0;
      return timeB - timeA;
    });

    const mostRecentLeaf = mdLeaves[0];
    // Cast explicitly to the expanded core MarkdownView to fetch the underlying file securely
    if (mostRecentLeaf && mostRecentLeaf.view instanceof MarkdownView) {
      return mostRecentLeaf.view.file; 
    }

    return null;
  }


   /**
   * Renders the dedicated, minimalist welcome instructional frame inside the view screen.
   * Clears the viewport container entirely to guarantee zero raw node blips under cold starts [dan].
   */
  private displayWelcome() {
    const containerEl = this.areaManager.containerEl;
    containerEl.empty(); // Clears out the lone center node framework perfectly
    
    // Instantiates a clean, localized welcome element cluster using predefined global variables [dan]
    const welcomeDiv = containerEl.createDiv({ cls: "rv-welcome-container" });
    welcomeDiv.createEl("p", { text: RV.WELCOME, cls: "rv-welcome-text" });
  }

  public suspendForBackground() {
    this.isSuspended = true;
    this.clearAllTimers();
    this.areaManager?.cancelPendingRedraw();
    this.teardownDomForSuspend();
  }

  public resumeFromBackground() {
    const now = Date.now();
    if (now - this.lastResumeAt < 500) return;
    this.lastResumeAt = now;

    this.isSuspended = false;
    this.restoreDomAfterSuspend();
    if (!this.isFullyStarted) return;
    const activeFile = this.getMostRecentMarkdownFile();
    if (!activeFile) return;
    void this.onFileChange(activeFile).then(() => {
      this.areaManager?.renderGraph();
    });
  }


  private teardownDomForSuspend() {
    if (this.isDomSuspended) return;
    if (!this.contentEl) return;
    this.contentEl.empty();
    this.isDomSuspended = true;
  }

  private restoreDomAfterSuspend() {
    if (!this.isDomSuspended) return;
    if (!this.contentEl) return;

    // Re-init minimal rendering surface only
    this.areaManager = new AreaManager(this.plugin.networkGraph, this.contentEl, this.plugin);
    this.areaManager.initiate();
    this.isDomSuspended = false;
  }

  private clearAllTimers() {
    if (this.resolveDebounceTimer) window.clearTimeout(this.resolveDebounceTimer);
    if (this.renameDebounceTimer) window.clearTimeout(this.renameDebounceTimer);
    if (this.layoutDebounceTimer) window.clearTimeout(this.layoutDebounceTimer);
    if (this.orientationDebounceTimer) window.clearTimeout(this.orientationDebounceTimer);
    if (this.activeLeafDebounceTimer) window.clearTimeout(this.activeLeafDebounceTimer);
    if (this.visibilityResumeTimer) window.clearTimeout(this.visibilityResumeTimer);

    this.resolveDebounceTimer = null;
    this.renameDebounceTimer = null;
    this.layoutDebounceTimer = null;
    this.orientationDebounceTimer = null;
    this.activeLeafDebounceTimer = null;
    this.visibilityResumeTimer = null;
  }


  // ==========================================================================
  // APPLICATION LIFECYCLE RECEPTORS & HOOKS
  // ==========================================================================

  /**
   * Executed when the view workspace partition leaf is physically mounted.
   * COMPLIANT REFACTOR: Eradicates blind, hardcoded timeouts to achieve instantaneous 
   * data ignition. Conditionality bypasses coldstart gates if indexing is already finalized [dan].
   */
  async onOpen() {
    this.contentEl.empty();
    
    // Instantiates the structural coordinate layout manager natively
    this.areaManager = new AreaManager(this.plugin.networkGraph, this.contentEl, this.plugin);
    this.areaManager.initiate();

    // Bind localized viewport context listeners and gesture bus matrices
    this.registerWorkspaceLayoutChanges();
    this.registerHoverLinkSource();
    this.setupDataReadyHandler();
    this.setupMobileSafeguards();
    this.setupVisibilitySafeguards();
    this.setupInternalLinkHandler();
    this.setupPlusMinusBtnHandler();
    this.setupInfoBtnHandler();
  
    // Enforce the animated welcome mask framework immediately to conceal early node blips
    this.displayWelcome();

    const isCacheReady = (this.app.metadataCache as typeof this.app.metadataCache & { initialized?: boolean }).initialized === true;
    
    if (isCacheReady) {
      // Secure layout tracking variables instantly prior to rendering to block hover loops
      this.isFullyStarted = true;
      this.wasPanelHidden = false; 
      
      const activeFile = this.getMostRecentMarkdownFile();
      if (activeFile) {
        await this.onFileChange(activeFile);
        if (this.areaManager) {
          this.areaManager.renderGraph();
        }
      }
    } else {
      // ==========================================================================
      // COLD-START LIFECYCLE GATE (Fallback for massive hvelv under oppstart):
      // If the cache is still validating vault files, we establish a strict event
      // listener hook that drops the shield only when Obsidian core signals resolution [dan].
      // ==========================================================================
      this.plugin.registerEvent(
        this.app.metadataCache.on('resolved', () => {
          if (this.isFullyStarted) return; 
          
          void (async () => {
            this.isFullyStarted = true; 
            this.wasPanelHidden = false;
            
            const activeFile = this.getMostRecentMarkdownFile();
            if (activeFile) {
              await this.onFileChange(activeFile);
              if (this.areaManager) {
                this.areaManager.renderGraph(); 
              }
            }
          })();
        })
      );
    }
  }

  async onClose() {
    this.clearAllTimers();
    this.areaManager?.cancelPendingRedraw();
    this.teardownDomForSuspend();
    if (this.visibilityObserver) {
      this.visibilityObserver.disconnect();
      this.visibilityObserver = null;
    }
  }

  /**
   * Fuses layout rendering updates when user focuses structural tab partitions.
   * Incorporates an asynchronous breathing delay allowing sliding layout panes to lock calculations.
   */
  private onActiveLeafChanged(leaf: WorkspaceLeaf | null) {
    if (this.isSuspended) return;

    if (leaf && leaf.view instanceof MarkdownView) {
      if (this.areaManager.containerEl.isShown()) {
        this.areaManager.requestRedraw();
      }
      void this.app.workspace.revealLeaf(leaf);
    }
  }

  /**
   * Hot-reloads memory structures when the focused file target changes context.
   * RECONCILED GOLDEN GUARD: Keeps the initial welcome shield intact during cold starts
   * by dropping background file streams until the core application is fully initialized.
   * @param file The targeted TFile record currently being opened or focused.
   */
  async onFileChange(file: TFile | null) {
    if (!file) return;
    if (this.isSuspended) return;

    // HARDWARE INITIALIZATION FILTER: Safeguards the startup visual shield from premature data leaks
    if (!this.isFullyStarted) {
      return; 
    }

    this.currentFilePath = file.path; 
    await this.plugin.networkGraph.update(file); 
  }

  /**
   * Orchestrates the dynamic layout mutation expansion and collapse toggling when a cluster badge is clicked.
   * Modifies inline visibility tokens safely and demands an instant Bezier curve recalculation from AreaManager [dan].
   */
  private onPlusMinusBtnClicked(target: HTMLElement) {
    const plus = RV.PLUS;   
    const minus = RV.MINUS; 

    // Isolates the closest tag group cluster element container currently routing these nodes [dan]
    const groupDiv = target.closest(`.${RV.GROUPS}`) as HTMLElement;
    if (!groupDiv) return;

    // Collects all individual visible cells inside this localized structural cluster wrapper
    const items = Array.from(groupDiv.querySelectorAll('.item'));
    if (items.length <= 1) return;

    const textContent = target.textContent || "";
    const count = items.length.toString();

    const rawTag = target.getAttribute("data-tag") || "";
    const cleanTagName = rawTag.replace(/^#/, "");
      
    // CONFIGURATION A: Active token contains the '+' sign; expand layout elements and toggle label state
    if (textContent.includes(plus)) {
      groupDiv.classList.add('expanded');
      
      // Reveals all nested children nodes within this group by stripping out hidden layout rules
      items.slice(1).forEach(item => item.classList.remove('hidden'));
      target.textContent = `${minus}${cleanTagName}(${count})`;
    } 
    // CONFIGURATION B: Active token contains the '-' sign; collapse elements down to a compact single root cell
    else {
      groupDiv.classList.remove('expanded');
      
      // Conceals secondary index nodes to collapse viewport canvas density
      items.slice(1).forEach(item => item.classList.add('hidden'));      
      target.textContent = `${plus}${cleanTagName}(${count})`;
    }

    // Forces an immediate geometric update pass to recalibrate lines according to new layout height metrics [dan]
    this.areaManager.requestRedraw();
  }

  override onResize() {
    super.onResize();
    this.areaManager.requestRedraw();
  }

  // ==========================================================================
  // VIEW MONITORS & EVENTS REGISTRATION LAYERS
  // ==========================================================================
  
  /**
   * Subscribes to window boundary changes or sidebar dragging.
   * COMPLIANT REFACTOR: Uses lightweight requestRedraw() to safeguard 
   * Obsidian's core drag-and-drop layout pipelines from structural rendering drops [dan].
   */
  private registerWorkspaceLayoutChanges() {

    this.registerEvent(
      this.app.workspace.on('layout-change', () => {
        if (this.isSuspended) return;
        if (!this.isFullyStarted) return; // Drop updates entirely if initialization shield is active

        if (this.layoutDebounceTimer) {
          window.clearTimeout(this.layoutDebounceTimer);
        }

        this.layoutDebounceTimer = window.setTimeout(() => {
          if (this.areaManager) this.areaManager.requestRedraw();
        }, 120);
      })
    );
  }

  
  /**
   * Registers custom view identifiers within Obsidian Core to bind downstream Page Preview modifiers.
   */
  private registerHoverLinkSource() {
    this.plugin.registerHoverLinkSource(RV.MYBRAIN_VIEW_TYPE, {
      display: 'My custom Hover', 
      defaultMod: false,          
    });
  }

  /**
   * Multiview Isolation Bus: Captures central data-ready broadcasts.
   * Evaluates pathway checks to guarantee this specific leaf instance only updates if the broadcasted 
   * file path matches its own tracked active note context [dan]!
   * COMPLIANT REFACTOR: Eradicates recursive onFileChange calls to permanently destroy layout loops [dan].
   */
  private setupDataReadyHandler() {
    type GraphDataReadyBus = {
      on(name: "graph:data-ready", callback: (cleanedPath: unknown) => void): EventRef;
    };

    const workspaceBus = this.app.workspace as unknown as Partial<GraphDataReadyBus>;

    if (workspaceBus.on) {
      this.registerEvent(
        workspaceBus.on("graph:data-ready", (cleanedPath: unknown) => {
          // ===== FIX #2: Type guard for unknown value =====
          // Enforce a strict string type guard to process the pathway safely [dan]
          if (typeof cleanedPath === "string") {
            const activeFile = this.getMostRecentMarkdownFile();
            if (activeFile && activeFile.path === cleanedPath) {
              this.currentFilePath = activeFile.path;
              if (this.areaManager) {
                this.areaManager.renderGraph();
              }
            }
          }
        })
      );
    }
  }

  /**
   * Implements explicit hardware-level layout safeguards optimized for touch screen iOS/Android viewports.
   */
  private setupMobileSafeguards() {
    if (!Platform.isMobile) return;

    // MOBILE DRAWER MONITOR: Intercepts transform mutations to sync vector tracks when drawers settle.
    const leftSplit = this.areaManager.containerEl.closest('.mod-left-split') as HTMLElement;
    if (leftSplit) {
      this.registerDomEvent(leftSplit, 'transitionend', (e: TransitionEvent) => {
        if (e.propertyName === 'transform' || e.propertyName === 'width') {
          this.areaManager.requestRedraw(); 
        }
      });
    }

    // DISORIENTATION COMPENSATION: Recalibrates canvas coordinates on portrait/landscape screen rotation flips
    this.registerDomEvent(window, 'orientationchange', () => {
      if (this.isSuspended) return;
      if (this.orientationDebounceTimer) window.clearTimeout(this.orientationDebounceTimer);
      this.orientationDebounceTimer = window.setTimeout(() => {
        this.areaManager.requestRedraw();
      }, 140);
    });
  }
	
  /**
   * Establishes advanced tracking mechanics guarding view visibility and layout shifts.
   * UNIVERSAL SYNC ENGINE: Captures the exact microsecond the side pane returns from being hidden.
   * PRODUCTION SAFEGUARD: Blocks recursive, self-triggering coldstart loop cascades cleanly [dan].
   */
  private setupVisibilitySafeguards() {
    this.visibilityObserver = new IntersectionObserver((entries) => {
      for (let entry of entries) {
        
        if (entry.isIntersecting) {
          
          // ==========================================================================
          // COLD-START ISOLATION FILTER (Knuser den automatiske evighets-loopen!):
          // If the app is still in its coldstart indexing block, or if the view is 
          // already open and visible on screen, drop this routine completely [dan]!
          // This stops the observer from entering an infinite loop triggered by its 
          // own initial renderGraph() cycles on startup [dan].
          // ==========================================================================
          if (!this.isFullyStarted || !this.wasPanelHidden) {
            return; 
          }

          // Mark the panel as actively open and locked against micro-reflows
          this.wasPanelHidden = false;

          const activeFile = this.getMostRecentMarkdownFile();
          if (activeFile) {
            const harByttetNotatISkjul = activeFile.path !== this.currentFilePath;
            
            if (harByttetNotatISkjul && this.areaManager && this.areaManager.containerEl) {
              this.areaManager.containerEl.className = "view-content rv-container is-calculating";
            }

            const historicalGateState = this.isFullyStarted;
            this.isFullyStarted = true; 
            
            void this.onFileChange(activeFile).then(() => {
              this.areaManager?.renderGraph(); 
            });
          }

          if (this.visibilityResumeTimer) window.clearTimeout(this.visibilityResumeTimer);
          this.visibilityResumeTimer = window.setTimeout(() => {
            if (this.areaManager) this.areaManager.requestRedraw();
          }, 90); 
              
        } else {
          // The panel was physically closed or dragged away; activate the hidden gateway flag
          this.wasPanelHidden = true;
        }
      }
    }, { 
        threshold: 0.1 
    });

    this.visibilityObserver.observe(this.areaManager.containerEl);
    this.register(() => this.visibilityObserver?.disconnect());

    // PANEL SWAP MONITOR
    this.registerEvent(
      this.app.workspace.on('active-leaf-change', (leaf: WorkspaceLeaf | null) => {
        this.onActiveLeafChanged(leaf);
      })
    );
  }

  /**
   * Delegates event capturing onto the view layout wrapper to catch cluster expand clicks.
   */
  private setupPlusMinusBtnHandler() {
    this.contentEl.on("click", `.${RV.PLUS_MINUS_BTN}`, (event, target) => {
      event.preventDefault();
	  if (!target.instanceOf(HTMLElement)) return;
	  this.onPlusMinusBtnClicked(target);
    });
  }

  /**
   * Configures the dynamic floating info satellite badge component.
   * Tracks real-time boundary collision coordinates to fluidly push updates into layout splits.
   * COMPLIANT REFACTOR: Re-anchored locally onto this.contentEl following the hover loop fix [dan].
   */
  private setupInfoBtnHandler() {
    // Volatile instance tracking handling contextual popup lifecycles safely
    let activeInfoPopup: HTMLElement | null = null;

    // INTERACTION HOOK: Hover entry into the target info element triggers absolute metric calculations
    this.contentEl.on("mouseover", ".rv-info-btn", (event, target) => {
      if (!target.instanceOf(HTMLElement)) return;

      if (activeInfoPopup) { 
        activeInfoPopup.remove(); 
        activeInfoPopup = null; 
      }

      const count = target.getAttribute("data-ignored-count") || "0";
      const hoverText = `${count} hidden files`;
 
      activeInfoPopup = createDiv({ cls: RV.INFO_HOVER });
      activeInfoPopup.createSpan({ text: hoverText, cls: "popup-title" });
      
      activeInfoPopup.addClass('is-measuring');
      this.contentEl.appendChild(activeInfoPopup);

      const popupWidth = activeInfoPopup.offsetWidth || 180;
      const viewRect = this.contentEl.getBoundingClientRect();
      const btnRect = target.getBoundingClientRect();
      const padding = 10;

      const vilKrasjePåHøyreSide = (btnRect.right + padding + popupWidth) > viewRect.right;

      if (vilKrasjePåHøyreSide) {
        activeInfoPopup.style.left = `${btnRect.left - viewRect.left - popupWidth - padding}px`;
      } else {
        activeInfoPopup.style.left = `${btnRect.right - viewRect.left + padding}px`;
      }

      activeInfoPopup.style.top = `${btnRect.top - viewRect.top - 15}px`;
      activeInfoPopup.removeClass('is-measuring');
      
    });

    // INTERACTION HOOK: Hover departure sweeps instance trees to prevent application memory leaks
    this.contentEl.on("mouseout", ".rv-info-btn", (event, target) => {
      if (!target.instanceOf(HTMLElement)) return;
      if (activeInfoPopup) {
        activeInfoPopup.remove();
        activeInfoPopup = null;
      }
    });
  }

  // ==========================================================================
  // HYPERLINK ANATOMY & NAVIGATION ADAPTERS
  // ==========================================================================

  public setupInternalLinkHandler() {
    // 1. PRIMARY ELEMENT SELECTION: Single left-click execution triggers navigation flow
    this.contentEl.on("click", ".focusable-note-link", (event, target) => {
      event.preventDefault();
		const path = target.getAttribute("data-link-path");
		if (path) void this.onInternalLinkClicked(path);
    });

    // 2. MOUSEOVER ENGINE: Caches active pointer vectors ahead of keyboard modifier flags
    this.contentEl.on("mouseover", ".focusable-note-link", (event: MouseEvent, target: HTMLElement) => {
      this.lastMouseEvent = event;
      this.lastMouseTarget = target;

      // Fires core Page Preview instantly if the user holds Meta keys preceding pointer boundaries entry
      if (event.metaKey && !target.hasClass('is-hovered')) {
        this.onMouseOverLink(event, target);
        target.addClass('is-hovered');
      }
    });

    // 3. MOUSELEAVE SAFEGUARD: Flushes history trackers when the pointer departs element boundaries
    this.contentEl.on("mouseleave", ".focusable-note-link", (event: MouseEvent, target: HTMLElement) => {
      target.removeClass('is-hovered');
      this.lastMouseEvent = null;
      this.lastMouseTarget = null;
    });

    // 4. KEYDOWN MONITOR: Intercepts active Meta keyboard strokes to invoke hot preview overlays
    this.registerDomEvent(window, "keydown", (event: KeyboardEvent) => {
      if (event.key === "Meta") {
        // Validates if the cursor is physically floating inside current node envelopes using pseudo selectors
        if (this.lastMouseTarget && this.lastMouseTarget.matches(':hover')) {
          if (this.lastMouseEvent && !this.lastMouseTarget.hasClass('is-hovered')) {
            this.onMouseOverLink(this.buildMouseEvent(), this.lastMouseTarget);
            this.lastMouseTarget.addClass('is-hovered');
          }
        }
      }
    });

    // 5. KEYUP MONITOR: Cleans up transient hover highlights instantly when modifiers release
    this.registerDomEvent(window, "keyup", (event: KeyboardEvent) => {
      if (event.key === "Meta") {
        const elements = document.querySelectorAll(".focusable-note-link.is-hovered");
        elements.forEach(el => el.removeClass("is-hovered"));
      }
    });
  }

  /** Compiles a synthetic mouse interface event payload containing explicit metadata tracking params */
  private buildMouseEvent(): MouseEvent {
    return new MouseEvent("mouseover", {
      bubbles: true,
      cancelable: true,
      view: window,
      metaKey: true, 
      ctrlKey: true, 
      clientX: this.lastMouseEvent ? this.lastMouseEvent.clientX : 0, 
      clientY: this.lastMouseEvent ? this.lastMouseEvent.clientY : 0
    });
  }

  /** Dispatches native view preview triggers toward the Obsidian core canvas bus */
  private onMouseOverLink(event: MouseEvent, targetBox: HTMLElement) {
    const linktext = targetBox.getAttribute("data-link-path") || targetBox.getAttribute("data-href");
    const sourcePath = targetBox.getAttribute("data-link-path");

    if (linktext) {
      this.app.workspace.trigger('hover-link', {
        event: event,
        source: RV.MYBRAIN_VIEW_TYPE,
        targetEl: targetBox,
        linktext: linktext,
        sourcePath: sourcePath || linktext,
        hoverParent: this
      });
      
      targetBox.addClass('is-hovered');
    }
  }

  /**
   * Invokes centralized database updates and re-routes active note view trajectories.
   * Redirects target files directly toward adjacent split layout editor partitions.
   * @param internalLink The absolute path string reference selected inside the quadrant grid.
   */
  private async onInternalLinkClicked(internalLink: string): Promise<void> {
    const selectedFile = this.getFile(internalLink);
    if (!selectedFile) return;

    const currentCenter = this.plugin.networkGraph.centerNote;
    if (currentCenter && currentCenter.path === selectedFile.path) {      
      this.areaManager.requestRedraw(); 
      return; 
    }

    // Executes deep navigation pipelines when a fresh node block layout switch occurs
    await this.openLinkInAdjacentPane(internalLink);
    await this.onFileChange(selectedFile);
    this.areaManager.renderGraph();
  }
}
