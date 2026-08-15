import { NetworkGraph } from "./NetworkGraph.js";
import { Node } from "./Node.js";
import { debounce, Debouncer, Platform, Point } from "obsidian";
import { DrawingUtils } from "./DrawingUtils.js";
import { Gate } from "./Gate.js";
import { RV } from "./constants.js";
import MyBrainPlugin from "./main.js";

export class AreaManager {
  containerEl: HTMLElement;

  backContainerSVG!: SVGSVGElement;
  center!: HTMLElement;
  left!: HTMLElement;
  right!: HTMLElement;
  upper!: HTMLElement;
  lower!: HTMLElement;

  private graph: NetworkGraph;
  private plugin: MyBrainPlugin;

  // Centralized memory cache for the active SVG path lines
  public linkCache = new Map<string, { svgElement: SVGPathElement; used: boolean }>();

  private animationFrameId: number | null = null;
  private redrawQueued = false;

  private debouncedRender: Debouncer<[], void>;
  private activeInfoPopup: HTMLElement | null = null;
  private plusMinusBound = false;

  constructor(
    graph: NetworkGraph,
    parentEl: HTMLElement,
    plugin: MyBrainPlugin
  ) {
    this.graph = graph;
    this.containerEl = parentEl;
    this.plugin = plugin;

    /**
     * Debounce the heavy DOM reconstruction layer.
     * Prevents rapid successive data-ready events from causing UI flickering.
     * 40ms is a tight window that shields the DOM while remaining perceptually instant.
     */
    this.debouncedRender = debounce(this.executeRenderGraph.bind(this), 40, true );
  }

  initiate() {
    this.containerEl.addClass(RV.CONTAINER);
    this.setupPlusMinusBtnHandler(); // bind once
    this.setupInfoBtnHandler(); 
  }

  // #region PUBLIC METHODS
  /**
   * Schedules a fresh redraw synchronized with the hardware screen refresh rate (60Hz).
   * Automatically triggered by scroll vents, window resizing, and following initial DOM injection.
   */
  public requestRedraw() {
    if (this.redrawQueued) return;
    this.redrawQueued = true;

    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
    }

    // 2x rAF: first paint settles layout, second reads geometry and draws lines
    this.animationFrameId = window.requestAnimationFrame(() => {
      this.animationFrameId = window.requestAnimationFrame(() => {
        this.redrawQueued = false;
        this.animationFrameId = null;

        if (!this.containerEl || !this.containerEl.isConnected) return;
        const rect = this.containerEl.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;

        this.yieldIfLeftTall();
        this.yieldIfRightTall();

        if (this.graph?.centerNote) {
          this.drawAllGraphLines();
        }
      });
    });
  }

  /**
   * Public entry point to build or rebuild the visual graph interface.
   * Safely throttles consecutive rendering storms via Obsidian's debounce engine.
   */
  public renderGraph(): void {
    if (this.plugin.isAppPaused()) return;
    this.debouncedRender();
  }

  /**
   * Safe lifecycle teardown to abort pending rendering pipelines on view destruction.
   */
  public cancelPendingRedraw() {
    this.debouncedRender.cancel(); // Cleans up the Obsidian timer reference
    
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    this.redrawQueued = false;
  }

  /**
   * Public destructor called when the parent view layout collapses or closes.
   */
  public destroy() {
    /** 1. Stop the 40ms DOM render debouncer */
    this.debouncedRender.cancel();
    
    /** 2. Abort the 2x rAF hardware animation loops immediately */
    this.cancelPendingRedraw(); // 💡 Her lever den i beste velgående!
    
    /** 3. Clear out the cached SVG Bezier lines */
    this.linkCache.clear();
    
    /** 4. Wipe any visible floating info popups from the screen */
    this.cleanupPopup(); 
  }
  // #endregion


  // #region GRAPH METHODS
  /**
   * The actual, isolated DOM injection and layout compilation core.
   * Runs safely within the debounced execution window.
   * Renders the comprehensive network graph across all quadrants symmetrically.
   * Leverages a hardware-accelerated rendering shield class ("is-calculating") to isolate the DOM tree.
   * Prevents layout-level reflows, column-squeezing, and flickering cycles while element blocks are generated.
   */
  private executeRenderGraph(): void {  
    const centerNote = this.graph.centerNote;
    if (!centerNote) return;

    const graph = this.graph;
    const mainContainer = this.containerEl;

    /** Safety boundary: ensure container is still mounted in the Obsidian workspace */
    if (!mainContainer || !mainContainer.isConnected) return;
    
    mainContainer.empty();
    
    // ==========================================================================
    // GEOMETRIC RENDERING SHIELD (Off-Screen Document Matrix Gating)
    // Injects structural state token preventing Chromium layout engines from 
    // computing visual row mutations while the cluster nodes populate in the dark.
    // ==========================================================================
    mainContainer.className = "view-content rv-container is-calculating";

    const fragment = createFragment();
    
    mainContainer.setAttribute(RV.LEFT_TALL, 'false');
    mainContainer.setAttribute(RV.RIGHT_TALL, 'false');

    mainContainer.setAttribute(RV.LEFT_TALL, 'false');
    mainContainer.setAttribute(RV.RIGHT_TALL, 'false');

    this.center = fragment.createDiv({ cls: RV.AREA_CENTER });
    this.left = fragment.createDiv({ cls: RV.AREA_LEFT });
    this.right = fragment.createDiv({ cls: RV.AREA_RIGHT });
    this.upper = fragment.createDiv({ cls: RV.AREA_TOP });
    this.lower = fragment.createDiv({ cls: RV.AREA_BOTTOM });

    this.backContainerSVG = fragment.createSvg("svg", { cls: RV.SVG_LAYER });

    // 0. CENTER CORE NODE
    this.renderQuadrant(this.center, [[centerNote]], "center");
    this.renderInfoBtnForCenterNode();

    // 1. UPPER AREA (Verified parent entities)
    const cleanParentsOnly = Array.from(centerNote.relations.parents).filter(n => n.relation === "parent");
    const sortedParents = graph.getSortedNotesForQuadrant(cleanParentsOnly, false);
    this.renderQuadrant(this.upper, [sortedParents], "upper");

    // 2. LEFT AREA (Verified lateral friend entities)
    const cleanFriendsOnly = Array.from(centerNote.relations.friends).filter(n => n.relation === "friend");
    const sortedFriends = graph.getSortedNotesForQuadrant(cleanFriendsOnly, false);
    this.renderQuadrant(this.left, [sortedFriends], "left");

    // 3. LOWER AREA (Tier 1: Explicit target children. Tier 2: Core baseline undefined mappings)
    const allNotesInCache = Array.from(graph.noteCache.values()).filter(n => n.isUsed);
    const childrenOnly = graph.getSortedNotesForQuadrant(allNotesInCache.filter(n => n.relation === "child"), false);
    const totalUndefinedBucket = graph.getSortedNotesForQuadrant(allNotesInCache.filter(n => n.relation === "undefined"), false);
    const lowerCollections = [childrenOnly, totalUndefinedBucket].filter(c => c.length > 0);
    this.renderQuadrant(this.lower, lowerCollections, "lower");

    // 4. RIGHT AREA (Tier 1: Metadata-verified siblings. Tier 2: Bodytext contextual siblings)
    const siblings = graph.getSortedNotesForQuadrant(allNotesInCache.filter(n => n.relation === "sibling"), true);
    const undefinedSiblings = graph.getSortedNotesForQuadrant(allNotesInCache.filter(n => n.relation === "undefined-sibling"), true);
    const siblingCollections = [siblings, undefinedSiblings].filter(c => c.length > 0);
    this.renderQuadrant(this.right, siblingCollections, "right");

    mainContainer.appendChild(fragment);

    // Binds event listeners directly to the initialized layout container frames
    this.setupScrollEventListeners();
    
    // Evaluate geometric boundary heights exactly once while layout metrics are hidden
    this.yieldIfLeftTall();
    this.yieldIfRightTall();

    // SYNCHRONOUS VECTOR COUPLING: Compiles Bezier curves inside memory safely
    this.drawAllGraphLines(); 

    // Drops the computational shield precisely on the next browser paint cycle
    window.requestAnimationFrame(() => {
      mainContainer.classList.remove('is-calculating');
    });
  }

  private renderQuadrant(
    area: HTMLElement,
    collections: Node[][], 
    areaName: "upper" | "lower" | "left" | "right" | "center"
  ) {
    area.empty(); // Leverages Obsidian's native high-performance DOM clearing
    const noteCount = collections.flat().length;
    if (noteCount === 0) return;

    // 1. ALLOCATE VIRTUAL MEMORY CANVAS FRAGMENT
    const areaFragment = createFragment();

    const collectionWrapper = areaFragment.createDiv(RV.COLLECTION_WRAPPER);

    // Map through high-level collections (e.g., maximum of 2 tiered layers in lower area)
    collections.forEach(collection => {
      if (collection.length === 0) return;

      // CSS vertical tier engine stacks secondary collection rows directly underneath primary clusters safely
      const areaCollectionDiv = collectionWrapper.createDiv({ cls: RV.COLLECTION });

      // Mounts individual horizontal multi-column layout flows
      const colWrapDiv = areaCollectionDiv.createDiv({ cls: RV.COL_WRAPPER });
      const itemCount = collection.length;
      
      if (itemCount >= 2 && itemCount <= 6) {
        colWrapDiv.addClass('rv-2-6-items-group');
      }

      if (itemCount === 1) {
        colWrapDiv.addClass('rv-single-item-group');
      }
    
      // Group active nodes inside this specific collection dynamically by frontmatter tags
      const tagGroupedNotes = this.graph.groupByFirstTag(collection);

      tagGroupedNotes.forEach(group => {
        // Collapses column breaks across shared clusters by injecting virtual element wrappers
        const groupDiv = colWrapDiv.createDiv({ cls: RV.GROUPS });

        const groupNotes = group.notes; 
        const overGrensen = groupNotes.length > 4 && noteCount > 20;

        // Build button nodes, hyperlink paths, and gate anchors directly inside memory space
        groupNotes.forEach((note, index) => {
          // Binds geometrical viewport targets to node data fields
          note.assignedArea = areaName;

          const noteEl = note.render();
          if (overGrensen && index > 0 && this.plugin.settings.groupsCollapsed) {
            noteEl.classList.add('hidden');
          }
          groupDiv.appendChild(noteEl);

          // Geometrical tracking bounds mapped to the active quadrant layout wrapper
          if (note.upperGate) note.upperGate.areaElement = area;
          if (note.lowerGate) note.lowerGate.areaElement = area;
          if (note.friendGate) note.friendGate.areaElement = area;
        });

        if (overGrensen) {
          // Typesafe extraction of the initial root node anchoring the expandable cluster
          const firstNote = groupNotes[0];

          if (firstNote && firstNote.div) {
            const firstNoteDiv = firstNote.div;

            firstNoteDiv.classList.add('rv-first-in-group');

            const plusMinusBtn = this.buildPlusMinusBtn(firstNoteDiv, group, overGrensen);

            // Appends the toggle switch absolutely anchored above the root note frame
            firstNoteDiv.appendChild(plusMinusBtn);
          }
        }
      });
    });

    // 3. Mounts the fully evaluated virtual fragment layout directly to the visible viewport screen
    area.appendChild(areaFragment);
  }

  /**
    * Evaluates layout geography and draws vector paths across all active nodes.
    * Leverages localized structural memory caches to execute path tracking in O(1) velocity.
    */
  private drawAllGraphLines() {
    const centerNote = this.graph.centerNote;
    if (!centerNote) return;
    
    const offBy = this.offBy();
    if (!offBy) return;
    
    const links = this.linkCache;
    const canvas = this.backContainerSVG;
    const colorful = this.plugin.settings.colorful === true;

    const colorCache = new Map<Node, string | null>();
    const getColor = (n: Node): string | null => {
      if (colorCache.has(n)) return colorCache.get(n)!;
      const c = this.getLandingNodeColor(n, colorful); // node-owned color
      colorCache.set(n, c);
      return c;
    };

    // 1. INITIALIZATION: Collect visible canvas nodes and clear active gate states
    const visibleNotes = Array.from(this.graph.noteCache.values())
      .filter(n => n.isUsed && n.assignedArea !== "ignored");

    for (const link of links.values()) {
        link.used = false; 
    }

    for (const note of visibleNotes) {
      note.upperGate.svg?.classList.remove('is-connected');
      note.lowerGate.svg?.classList.remove('is-connected');
      note.friendGate.svg?.classList.remove('is-connected');
      // Reset gate inline colors each pass (CSS fallback when no active links)
      this.applyGateColor(note.upperGate, null);
      this.applyGateColor(note.lowerGate, null);
      this.applyGateColor(note.friendGate, null);
    }
    
    // Core geometry safeguard validating if target layout elements have established concrete screen coordinates
    const canDraw = (from: Gate, to: Gate) => {
      if (!from || !to || !from.svg || !to.svg || !from.parentNote.div || !to.parentNote.div) return false;
      
      const rA = from.svg.getBoundingClientRect();
      const rB = to.svg.getBoundingClientRect();
      return rA.width > 0 || rB.width > 0;
    };

    // ==========================================================================
    // 2. THE GEOMETRICAL VECTOR RENDERING TRACE (Strictly 3 clean rules)
    // ==========================================================================
    for (let i = 0; i < visibleNotes.length; i++) {
      const nodeA = visibleNotes[i];
      if (!nodeA) continue;

      for (let j = i + 1; j < visibleNotes.length; j++) {
        const nodeB = visibleNotes[j];
        if (!nodeB) continue;

        // RULE 1: A -> B (child)
        if (nodeA.relations.children.has(nodeB) || nodeB.relations.parents.has(nodeA)) {
          if (canDraw(nodeA.lowerGate, nodeB.upperGate)) {
            // color belongs to receiving gate's host node (nodeB upperGate)
            const strokeColor = getColor(nodeB);
            DrawingUtils.drawLink(nodeA.lowerGate, nodeB.upperGate, links, offBy, canvas, strokeColor);
            nodeA.lowerGate.svg!.classList.add('is-connected');
            nodeB.upperGate.svg!.classList.add('is-connected');

            this.applyGateColor(nodeB.upperGate, colorful ? strokeColor : null);
          }
        }
        // RULE 2: B -> A (child)
        else if (nodeB.relations.children.has(nodeA) || nodeA.relations.parents.has(nodeB)) {
          if (canDraw(nodeB.lowerGate, nodeA.upperGate)) {
            // color belongs to receiving gate's host node (nodeA upperGate)
            const strokeColor = getColor(nodeA);
            DrawingUtils.drawLink(nodeB.lowerGate, nodeA.upperGate, links, offBy, canvas, strokeColor);
            nodeB.lowerGate.svg!.classList.add('is-connected');
            nodeA.upperGate.svg!.classList.add('is-connected');

            this.applyGateColor(nodeA.upperGate, colorful ? strokeColor : null);
          }
        }
        // RULE 3: friend
        else if (nodeA.relations.friends.has(nodeB) || nodeB.relations.friends.has(nodeA)) {
          if (canDraw(nodeA.friendGate, nodeB.friendGate)) {
            // deterministic friend rule: color by target-side gate host node (nodeB)
            const strokeColor = getColor(nodeB);
            DrawingUtils.drawLink(nodeA.friendGate, nodeB.friendGate, links, offBy, canvas, strokeColor);
            nodeA.friendGate.svg!.classList.add('is-connected');
            nodeB.friendGate.svg!.classList.add('is-connected');

            this.applyGateColor(nodeB.friendGate, colorful ? strokeColor : null);
          }
        }
      }
    }  

    // 3. GARBAGE COLLECTION HARVESTING: Purges dead bezier paths from the HTML DOM tree
    for (const [key, link] of this.linkCache.entries()) {
      if (!link.used) {
        link.svgElement.remove(); 
        this.linkCache.delete(key); 
      }
    }
  }
  // #endregion


  // #region GRAPH HELPER METHODS
  private setupScrollEventListeners() {
    // Collects all layout areas configured with layout-level scrolling
    const scrollableAreas = [this.upper, this.lower, this.left, this.right];

    for (const area of scrollableAreas) {
      if (!area) continue;

      const scrollWrapper = area.querySelector(`.${RV.COLLECTION_WRAPPER}`) as HTMLElement;
      if (!scrollWrapper) continue;

      this.plugin.registerDomEvent(
        scrollWrapper,
        'scroll',
        () => {
          this.requestRedraw();
        },
        { passive: true }
      );
    }
  }

  /**
   * Evaluates layout height and updates CSS dataset flags (data-left-tall).
   * Executed post graph data updates but preceding path vector rendering.
   * Forces upper area layout constraints to yield the top-left quadrant to the left area.
   */
  private yieldIfLeftTall() {
    const vc = this.containerEl;
    const descr = '.rv-area.left';
    const leftWrapper = vc.querySelector(descr) as HTMLElement;
    if (!leftWrapper) return;

    const currentValue = vc.getAttribute(RV.LEFT_TALL);

    // Add a strict 15px layout tolerance buffer to eradicate visual flickering thresholds
    const isLeftTall = leftWrapper.scrollHeight > this.center.offsetHeight + 15;
    const newValue = isLeftTall ? "true" : "false";

    if (currentValue !== newValue) {
      vc.setAttribute(RV.LEFT_TALL, newValue);
    }
  }

  /**
   * Evaluates layout height and updates CSS dataset flags (data-right-tall).
   * Operates symmetrically to yield the bottom-right quadrant to the right gate area.
   */
  private yieldIfRightTall() {
    const vc = this.containerEl;
    const descr = '.rv-area.right';
    const rightWrapper = vc.querySelector(descr) as HTMLElement;
    if (!rightWrapper) return;

    const currentValue = vc.getAttribute(RV.RIGHT_TALL);

    // Add a strict 15px layout tolerance buffer to eradicate visual flickering thresholds
    const isRightTall = rightWrapper.scrollHeight > (this.center.offsetHeight + this.upper.offsetHeight + 15);
    const newValue = isRightTall ? "true" : "false";

    if (currentValue !== newValue) {
      vc.setAttribute(RV.RIGHT_TALL, newValue);
    }
  }

  /**
   * Evaluates coordinate translation offsets for the background SVG layer relative to global layout boundaries.
   * @returns Coordinate translation delta points required to compensate canvas path generation.
   */
  private offBy(): Point | null {
    const isMobile = Platform.isMobile;

    if (!this.containerEl) return null;

    const rect = this.containerEl.getBoundingClientRect();

    // SAFEGUARD: Terminate routine if the layout container is completely hidden or unrendered (0x0 scale)
    // This stops vector calculations from collapsing or throwing math errors
    if (rect.width === 0 || rect.height === 0) {
      return null;
    }

    let x = rect.left;
    let y = rect.top;

    if (isMobile) {
      // MOBILE OVERRIDE: Tracks hardware-level window offsets natively on iOS/Android viewports
      x += window.scrollX || 0;
      y += window.scrollY || 0;
    } else {
      x += this.containerEl.scrollLeft || 0;
      y += this.containerEl.scrollTop || 0;
    }

    return { x: x, y: y };
  }

  /**
   * Resolves display color from node link text (supercharged-compatible).
   */
  private getLandingNodeColor(note: Node, colorful: boolean): string | null {
    if (!colorful) return null;
    const linkEl = note.div?.querySelector(".focusable-note-link") as HTMLElement | null;
    if (!linkEl) return null;
    const c = getComputedStyle(linkEl).color;
    return c && c.trim().length > 0 ? c : null;
  }

  /**
   * Applies/removes gate color override with minimal DOM writes.
   */
  private applyGateColor(gate: Gate, color: string | null) {
    const circle = gate.svg?.querySelector("circle") as SVGCircleElement | null;
    if (!circle) return;

    if (!color) {
      if (circle.style.fill) circle.style.removeProperty("fill");
      if (circle.style.stroke) circle.style.removeProperty("stroke");
      return;
    }

    if (circle.style.fill !== color) circle.style.fill = color;
    if (circle.style.stroke !== color) circle.style.stroke = color;
  }

// #endregion


  // #region INFO BTN HANDLING
  /**
   * Configures the dynamic floating info satellite badge component.
   */
  private setupInfoBtnHandler() {

    this.containerEl.on("mouseover", ".rv-info-btn", (event: MouseEvent, target: HTMLElement) => {
      if (this.activeInfoPopup) { 
        this.activeInfoPopup.remove(); 
        this.activeInfoPopup = null; 
      }

      const count = target.getAttribute("data-ignored-count") || "0";
      const hoverText = `${count} hidden files`;
 
      this.activeInfoPopup = createDiv({ cls: RV.INFO_HOVER });
      this.activeInfoPopup.createSpan({ text: hoverText, cls: "popup-title" });
      
      this.activeInfoPopup.addClass('is-measuring');
      this.containerEl.appendChild(this.activeInfoPopup);

      const popupWidth = this.activeInfoPopup.offsetWidth || 180;
      const viewRect = this.containerEl.getBoundingClientRect();
      const btnRect = target.getBoundingClientRect();
      const padding = 10;

      const collidesOnRightSide = (btnRect.right + padding + popupWidth) > viewRect.right;

      if (collidesOnRightSide) {
        this.activeInfoPopup.style.left = `${btnRect.left - viewRect.left - popupWidth - padding}px`;
      } else {
        this.activeInfoPopup.style.left = `${btnRect.right - viewRect.left + padding}px`;
      }

      this.activeInfoPopup.style.top = `${btnRect.top - viewRect.top - 15}px`;
      this.activeInfoPopup.removeClass('is-measuring');
      
    });

    this.containerEl.on("mouseout", ".rv-info-btn", (event: MouseEvent, target: HTMLElement) => {
      if (this.activeInfoPopup) {
        this.activeInfoPopup.remove();
        this.activeInfoPopup = null;
      }
    });

    /** Core lifecycle anchor: automatically flushes the satellite block during view close cycles */
    this.plugin.register(() => { this.cleanupPopup() });
  }
  
  /**
   * Helper utility to safely evict the floating satellite block from the DOM tree.
   */
  private cleanupPopup() {
    if (this.activeInfoPopup) {
      this.activeInfoPopup.remove();
      this.activeInfoPopup = null;
    }
  }

  /**
   * Renders (or removes) the center-node info button that displays ignored-note count.
   * The button is anchored to `.rv-linkdiv` to avoid layout drift when `.item` width changes.
   */
  private renderInfoBtnForCenterNode(): void {
    const centerNote = this.graph.centerNote;
    const centerDiv = centerNote?.div;
    if (!centerDiv) return;

    // Prefer stable anchor: gates + link container
    const anchorEl = centerDiv.querySelector(".rv-linkdiv");
    if (!anchorEl) return;

    // Remove stale button from previous render pass
    anchorEl.querySelector(".rv-info-btn")?.remove();

    // Count ignored notes for current graph snapshot
    let ignoredCount = 0;
    for (const n of this.graph.noteCache.values()) {
      if (n.assignedArea === "ignored" || n.isInitiallyIgnored === true) {
        ignoredCount++;
      }
    }

    // Do not render button if there is nothing to report
    if (ignoredCount <= 0) return;

    // Create and mount info button
    const infoBtn = createDiv({ cls: "rv-plusminus rv-info-btn" });
    infoBtn.textContent = "i";
    infoBtn.setAttribute("data-ignored-count", String(ignoredCount));
    // infoBtn.setAttribute("aria-label", `Ignored notes: ${ignoredCount}`);

    anchorEl.appendChild(infoBtn);
  }
  // #endregion


  // #region PLUS MINUS BTN HANDLING
  /**
   * Registers the event delegation delegate targeting cluster expand/collapse buttons.
   * This is called during the DOM build phase in renderGraph / executeRenderGraph.
   */
  private setupPlusMinusBtnHandler() {
    if (this.plusMinusBound) return;
    this.plusMinusBound = true;

    this.containerEl.on("click", `.${RV.PLUS_MINUS_BTN}`, (event: MouseEvent, target: HTMLElement) => {
      event.preventDefault();
      this.onPlusMinusBtnClicked(target);
    });
  }

  /**
   * Compiles and mounts the tactile expandable/collapsible toggle badge control.
   * Integrates seamless data attributes forwarding parameters down to active third-party style hooks.
   * @param firstNoteDiv The root parent HTMLElement anchoring the node block.
   * @param group Struct containing the current tag identifier and collection array.
   * @param startsClosed Lifecycle constraint indicating the initial visibility rendering threshold.
   */
  private buildPlusMinusBtn(
    firstNoteDiv: HTMLElement, 
    group: { tag: string, notes: Node[] }, 
    startsClosed: boolean 
  ): HTMLElement {
    const count = group.notes.length.toString();

    // remove '#' from tag for visual improvement
    const cleanTagName = group.tag.replace(/^#/, "");

    // Instantiates the toggle badge matching explicit configuration layouts
    const button = firstNoteDiv.createDiv(`${RV.PLUS_MINUS_BTN} ${RV.SUPERCHARGED_ATTRIB} ${RV.BORDERED} ${RV.ROUNDED}`);
    
    button.textContent = startsClosed 
      ? `${RV.PLUS}${cleanTagName}(${count})` 
      : `${RV.MINUS}${cleanTagName}(${count})`; 

    // Inject data metrics enabling high-speed hover telemetry calculations
    button.setAttribute("data-count", count);
    button.setAttribute("data-tag", group.tag);
    button.setAttribute('data-link-tags', group.tag);

    return button;
  }

  /**
   * Orchestrates the dynamic layout mutation expansion and collapse toggling when a cluster badge is clicked.
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
      
    if (textContent.includes(plus)) {
      groupDiv.addClass('expanded');
      items.slice(1).forEach(item => item.removeClass('hidden'));
      target.textContent = `${minus}${cleanTagName}(${count})`;
    } else {
      groupDiv.removeClass('expanded');
      items.slice(1).forEach(item => item.addClass('hidden'));      
      target.textContent = `${plus}${cleanTagName}(${count})`;
    }

  /** Force an immediate geometric update pass via local hardware-coupled refresh */
    this.requestRedraw();
  }
  // #endregion

}
