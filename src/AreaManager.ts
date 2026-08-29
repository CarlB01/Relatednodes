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
  private hoverBound = false;
  private activeHoverPath: string | null = null;
  private hoverNeighborEls = new Set<HTMLElement>();
  private nodeElByPath = new Map<string, HTMLElement>();
  private delegatedHandlersBound = false;
  private boundClickHandler: ((event: MouseEvent) => void) | null = null;
  private geometryRetryCount = 0;
  private readonly maxGeometryRetries = 8;
  private pendingInvalidLinks = false;
  private readonly cornerEpsilon = 6; // px guard for bogus (0,0)-like gate positions


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

  // #region PUBLIC METHODS
  public initiate() {
    this.containerEl.addClass(RV.CONTAINER);
    this.setupPlusMinusBtnHandler(); // bind once
    this.setupHoverHighlightHandlers();
  }

  /**
   * Public destructor called when the parent view layout collapses or closes.
   */
  public destroy() {
    /** 1. Stop the 40ms DOM render debouncer */
    this.debouncedRender.cancel();
    
    /** 2. Abort the 2x rAF hardware animation loops immediately */
    this.cancelPendingRedraw(); 
    
    /** 3. Clear out the cached SVG Bezier lines */
    this.linkCache.clear();
    
    /** 4. Wipe any visible floating info popups from the screen */
    this.cleanupPopup(); 

    /** 5. Remove delegated handlers so resume gets a clean rebind */
    this.teardownPlusMinusBtnHandler();
  }

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
        
        this.allocateAreaHeights();
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
    this.geometryRetryCount = 0;
    this.pendingInvalidLinks = false;
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

    this.center = fragment.createDiv({ cls: RV.AREA_CENTER });
    this.left = fragment.createDiv({ cls: RV.AREA_LEFT });
    this.right = fragment.createDiv({ cls: RV.AREA_RIGHT });
    this.upper = fragment.createDiv({ cls: RV.AREA_TOP });
    this.lower = fragment.createDiv({ cls: RV.AREA_BOTTOM });

    this.backContainerSVG = fragment.createSvg("svg", { cls: RV.SVG_LAYER });

    // 0. CENTER CORE NODE
    this.renderQuadrant(this.center, [[centerNote]], "center");
    this.renderInfoBtnForCenterNode();

    // map center node for hover-neighbor lookup
    if (centerNote.div) this.nodeElByPath.set(centerNote.path, centerNote.div);

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
    
    this.allocateAreaHeights();
  
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
    areaName: "upper" | "lower" | "left" | "right" | "center" | "ignored"
  ) {
    area.empty(); 
    const noteCount = collections.flat().length;
    if (noteCount === 0) return;

    const areaFragment = createFragment();
    const collectionWrapper = areaFragment.createDiv(RV.COLLECTION_WRAPPER);

    collections.forEach(collection => {
      if (collection.length === 0) return;

      const areaCollectionDiv = collectionWrapper.createDiv({ cls: RV.COLLECTION });
      const colWrapDiv = areaCollectionDiv.createDiv({ cls: RV.COL_WRAPPER });
      const itemCount = collection.length;
      
      if (itemCount >= 2 && itemCount <= 6) colWrapDiv.addClass('rv-2-6-items-group');
      if (itemCount === 1) colWrapDiv.addClass('rv-single-item-group');
    
      // 1. HOVEDGRAFENS TEKNOLOGI: Grupper etter første tagg
      const tagGroupedNotes = this.graph.groupByFirstTag(collection);

      // 2. GJENBRUK: Send de ferdige gruppene til den nye submetoden
      this.renderGroupCollection(colWrapDiv, tagGroupedNotes, noteCount, areaName);
    });

    area.appendChild(areaFragment);
  }

  /**
   * Evaluates and populates a pre-compiled collection of grouped node entities.
   * Fully reused by both the primary workspace grid and custom overlay views.
   */
  private renderGroupCollection(
    targetContainer: HTMLElement,
    groupedData: { tag: string; notes: Node[] }[],
    totalNoteCount: number,
    areaName: "upper" | "lower" | "left" | "right" | "center" | "ignored"
  ) {
    groupedData.forEach(group => {
      const groupDiv = targetContainer.createDiv({ cls: RV.GROUPS });
      const groupNotes = group.notes; 
      const overGrensen = groupNotes.length > 4 && totalNoteCount > 20;

      groupNotes.forEach((node, index) => {
        node.assignedArea = areaName;
        if (node.div) node.div.setAttribute("data-note-path", node.path);
 
        const noteEl = node.render();
        noteEl.setAttribute("data-note-path", node.path);

        if (areaName === "ignored") {
          noteEl.classList.add('hidden');
        } else if (overGrensen && index > 0 && this.plugin.settings.groupsCollapsed) {
          noteEl.classList.add('hidden');
        }
        
        groupDiv.appendChild(noteEl);

        if (node.upperGate) node.upperGate.areaElement = targetContainer;
        if (node.lowerGate) node.lowerGate.areaElement = targetContainer;
        if (node.friendGate) node.friendGate.areaElement = targetContainer;
        
        // 🌟 ROLLED BACK: Re-enabled standard registry tracking across all execution boundaries.
        // The clipping bounds guard in drawAllGraphLines now handles off-screen intersection states.
        if (node.div) {
          this.nodeElByPath.set(node.path, node.div);
        }
      });

      if (overGrensen || areaName === "ignored") {
        const firstNoteInstance = groupNotes[0]; 
        if (firstNoteInstance && firstNoteInstance.div) {
          const firstNoteDiv = firstNoteInstance.div;
          firstNoteDiv.classList.add('rv-first-in-group');

          const plusMinusBtn = this.buildPlusMinusBtn(firstNoteDiv, group, true);
          firstNoteDiv.prepend(plusMinusBtn);
        }
      }
    });
  }

  /**
   * Evaluates layout geography and draws vector paths across all active nodes.
   * Leverages localized structural memory caches to execute path tracking in O(1) velocity.
   */
  private drawAllGraphLines() {
    const centerNote = this.graph.centerNote;
    if (!centerNote) return;

    this.pendingInvalidLinks = false;

    this.nodeElByPath.clear();
    
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

    for (const n of visibleNotes) if (n.div) this.nodeElByPath.set(n.path, n.div);

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

    // Caches the structural dimensions of all active target grid quadrants 
    const quadrantViewports = {
      center: this.center?.getBoundingClientRect() ?? null,
      upper: this.upper?.getBoundingClientRect() ?? null,
      lower: this.lower?.getBoundingClientRect() ?? null,
      left: this.left?.getBoundingClientRect() ?? null,
      right: this.right?.getBoundingClientRect() ?? null,
      ignored: null
    };

    // ==========================================================================
    // 🔍 HIGH-VELOCITY GEOMETRIC INTERSECTION LOG & GUARD
    // Evaluation layer verifying if port connectors reside inside their active frames.
    // ==========================================================================
    const canDraw = (from: Gate, to: Gate) => {
      if (!from || !to || !from.svg || !to.svg || !from.parentNote.div || !to.parentNote.div) return false;

      const rA = from.svg.getBoundingClientRect();
      const rB = to.svg.getBoundingClientRect();
      
      if (this.isBadGateRect(rA) || this.isBadGateRect(rB)) return false;

      // Extract pre-computed DOMRect viewport mask for the source node quadrant in O(1)
      const viewportA = quadrantViewports[from.parentNote.assignedArea];
      if (viewportA) {
        // Discard layout lines if the gate has vertically escaped past its viewport ceiling or floor
        const isClipped = rA.bottom < viewportA.top || rA.top > viewportA.bottom;
        if (isClipped) return false;
      }

      // Extract pre-computed DOMRect viewport mask for the target node quadrant in O(1)
      const viewportB = quadrantViewports[to.parentNote.assignedArea];
      if (viewportB) {
        const isClipped = rB.bottom < viewportB.top || rB.top > viewportB.bottom;
        if (isClipped) return false;
      }

      return true;
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
          } else {
            this.pendingInvalidLinks = true;
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
          } else {
            this.pendingInvalidLinks = true;
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
          } else {
            this.pendingInvalidLinks = true;
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

    // Deterministic recovery pass:
    // If some links were skipped due to unstable/invalid gate geometry,
    // schedule another redraw (bounded to avoid infinite loops).
    if (this.pendingInvalidLinks) {
      if (this.geometryRetryCount < this.maxGeometryRetries) {
        this.geometryRetryCount++;
        this.requestRedraw();
      }
    } else {
      this.geometryRetryCount = 0;
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
   * Compute dynamic max-height budgets per scroll-wrapper from the container's
   * real pixel height and push them as CSS variables.
   * Height is set on area while measuring the scroll containers within these areas.
   *
   * Why: CSS columns behave much better when their containing block has a concrete
   * max-height. Using host-relative px makes this portable to any container size.
   */
  private allocateAreaHeights() {
    const vc = this.containerEl;    
    if (!vc?.isConnected || !this.center) return;

    const CW = `.${RV.COLLECTION_WRAPPER}`;
    const upperScroller = this.upper?.querySelector(CW) as HTMLElement;
    const leftScroller  = this.left?.querySelector(CW) as HTMLElement;
    const lowerScroller = this.lower?.querySelector(CW) as HTMLElement;
    
    const upperScrollHeight = upperScroller?.scrollHeight ?? 0;
    const leftScrollHeight = leftScroller?.scrollHeight ?? 0;
    const lowerScrollHeight = lowerScroller?.scrollHeight ?? 0;
    const midScrollHeight = this.center.scrollHeight; // never null

    const leftPeakAboveCenter = Math.max(0, leftScrollHeight - this.center.scrollHeight);
    const maxUpperOrLeftScroll = Math.max(1, upperScrollHeight, leftPeakAboveCenter);
    const totalScrollHeight = Math.max(1, maxUpperOrLeftScroll + midScrollHeight + lowerScrollHeight); // <- guard
    const upperFraction = maxUpperOrLeftScroll / totalScrollHeight;

    const upperProposal = upperFraction * vc.clientHeight;
    
    // upper should have at least 20% of upper
    let upperH = Math.max(upperProposal, 0.2 * vc.clientHeight); 
    
    // upper also grows until 50% of container height, never more.
    upperH = Math.floor(Math.min(upperH, 0.5 * vc.clientHeight));
    
    const leftH = upperH + midScrollHeight;
    const rightH = vc.clientHeight;
    
    let safeLower = Math.max(0, vc.clientHeight - (upperH + midScrollHeight));
    if (lowerScrollHeight > 0 && lowerScrollHeight < safeLower) {
      safeLower = lowerScrollHeight;
    }
    
    vc.style.setProperty("--rv-upper-max", `${upperH}px`);
    vc.style.setProperty("--rv-left-max", `${leftH}px`);
    vc.style.setProperty("--rv-right-max", `${rightH}px`);
    vc.style.setProperty("--rv-lower-max", `${safeLower}px`);
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
   * Guard against transient invalid gate geometry during heavy layout churn
   * (rapid graph switching / mobile orientation changes).
   * Prevents bogus lines being drawn toward viewport origin.
   */
  private isBadGateRect(rect: DOMRect): boolean {
    if (!rect) return true;
    if (rect.width <= 0 || rect.height <= 0) return true;
    if (!Number.isFinite(rect.left) || !Number.isFinite(rect.top)) return true;
    if (rect.left <= this.cornerEpsilon && rect.top <= this.cornerEpsilon) return true;
    return false;
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

  private parseLineId(lineId: string): [string, string] | null {
    const idx = lineId.indexOf("->");
    if (idx <= 0 || idx >= lineId.length - 2) return null;
    const a = lineId.slice(0, idx);
    const b = lineId.slice(idx + 2);
    if (!a || !b) return null;
    return [a, b];
  }

// #endregion


  // #region HOVER LINK/NEIGHBOUR HIGHLIGHT
  private setupHoverHighlightHandlers() {
    if (this.hoverBound) return;
    this.hoverBound = true;

    this.containerEl.on("mouseover", ".item", (_event: MouseEvent, target: HTMLElement) => {
      const notePath = target.getAttribute("data-note-path");
      if (!notePath) return;
      if (this.activeHoverPath === notePath) return;
      this.applyHoverHighlight(notePath);
    });

    this.containerEl.on("mouseout", ".item", (_event: MouseEvent, _target: HTMLElement) => {
      this.clearHoverHighlight();
    });
  }

  private applyHoverHighlight(notePath: string) {
    this.clearHoverHighlight();
    this.activeHoverPath = notePath;

    for (const [lineId, cacheItem] of this.linkCache.entries()) {
      const parsed = this.parseLineId(lineId);
      if (!parsed) continue;
      const [a, b] = parsed;

      if (a !== notePath && b !== notePath) continue;

      cacheItem.svgElement.addClass("is-hover-link");

      const neighborPath = a === notePath ? b : a;
      const neighborEl = this.nodeElByPath.get(neighborPath);
      if (neighborEl) {
        neighborEl.addClass("is-hover-neighbor");
        this.hoverNeighborEls.add(neighborEl);
      }
    }
  }

  private clearHoverHighlight() {
    this.activeHoverPath = null;

    for (const cacheItem of this.linkCache.values()) {
      cacheItem.svgElement.removeClass("is-hover-link");
    }

    for (const el of this.hoverNeighborEls) {
      el.removeClass("is-hover-neighbor");
    }
    this.hoverNeighborEls.clear();
  }

  /**
   * Public wrapper to clear transient hover visuals/state from outside AreaManager.
   */
  public clearTransientHoverState() {
    this.clearHoverHighlight();
  }
  // #endregion


  // #region INFO BTN HANDLING
  /**
   * Safely evicts the floating satellite info block from the DOM tree.
   */
  private cleanupPopup() {
    if (this.activeInfoPopup) {
      this.activeInfoPopup.remove();
      this.activeInfoPopup = null;
    }
  }

  /**
   * Evaluates boundary coordinates and repositions the interactive popup 
   * relative to the host anchor node utilizing screen edge collision logic.
   */
  private repositionPopup(target: HTMLElement) {
    if (!this.activeInfoPopup) return;

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
  }

  /**
   * Converts the popup into an interactive list, beautifully grouped by ignore-reason.
   * Completely isolated from grid-class interference to guarantee reliable click targeting.
   */
  private openInteractiveIgnoredList(target: HTMLElement) {
    if (this.activeInfoPopup?.classList.contains('active-list')) {
      this.cleanupPopup();
      return;
    }

    const ignoredGroups = this.graph.ignoredGroups;
    if (!ignoredGroups || ignoredGroups.size === 0) return;

    if (this.activeInfoPopup) this.activeInfoPopup.remove();

    // 1. Create the master shell container with a clean, isolated list class
    this.activeInfoPopup = createDiv({ cls: `${RV.INFO_HOVER} active-list rv-ignored-popup-shell` });

    // 2. Instantiate a memory-isolated document fragment matrix to prevent DOM lag
    const popupFragment = createFragment();

    const headerWrapper = popupFragment.createDiv({ cls: "rv-ignored-header-wrapper" });
    const listHeader = headerWrapper.createEl("span", { cls: "rv-ignored-header-text" });
    listHeader.setText("Hidden / Cause");

    // 3. Populate all cluster nodes and buttons entirely inside memory space
    ignoredGroups.forEach((nodes, reason) => {
      if (!nodes || nodes.length === 0) return;

      // UNIQUE NON-GRID GROUP CONTEXT: Prevents element layering and ghost clicks
      const groupDiv = popupFragment.createDiv({ cls: "rv-ignored-pure-group" });

      const cleanReason = reason.replace(/^#/, ""); 
      const headerBtn = groupDiv.createDiv({ cls: "rv-plusminus rv-ignored-pure-btn" });
      headerBtn.textContent = `${RV.PLUS}${cleanReason}(${nodes.length})`;

      // Store variables safely as data-attributes on the button to prevent closure leakage
      headerBtn.setAttribute("data-reason", cleanReason);
      headerBtn.setAttribute("data-count", String(nodes.length));

      // ISOLATED CONTAINER: Forces the group to start strictly closed via native display properties
      const linksContainer = groupDiv.createDiv({ cls: "rv-ignored-pure-container" });
      linksContainer.style.display = "none"; 

      nodes.forEach(node => {
        const itemWrapper = linksContainer.createDiv({ cls: "rv-ignored-pure-item" });

        const linkEl = itemWrapper.createEl("a", {
          cls: "focusable-note-link supercharged rv-ignored-note-link",
          attr: { "data-link-path": node.path }
        });

        linkEl.createSpan({ text: node.displayText, cls: "rv-text-span" });

        // 🌟 ROLLED BACK: Hover effects that trigger graph highlighting have been fully removed as requested.

        this.plugin.registerDomEvent(linkEl, "click", (e: MouseEvent) => {
          e.preventDefault();
          e.stopPropagation();
          this.plugin.app.workspace.openLinkText(node.path, "", false);
          this.cleanupPopup();
        });
      });

      // 🌟 6. FIXED CLICK LIFECYCLE: Completely isolated from loop scopes using local DOM traversal
      this.plugin.registerDomEvent(headerBtn, "click", (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();

        const clickedBtn = e.currentTarget as HTMLElement;
        if (!clickedBtn) return;

        const currentGroupDiv = clickedBtn.closest(".rv-ignored-pure-group") as HTMLElement;
        if (!currentGroupDiv) return;

        // CRITICAL SCOPE REFACTOR: Query the container strictly WITHIN the context of the clicked group
        const targetContainer = currentGroupDiv.querySelector(".rv-ignored-pure-container") as HTMLElement;
        if (!targetContainer) return;

        const reasonName = clickedBtn.getAttribute("data-reason") || "";
        const countStr = clickedBtn.getAttribute("data-count") || "0";
        const isPlus = clickedBtn.textContent?.includes(RV.PLUS);

        if (isPlus) {
          currentGroupDiv.classList.add("expanded");
          targetContainer.style.display = "flex"; // Folds out the list cleanly matching your inner padding
          clickedBtn.textContent = `${RV.MINUS}${reasonName}(${countStr})`;
        } else {
          currentGroupDiv.classList.remove("expanded");
          targetContainer.style.display = "none"; // Collapses the list entirely from view
          clickedBtn.textContent = `${RV.PLUS}${reasonName}(${countStr})`;
        }
      });
    });

    this.activeInfoPopup.appendChild(popupFragment);
    this.containerEl.appendChild(this.activeInfoPopup);
    this.repositionPopup(target);

    // Global native click listener to capture any interaction landing outside the popup bounds
    const closeOutsideHandler = (clickEvent: MouseEvent) => {
      if (!this.activeInfoPopup) return;
      const clickedEl = clickEvent.target as HTMLElement;
      if (!clickedEl) return;

      // Check if they clicked the core info button button framework itself
      const clickedInfoBtn = clickedEl.closest(".rv-info-btn");

      // Since internal clicks are stopped, ANY click that reaches here is guaranteed to be outside!
      if (!clickedInfoBtn) {
        this.cleanupPopup();
      }
    };
    
    // Register the outside-click handler exactly once per presentation phase
    window.setTimeout(() => {
      this.plugin.registerDomEvent(document, "click", closeOutsideHandler, { once: true });
    }, 50);
  }


  /**
   * Renders the center-node info button and registers natively managed Obsidian event listeners.
   * Leverages unified, instant event execution without artificial browser timeouts.
   */
  private renderInfoBtnForCenterNode(): void {
    const centerNote = this.graph.centerNote;
    const centerDiv = centerNote?.div;
    if (!centerDiv) return;

    const anchorEl = centerDiv.querySelector(".rv-linkdiv");
    if (!anchorEl) return;

    anchorEl.querySelector(".rv-info-btn")?.remove();

    const ignoredCount = this.graph.ignoredNotes?.size || 0;
    if (ignoredCount <= 0) return;

    const infoBtn = createDiv({ cls: "rv-plusminus rv-info-btn" });
    infoBtn.textContent = "i";
    infoBtn.setAttribute("data-ignored-count", String(ignoredCount));
    anchorEl.appendChild(infoBtn);

    let pressTimerId: number | null = null;
    let isLongPress = false;
    const LONG_PRESS_DURATION = 500;

    // 1. MOUSEOVER: Instant execution reflecting your core graph layout logic
    this.plugin.registerDomEvent(infoBtn, "mouseover", (e: MouseEvent) => {
      if (this.activeInfoPopup?.classList.contains('active-list')) return;
      this.cleanupPopup();

      // If a modifier key is active during the hover window sweep, launch the menu instantly
      if (e.altKey || e.ctrlKey || e.metaKey) {
        this.openInteractiveIgnoredList(infoBtn);
        return;
      }

      // Standard instant lightweight text preview
      this.activeInfoPopup = createDiv({ cls: RV.INFO_HOVER });
      this.plugin.registerDomEvent(this.activeInfoPopup, "click", (e: MouseEvent) => {
        e.stopPropagation();
      });
      this.activeInfoPopup.createSpan({ text: `${ignoredCount} hidden nodes`, cls: "popup-title" });
      this.activeInfoPopup.addClass('is-measuring');
      this.containerEl.appendChild(this.activeInfoPopup);

      this.repositionPopup(infoBtn);
    });

    // 🌟 GLOBAL KEYDOWN INTERCEPTOR: Perfectly synchronized with your core items preview framework
    this.plugin.registerDomEvent(window, "keydown", (e: KeyboardEvent) => {
      if (e.key === "Meta" || e.key === "Control" || e.key === "Alt") {
        if (infoBtn.matches(":hover")) {
          if (!this.activeInfoPopup?.classList.contains('active-list')) {
            this.openInteractiveIgnoredList(infoBtn);
          }
        }
      }
    });

    // 2. MOUSEOUT: Clean evacuation pass
    this.plugin.registerDomEvent(infoBtn, "mouseout", () => {
      if (this.activeInfoPopup?.classList.contains('active-list')) return;
      this.cleanupPopup();
    });

    // 3. POINTERDOWN (Mobile Long-Press)
    this.plugin.registerDomEvent(infoBtn, "pointerdown", () => {
      isLongPress = false;
      pressTimerId = window.setTimeout(() => {
        isLongPress = true;
        this.openInteractiveIgnoredList(infoBtn);
        if (navigator.vibrate) navigator.vibrate(15);
      }, LONG_PRESS_DURATION);
    });

    // 4. POINTERUP (Mobile fallback / Desktop standard click click override)
    this.plugin.registerDomEvent(infoBtn, "pointerup", (e: PointerEvent) => {
      if (pressTimerId !== null) { window.clearTimeout(pressTimerId); pressTimerId = null; }
      
      if (!isLongPress && !Platform.isMobile) {
        e.stopPropagation();
        this.openInteractiveIgnoredList(infoBtn);
      }
    });

    // 5. POINTERCANCEL
    this.plugin.registerDomEvent(infoBtn, "pointercancel", () => {
      if (pressTimerId !== null) { window.clearTimeout(pressTimerId); pressTimerId = null; }
    });
  }
  // #endregion


  // #region PLUS MINUS BTN HANDLING
  /**
   * Registers the event delegation delegate targeting cluster expand/collapse buttons.
   * This is called during the DOM build phase in renderGraph / executeRenderGraph.
   */
  private setupPlusMinusBtnHandler() {
    // Always ensure single live delegated listener bound to the current container
    this.teardownPlusMinusBtnHandler();

    this.boundClickHandler = (event: MouseEvent) => {
      const rawTarget = event.target as HTMLElement | null;
      if (!rawTarget) return;

      const btn = rawTarget.closest(`.${RV.PLUS_MINUS_BTN}`) as HTMLElement;
      if (!btn) return;
      if (!this.containerEl.contains(btn)) return;

      event.preventDefault();
      this.onPlusMinusBtnClicked(btn);
    };

    this.containerEl.addEventListener("click", this.boundClickHandler, true);
    this.plusMinusBound = true;
    this.delegatedHandlersBound = true;
   }

  private teardownPlusMinusBtnHandler() {
    if (this.boundClickHandler && this.delegatedHandlersBound) {
      this.containerEl.removeEventListener("click", this.boundClickHandler, true);
    }
    this.boundClickHandler = null;
    this.plusMinusBound = false;
    this.delegatedHandlersBound = false;
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
