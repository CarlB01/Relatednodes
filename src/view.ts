import RelatednotesPlugin from './main.js';
import { HoverPopover, TFile, WorkspaceLeaf, HoverParent, MarkdownView, FileView, Platform, ItemView, TAbstractFile, App} from 'obsidian';
import { AreaManager } from './AreaManager.js';
import { RV } from './constants.js';

export class RelatednotesView extends ItemView implements HoverParent {

  private plugin: RelatednotesPlugin;
  app: App;
  public areaManager!: AreaManager;
  
  private currentFilePath: string = ""; // Tracks the unique file path this window is presently displaying
  private lastMouseEvent: MouseEvent | null = null;
  private lastMouseTarget: HTMLElement | null = null;
  public hoverPopover: HoverPopover | null = null;
  public resolveDebounceTimer: NodeJS.Timeout | null = null; 

  /** Public visibility state constraint protecting viewport boundaries from early lifecycle pops */
  public isFullyStarted: boolean = false;

  constructor(leaf: WorkspaceLeaf, plugin: RelatednotesPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.app = plugin.app;
  }

  // ==========================================================================
  // VIEW IDENTIFIERS & META ATTRIBUTES
  // ==========================================================================
  
  getViewType(): string { return RV.RELATED_NOTES_VIEW_TYPE; }
  getDisplayText(): string { return "Related Notes"; }

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
        const aliases = cache?.frontmatter?.aliases;

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

    const centerNote = this.plugin.relatedData.centerNote;
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
    this.setFocusOnSelf();    
  }

  /**
   * Refocuses UI viewport boundaries onto the plugin view container.
   */
  private async setFocusOnSelf() {
    const { workspace } = this.app;
    
    const leaves = this.app.workspace.getLeavesOfType(RV.RELATED_NOTES_VIEW_TYPE); 
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

    // Sorts open leaf tabs according to internal focus time stamps to isolate the active editor panel
    mdLeaves.sort((a, b) => {
      const timeA = (a as any).activeTime ?? 0;
      const timeB = (b as any).activeTime ?? 0;
      return timeB - timeA;
    });

    const mostRecentLeaf = mdLeaves[0];
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
    console.log('displayWelcome er fullført!')
  }

  // ==========================================================================
  // APPLICATION LIFECYCLE RECEPTORS & HOOKS
  // ==========================================================================

/**
   * Executed when the view workspace partition leaf is physically mounted.
   * Instantiates geometrical layout controllers and seals structural cold-start execution gates.
   */
  async onOpen() {
    this.contentEl.empty();
    this.areaManager = new AreaManager(this.plugin.relatedData, this.contentEl, this.plugin);
    this.areaManager.initiate();

    this.registerWorkspaceLayoutChanges();
    this.registerHoverLinkSource();
    this.setupDataReadyHandler();
    this.setupMobileSafeguards();
    this.setupVisibilitySafeguards();
    this.setupInternalLinkHandler();
    this.setupPlusMinusBtnHandler();
    this.setupInfoBtnHandler();
  
    // Enforce an absolute visual shield immediately to mask historical disk layout data
    this.displayWelcome();

    // COLD-START LIFECYCLE GATE: Fires exclusively when Obsidian Core database scanning loops conclude
    this.plugin.registerEvent(
      this.app.metadataCache.on('resolved', async () => {
        if (this.isFullyStarted) return; 
        
        // Open the primary execution gate now that the 20,000 items metadata matrix is fully ready
        this.isFullyStarted = true; 
        
        const activeFile = this.getMostRecentMarkdownFile();
        if (activeFile) {
          // Triggers data hydration pass only after the security perimeter is verified open
          await this.onFileChange(activeFile);
          this.areaManager.renderGraph(); 
        }
      })
    );

    // WARM-START LIFECYCLE FALLBACK: Safe initialization sequence fallback if view opens long post startup
    setTimeout(async () => {
      const isCacheReady = (this.app.metadataCache as typeof this.app.metadataCache & { initialized?: boolean }).initialized === true;
      if (isCacheReady && !this.isFullyStarted) {
        this.isFullyStarted = true;
        const activeFile = this.getMostRecentMarkdownFile();
        if (activeFile) {
          await this.onFileChange(activeFile);
          this.areaManager.renderGraph();
        }
      }
    }, 2000); 
  }

  async onClose() {
    // Structural termination hook ready for down-stream allocations
  }

  /**
   * Fuses layout rendering updates when user focuses structural tab partitions.
   * Incorporates an asynchronous breathing delay allowing sliding layout panes to lock calculations.
   */
  private onActiveLeafChanged(leaf: WorkspaceLeaf | null) {
    if (leaf && leaf.view instanceof MarkdownView) {
      if (this.areaManager.containerEl.isShown()) {
        setTimeout(() => {
          this.areaManager.requestRedraw();
        }, 150); 
      }
      this.app.workspace.revealLeaf(leaf);
    }
  }

  /**
   * Hot-reloads memory structures when the focused file target changes context.
   * COMPLETED ENTRY GUARD: Drops any background file streams unless the application state is fully started.
   */
  async onFileChange(file: TFile | null) {
    if (!file) return;

    // HARDWARE INITIALIZATION FILTER: Blocks incoming streams from rasering the welcome jernteppe
    if (!this.isFullyStarted) {
      return; 
    }

    this.currentFilePath = file.path; 
    await this.plugin.relatedData.update(file); 
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
    const items = Array.from(groupDiv.querySelectorAll('.item')) as HTMLElement[];
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
   * IMPROVED DEBOUNCE: Prevents recursive loops caused by yieldIfRightTall modifications [dan].
   */
  private registerWorkspaceLayoutChanges() {
    let layoutDebounceTimer: NodeJS.Timeout | null = null;

    this.registerEvent(
      this.app.workspace.on('layout-change', () => {
        if (!this.isFullyStarted) return; // Drop updates entirely if initialization shield is active

        if (layoutDebounceTimer) {
          clearTimeout(layoutDebounceTimer);
        }
        
        layoutDebounceTimer = setTimeout(() => {
          if (this.areaManager) {
            this.areaManager.requestRedraw();
          }
        }, 200);
      })
    );
  }
  
  /**
   * Registers custom view identifiers within Obsidian Core to bind downstream Page Preview modifiers.
   */
  private registerHoverLinkSource() {
    this.plugin.registerHoverLinkSource(RV.RELATED_NOTES_VIEW_TYPE, {
      display: 'My custom Hover', 
      defaultMod: false,          
    });
  }

  /**
   * Multiview Isolation Bus: Captures central data-ready broadcasts.
   * Evaluates pathway checks to guarantee this specific leaf instance only updates if the broadcoasted 
   * file path matches its own tracked active note context [dan]!
   */
  private setupDataReadyHandler() {
    this.plugin.registerEvent(
      this.app.workspace.on("related:data-ready" as any, ((vasketPath: string) => {
        if (vasketPath === this.currentFilePath && this.areaManager) {
          this.areaManager.renderGraph(); 
        }
      }) as any) 
    );
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
      setTimeout(() => {
          this.areaManager.requestRedraw();
      }, 200); 
    });
  }
	
  /**
   * Establishes advanced tracking mechanics guarding view visibility and layout shifts.
   */
  private setupVisibilitySafeguards() {
    // LAYOUT ENTRY DETECTOR: Evaluates exactly when the side panel container enters visible screen fractions
    const visibilityObserver = new IntersectionObserver((entries) => {
      for (let entry of entries) {
        if (entry.isIntersecting) {
          // Introduces a micro-timeout shielding calculations from animation stutter [dan]
          setTimeout(() => {
            // Defers rendering calculations until the main thread loop becomes entirely idle
            if ('requestIdleCallback' in window) {
                window.requestIdleCallback(() => {
                  this.areaManager.requestRedraw();
                }, { timeout: 200 }); 
            } else {
                this.areaManager.requestRedraw();
            }
          }, 150); 
        }
      }
    }, { 
        threshold: 0.1 
    });

    visibilityObserver.observe(this.areaManager.containerEl);
    this.register(() => visibilityObserver.disconnect());

    // PANEL SWAP MONITOR: Refreshes vector paths when user focus switches between leaf workspace partitions
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
      if (!target || !(target instanceof HTMLElement)) return;
      this.onPlusMinusBtnClicked(target);
    });
  }

  /**
   * Configures the dynamic floating info satellite badge component.
   * Tracks real-time boundary collision coordinates to fluidly push updates into layout splits.
   */
  private setupInfoBtnHandler() {
    // Volatile instance tracking handling contextual popup lifecycles safely
    let activeInfoPopup: HTMLElement | null = null;

    // INTERACTION HOOK: Hover entry into the target info element triggers absolute metric calculations
    this.contentEl.on("mouseover", ".rv-info-btn", (event, target) => {
      if (!target || !(target instanceof HTMLElement)) return;

      if (activeInfoPopup) { 
        activeInfoPopup.remove(); 
        activeInfoPopup = null; 
      }

      // Extract raw data fields stamped during layout quadrant formatting
      const count = target.getAttribute("data-ignored-count") || "0";
      const hoverText = `${count} hidden files`;
 
      // Compile virtual popover DOM tree inside memory slots
      activeInfoPopup = createDiv({ cls: RV.INFO_HOVER });
      activeInfoPopup.createSpan({ text: hoverText, cls: "popup-title" });
      
      // Enforce rigid baseline style configurations mapping global application styles
      activeInfoPopup.style.position = "absolute";
      
      // GEOMETRICAL COMPENSATOR: Sets viewport mask to invisible for a single microsecond to extract bounds
      activeInfoPopup.style.visibility = "hidden";
      this.contentEl.appendChild(activeInfoPopup);

      const popupWidth = activeInfoPopup.offsetWidth || 180;
      const viewRect = this.contentEl.getBoundingClientRect();
      const btnRect = target.getBoundingClientRect();
      const padding = 10;

      // Boundary collision detector evaluating horizontal canvas spatial overflow clearances
      const vilKrasjePåHøyreSide = (btnRect.right + padding + popupWidth) > viewRect.right;

      if (vilKrasjePåHøyreSide) {
        activeInfoPopup.style.left = `${btnRect.left - viewRect.left - popupWidth - padding}px`;
      } else {
        activeInfoPopup.style.left = `${btnRect.right - viewRect.left + padding}px`;
      }

      // Align vertical coordinates flush on the Y-axis intersecting toggle positions
      activeInfoPopup.style.top = `${btnRect.top - viewRect.top - 15}px`;
      activeInfoPopup.style.visibility = "visible";
      
      target.addClass('is-hovered');
    });

    // INTERACTION HOOK: Hover departure sweeps instance trees to prevent application memory leaks
    this.contentEl.on("mouseout", ".rv-info-btn", (event, target) => {
      if (target) target.removeClass('is-hovered');
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
      if (path) this.onInternalLinkClicked(path);
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
        source: RV.RELATED_NOTES_VIEW_TYPE,
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

    const currentCenter = this.plugin.relatedData.centerNote;
    if (currentCenter && currentCenter.path === selectedFile.path) {      
      this.areaManager.requestRedraw(); 
      return; 
    }

    // Executes deep navigation pipelines when a fresh node block layout switch occurs
    this.openLinkInAdjacentPane(internalLink);
    await this.onFileChange(selectedFile);
    this.areaManager.renderGraph();
  }
}
