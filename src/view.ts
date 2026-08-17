import myBrainPlugin from './main.js';
import { HoverPopover, TFile, WorkspaceLeaf, HoverParent, MarkdownView, FileView, Platform, ItemView, App, EventRef, debounce, Debouncer } from 'obsidian';
import { AreaManager } from './AreaManager.js';
import { RV } from './constants.js';

export class MyBrainView extends ItemView implements HoverParent {

  // #region DECLARATIONS
  private plugin: myBrainPlugin;
  app: App;
  public areaManager!: AreaManager;
  
  currentFilePath: string = ""; // Tracks the unique file path this window is presently displaying
  private lastMouseEvent: MouseEvent | null = null;
  private lastMouseTarget: HTMLElement | null = null;
  public hoverPopover: HoverPopover | null = null;

  /**
   * Centralized Debouncer registry.
   * Tailored to protect workspace boundaries and stabilize view lifecycle hops.
   */
  private debouncedLayout: Debouncer<[], void>;
  private debouncedOrientation: Debouncer<[], void>;
  private debouncedActiveLeaf: Debouncer<[], void>;
  private debouncedVisibilityResume: Debouncer<[], void>;
  private debouncedResolve: Debouncer<[], void>;

  private isDomSuspended: boolean = false;
  
  
  private lastResumeAt = 0;
  private visibilityObserver: IntersectionObserver | null = null;
  
  // Public visibility state constraint protecting viewport boundaries from early lifecycle pops.
  public isFullyStarted: boolean = false;
  public isSuspended: boolean = false;
  
  // DEBOUNCE LOOP TRACKER: Tracks dynamic workspace visibility state transitions.
  // Set to true by default to force a clean, definitive re-sync pass on initial boots [dan]!
  private wasPanelHidden: boolean = true;
  // #endregion

  public getDisplayText(): string {return RV.DISPLAY_TEXT; }
  public getViewType(): string { return RV.VIEW_TYPE; }
  override getIcon(): string { return RV.ICON; } // Returns your constant (e.g., 'sparkle')
  
  // #region LIFETIME METHODS
  constructor(leaf: WorkspaceLeaf, plugin: myBrainPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.app = plugin.app;
  
    /** 
     * Initialize all lifecycle and state debouncers.
     * Intervals are micro-optimized based on structural execution weight.
     * Binding execution context ensures strict variable access within implementation targets.
     */
    this.debouncedLayout = debounce(this.executeLayoutRefresh.bind(this), 60, true);
    this.debouncedOrientation = debounce(this.executeOrientationChange.bind(this), 100, true);
    this.debouncedActiveLeaf = debounce(this.executeActiveLeafChange.bind(this), 50, true);
    this.debouncedVisibilityResume = debounce(this.executeVisibilityResume.bind(this), 120, true);
    this.debouncedResolve = debounce(this.executeResolve.bind(this), 120, true);
  }
  
  override onResize() {
    super.onResize();
    this.areaManager.requestRedraw();
  }

  /**
   * Executed when the view workspace partition leaf is physically mounted.
   * APPLIED LISTENERS: 
   * - registerWorkspaceLayoutChanges ('layout-change')
   * - registerHoverLinkSource(registerHoverLinkSource)
   * - setupDataReadyHandler( registerEvent(workspaceBus.on("graph:data-ready",...)
   * - setupMobileSafeguards ( 
   *   A. registerDomEvent(leftSplit, 'transitionend' ...)
   *   B. registerDomEvent(window, 'orientationchange'...)
   * - setupVisibilitySafeguards 
   *   C. (IntersectionObserver ... entry.isIntersecting ...)
   *   D. registerEvent( 'active-leaf-change')
   * - setupInternalLinkHandler
   *   E. (.on('click', ..) , .on('mouseover'),  .on('mouseleave'), 
   *   F.  registerDomEvent(window, 'keydown' ... , window, 'keyup') 
   */
  async onOpen() {
    this.contentEl.empty();
    
    this.areaManager = new AreaManager(this.plugin.networkGraph, this.contentEl, this.plugin);
    this.areaManager.initiate();

    // Bind localized viewport context listeners and gesture bus matrices
    this.registerWorkspaceLayoutChanges();
    this.registerHoverLinkSource();
    this.setupDataReadyHandler(); // Ensure this calls areaManager.renderGraph() on 'graph:data-ready'
    this.setupMobileSafeguards();
    this.setupVisibilitySafeguards();
    this.setupInternalLinkHandler();
  
    // Enforce the animated welcome mask framework immediately to conceal early node blips
    this.displayWelcome();

    const isCacheReady = (this.app.metadataCache as typeof this.app.metadataCache & { initialized?: boolean }).initialized === true;
    
    if (isCacheReady) {
      // Secure layout tracking variables instantly prior to rendering to block hover loops
      this.isFullyStarted = true;
      this.wasPanelHidden = false; 
      
      const activeFile = this.getMostRecentMarkdownFile();
      if (activeFile) {
        // Sync the file. NetworkGraph's internal debounce will fire 'graph:data-ready' when done.
        this.onFileChange(activeFile);
      }
    } else {
      // Synchronize graph activation with background cache initialization events
      this.registerEvent(
        this.app.metadataCache.on('resolved', () => {
          if (this.isFullyStarted) return; 
          
          /** 
           * Fire the resolve debouncer. 
           * It gathers up cascading resolution blips and executes safely once.
           */
          this.debouncedResolve();
        })
      );
    }
  }

  async onClose() {
    /** 
     * STAGE 1: EMERGENCY BRAKE (CRITICAL)
     * Cancel all pending asynchronous and debounced tasks immediately.
     * Prevents mid-flight execution loops from firing on a destroyed DOM context.
     */
    this.cancelAllDebouncers(); 
    this.plugin.networkGraph.cancel(); 

    /** 
     * STAGE 2: VISUAL COMPONENT TEARDOWN
     * Triggers AreaManager's full internal destructor sequence [dan].
     * Cancels debounced renders, flushes SVG path caches, and wipes floating info popups [dan].
     */
    this.areaManager?.destroy(); 

    /** 
     * STAGE 3: DOM EVACUATION
     * Safely empty container elements to free up memory trees.
     */
    this.teardownDomForSuspend();

    /** 
     * STAGE 4: HARDWARE OBSERVATION DISCONNECT
     * Clean up screen detection tracking layers completely.
     */
    if (this.visibilityObserver) {
      this.visibilityObserver.disconnect();
      this.visibilityObserver = null;
    }
  }

  public suspendForBackground() {
    this.isSuspended = true;
    this.cancelAllDebouncers();
    this.plugin.networkGraph.cancel();

    this.areaManager?.destroy();
    this.teardownDomForSuspend();
  }

  public resumeFromBackground() {
    const now = Date.now();
    /** Throttle fast accidental double-resume triggers */
    if (now - this.lastResumeAt < 1200) return;
    this.lastResumeAt = now;

    this.isSuspended = false;
    this.restoreDomAfterSuspend();
    if (!this.isFullyStarted) return;

    const activeFile = this.getMostRecentMarkdownFile();
    if (!activeFile) return;
    
    //This lets the workspace/WebView settle safely before rebuilding the graph.
    void this.debouncedVisibilityResume();
  }

  /**
   * Hot-reloads memory structures when the focused file target changes context.
   * @param file The targeted TFile record currently being opened or focused.
   */
  public onFileChange(file: TFile | null) {
    if (!file || this.isSuspended || !this.isFullyStarted) return;

    this.currentFilePath = file.path; 
    
    /** 
     * Synchronous fire-and-forget: triggers the NetworkGraph debounce layer.
     * Rendering is deferred until the global 'graph:data-ready' ecosystem event is triggered.
     */
    this.plugin.networkGraph.update(file);
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

  private cancelAllDebouncers() {
    this.debouncedLayout.cancel();
    this.debouncedOrientation.cancel();
    this.debouncedActiveLeaf.cancel();
    this.debouncedVisibilityResume.cancel();
    this.debouncedResolve.cancel(); 
  }
  // #endregion


  // #region WINDOW HANDLING
  /**
   * Fuses layout rendering updates when user focuses structural tab partitions.
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
   * Implementation target for debouncedActiveLeafChange.
   */
  private executeActiveLeafChange(): void {
    if (this.isSuspended || !this.isFullyStarted) return;

    const activeFile = this.getMostRecentMarkdownFile();
    if (activeFile && activeFile.path !== this.currentFilePath) {
      this.onFileChange(activeFile);
    }
  }

  private executeResolve(): void {
    if (this.isFullyStarted) return; 

    this.isFullyStarted = true; 
    this.wasPanelHidden = false;
      
    const activeFile = this.getMostRecentMarkdownFile();
    if (activeFile) {
      this.onFileChange(activeFile);
    }
  }

  /**
   * The actual implementation target for debouncedVisibilityResume.
   */
  private async executeVisibilityResume(): Promise<void> {
    if (this.isSuspended) return;

    const activeFile = this.getMostRecentMarkdownFile();
    if (!activeFile) return;

    // Synchronous fire-and-forget: pushes the file change event to NetworkGraph.
    this.onFileChange(activeFile);
    
    // Safety redraw after resume/background transitions (macOS fullscreen overlap + iOS app switch)
    window.requestAnimationFrame(() => {
      this.areaManager?.requestRedraw();
    });
  }

  /**
   * Implementation target for debouncedLayout.
   */
  private executeLayoutRefresh(): void {
    if (this.areaManager) {
      this.areaManager.requestRedraw();
    }
  }

  /**
   * Implementation target for debouncedOrientation.
   */
  private executeOrientationChange(): void {
    if (this.areaManager) {
      this.areaManager.requestRedraw();
    }
  }
// #endregion


  // #region REGISTER & SETUP
  /**
   * Subscribes to window boundary changes or sidebar dragging.
   * COMPLIANT REFACTOR: Uses lightweight requestRedraw() to safeguard 
   * Obsidian's core drag-and-drop layout pipelines from structural rendering drops [dan].
   */
  private registerWorkspaceLayoutChanges() {
    this.registerEvent(
      this.app.workspace.on('layout-change', () => {
        if (this.isSuspended || !this.isFullyStarted) return;

        /** Dispatch the task directly to the localized layout debouncer */
        this.debouncedLayout();
      })
    );
  }
  
  /**
   * Registers custom view identifiers within Obsidian Core to bind downstream Page Preview modifiers.
   */
  private registerHoverLinkSource() {
    this.plugin.registerHoverLinkSource(RV.VIEW_TYPE, {
      display: 'My custom Hover', 
      defaultMod: false,          
    });
  }

  /**
   * Multiview Isolation Bus: Captures central data-ready broadcasts.
   */
  private setupDataReadyHandler() {
    type GraphDataReadyBus = {
      on(name: "graph:data-ready", callback: (cleanedPath: unknown) => void): EventRef;
    };

    const workspaceBus = this.app.workspace as unknown as Partial<GraphDataReadyBus>;
    if (workspaceBus.on) {
      this.registerEvent(
        workspaceBus.on("graph:data-ready", (cleanedPath: unknown) => {
          if (typeof cleanedPath === "string") {
            const activeFile = this.app.workspace.getActiveFile();
            if (activeFile && activeFile.path === cleanedPath) {
              this.currentFilePath = activeFile.path;

              /** 
               * The calculation loop has finished successfully.
               * We can now safely rebuild the DOM tree framework.
               */
              this.areaManager?.renderGraph();
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
      
      /** Fire the orientation debouncer */
      this.debouncedOrientation();
    });
  }

  /**
   * Establishes advanced tracking mechanics guarding view visibility and layout shifts.
   */
  private setupVisibilitySafeguards() {
    this.visibilityObserver = new IntersectionObserver((entries) => {
      for (let entry of entries) {
        if (entry.isIntersecting) {
          if (!this.isFullyStarted || !this.wasPanelHidden) {
            return; 
          }

          this.wasPanelHidden = false;

          const activeFile = this.getMostRecentMarkdownFile();
          if (activeFile) {
            const noteHasBeenSwitched = activeFile.path !== this.currentFilePath;
            
            if (noteHasBeenSwitched && this.areaManager && this.areaManager.containerEl) {
              this.areaManager.containerEl.className = "view-content rv-container is-calculating";
            }

            this.isFullyStarted = true; 
            
            // synchronous call (fire-and-forget): This triggers graph-calculation behind the scenes.
            // When finished, 'graph:data-ready' will trigger renderGraph().
            this.onFileChange(activeFile);
          }

          /** Trigger the visibility resume debouncer */
          void this.debouncedVisibilityResume();
              
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
   * Comprehensive Event Hub orchestrating active hyperlink routing and native page preview bindings.
   * Leverages explicit tracking structures to mirror native Obsidian hover popover lifecycles.
   */
  private setupInternalLinkHandler() {
    // 1. PRIMARY ELEMENT SELECTION: Single left-click execution triggers navigation flow
    this.contentEl.on('click', ".focusable-note-link", (event: MouseEvent, target: HTMLElement) => {
      event.preventDefault();
      const path = target.getAttribute("data-link-path");
      if (path) void this.onInternalLinkClicked(path);
    });

    // 2. MOUSEOVER ENGINE: Caches active pointer vectors ahead of keyboard modifier flags
    this.contentEl.on('mouseover', ".focusable-note-link", (event: MouseEvent, target: HTMLElement) => {
      this.lastMouseEvent = event;
      this.lastMouseTarget = target;

      if (event.metaKey && !target.hasClass('is-hovered')) {
        this.onMouseOverLink(event, target);
        target.addClass('is-hovered');
      }
    });

    // 3. MOUSELEAVE SAFEGUARD: Flushes history trackers when the pointer departs element boundaries
    this.contentEl.on('mouseleave', ".focusable-note-link", (event: MouseEvent, target: HTMLElement) => {
      target.removeClass('is-hovered');
      this.lastMouseEvent = null;
      this.lastMouseTarget = null;
    });

    // 4. KEYDOWN MONITOR: Intercepts active Meta keyboard strokes to invoke hot preview overlays
    this.registerDomEvent(window, 'keydown', (event: KeyboardEvent) => {
      if (event.key === "Meta" || event.key === "Control") { // Added Control key fallback for Windows users
        if (this.lastMouseTarget && this.lastMouseTarget.matches(':hover')) {
          if (this.lastMouseEvent && !this.lastMouseTarget.hasClass('is-hovered')) {
            this.onMouseOverLink(this.buildMouseEvent(), this.lastMouseTarget);
            this.lastMouseTarget.addClass('is-hovered');
          }
        }
      }
    });

    // 5. KEYUP MONITOR: Cleans up transient hover highlights instantly when modifiers release
    this.registerDomEvent(window, 'keyup', (event: KeyboardEvent) => {
      if (event.key === "Meta" || event.key === "Control") {
        const elements = this.contentEl.querySelectorAll(".focusable-note-link.is-hovered");
        elements.forEach(el => el.classList.remove("is-hovered"));
      }
    });
  }

  /** Compiles a synthetic mouse interface event payload containing explicit metadata tracking params */
  private buildMouseEvent(): MouseEvent {
    return new MouseEvent('mouseover', {
      bubbles: true,
      cancelable: true,
      view: window,
      metaKey: true, 
      ctrlKey: true, 
      clientX: this.lastMouseEvent ? this.lastMouseEvent.clientX : 0, 
      clientY: this.lastMouseEvent ? this.lastMouseEvent.clientY : 0
    });
  }
  // #endregion


// #region private GENERAL METHODS

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

  /**
   * Refocuses UI viewport boundaries onto the plugin view container.
   */
  private async setFocusOnSelf() {
    const { workspace } = this.app;
    
    const leaves = this.app.workspace.getLeavesOfType(RV.VIEW_TYPE); 
    const targetLeaf = leaves[0];

    if (targetLeaf === undefined) return;
    
    await workspace.revealLeaf(targetLeaf);
    workspace.setActiveLeaf(targetLeaf);
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

    /** 1. Executes deep navigation pipelines to open the file in the split editor pane */
    await this.openLinkInAdjacentPane(internalLink);

    /** 
     * 2. Synchronous fire-and-forget: triggers the NetworkGraph calculation debounce engine.
     * Re-rendering is safely decoupled and deferred until the background calculation 
     * finishes and broadcasts the global 'graph:data-ready' event.
     */
    this.onFileChange(selectedFile);
  }

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

  /** Dispatches native view preview triggers toward the Obsidian core canvas bus */
  private onMouseOverLink(event: MouseEvent, targetBox: HTMLElement) {
    const linktext = targetBox.getAttribute("data-link-path") || targetBox.getAttribute("data-href");
    const sourcePath = targetBox.getAttribute("data-link-path");

    if (linktext) {
      this.app.workspace.trigger('hover-link', {
        event: event,
        source: RV.VIEW_TYPE,
        targetEl: targetBox,
        linktext: linktext,
        sourcePath: sourcePath || linktext,
        hoverParent: this
      });
      
      targetBox.addClass('is-hovered');
    }
  }
  // #endregion

}
