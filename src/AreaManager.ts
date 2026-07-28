import { NetworkGraph } from "./NetworkGraph.js";
import { Node } from "./Node.js";
import { Platform, Point } from "obsidian";
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
  private linkCache = new Map<string, { svgElement: SVGPathElement; used: boolean }>();

  private animationFrameId: number | null = null;

  constructor(
    graph: NetworkGraph,
    parentEl: HTMLElement,
    plugin: MyBrainPlugin
  ) {
    this.graph = graph;
    this.containerEl = parentEl;
    this.plugin = plugin;
  }

  initiate() {
    this.containerEl.addClass(RV.CONTAINER);
  }

  /**
   * Schedules a fresh redraw synchronized with the hardware screen refresh rate (60Hz).
   * Automatically triggered by scroll vents, window resizing, and following initial DOM injection.
   */
  public requestRedraw() {
    // If a drawing is already scheduled, cancel the previous frame request
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
    }

    // Schedule a new frame synchronized with the browser rendering engine
    this.animationFrameId = window.requestAnimationFrame(() => {
      // Enforces a micro-timeout ensuring CSS Grid layouts have fully settled 
      // on their concrete pixels before measuring geometry bounds
      setTimeout(() => {
        this.yieldIfLeftTall();
        this.yieldIfRightTall();

        if (this.graph?.centerNote) {
          this.drawAllGraphLines(); // Renders the bezier curve network lines accurately
        }
      }, 150); // 150ms allows browser reflow to settle without human-visible lag

      // Reset the animation frame ID to open the gate for the next request cycle
      this.animationFrameId = null;
    });
  }

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
  yieldIfLeftTall() {
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
   * Operates symmetrically to yield the bottom-right quadrant to the right flanke area.
   */
  yieldIfRightTall() {
    const vc = this.containerEl;
    const descr = '.rv-area.right';
    const rightWrapper = vc.querySelector(descr) as HTMLElement;
    if (!rightWrapper) return;

    const currentValue = vc.getAttribute(RV.RIGHT_TALL);

    // Add a strict 15px layout tolerance buffer to eradicate visual flickering thresholds
    const isRightTall = rightWrapper.scrollHeight > (this.center.offsetHeight + this.upper.offsetHeight + 15);
    const newValue = isRightTall ? "true" : "false";

    if (currentValue !== newValue) {
      vc.setAttribute('data-right-tall', newValue);
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
   * Renders the comprehensive network graph across all quadrants symmetrically.
   * Leverages a hardware-accelerated rendering shield class ("is-calculating") to isolate the DOM tree.
   * Prevents layout-level reflows, column-squeezing, and flickering cycles while element blocks are generated.
   */
  public renderGraph() {
    const centerNote = this.graph.centerNote;
    if (!centerNote) return;

    const graph = this.graph;
    const mainContainer = this.containerEl;
    mainContainer.empty();
    
    // ==========================================================================
    // GEOMETRIC RENDERING SHIELD (Off-Screen Document Matrix Gating)
    // Injects structural state token preventing Chromium layout engines from 
    // computing visual row mutations while the cluster nodes populate in the dark.
    // ==========================================================================
    mainContainer.className = "view-content rv-container is-calculating";

    const fragment = document.createDocumentFragment();
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

    // ==========================================================================
    // SYNCHRONOUS VECTOR COUPLING (Knuser tidsgapet på linjene!)
    // By invoking drawAllGraphLines() directly right here, we force the Bezier 
    // paths to compile inside memory BEFORE the layout becomes visible.
    // When the frame drops the shield, nodes and lines appear simultaneously [dan]!
    // ==========================================================================
    if (this.graph?.centerNote) {
      this.drawAllGraphLines(); // Tegner strekene synkront med en gang mens teppet er nede! [dan]
    }

    // Drops the computational shield precisely on the next browser paint cycle
    window.requestAnimationFrame(() => {
      mainContainer.classList.remove('is-calculating');
      // Vi kaller fortsatt requestRedraw her som en ekstra forsikring for mobile safeguards, 
      // men siden strekene allerede ER tegnet, vil brukeren oppleve 0 nanosekunder forsinkelse! [dan]
      this.requestRedraw(); 
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
    const areaFragment = document.createDocumentFragment();
    const collectionWrapper = areaFragment.createDiv(RV.COLLECTION_WRAPPER);

    // Map through high-level collections (e.g., maximum of 2 tiered layers in lower area)
    collections.forEach(collection => {
      if (collection.length === 0) return;

      // CSS vertical tier engine stacks secondary collection rows directly underneath primary clusters safely
      const areaCollectionDiv = collectionWrapper.createDiv({ cls: RV.COLLECTION });

      // Mounts individual horizontal multi-column layout flows
      const colWrapDiv = areaCollectionDiv.createDiv({ cls: RV.COL_WRAPPER });

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
  drawAllGraphLines() {
    const centerNote = this.graph.centerNote;
    if (!centerNote) return;
    
    const offBy = this.offBy();
    if (!offBy) return;
    
    const links = this.linkCache;
    const canvas = this.backContainerSVG;

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

        // RULE 1: Is Node A a biological parent to Node B? (Loddrett tracking down the spine)
        if (nodeA.relations.children.has(nodeB) || nodeB.relations.parents.has(nodeA)) {
          if (canDraw(nodeA.lowerGate, nodeB.upperGate)) {
            DrawingUtils.drawLink(nodeA.lowerGate, nodeB.upperGate, links, offBy, canvas);
            nodeA.lowerGate.svg!.classList.add('is-connected');
            nodeB.upperGate.svg!.classList.add('is-connected');
          }
        } 
        // RULE 2: Is Node B a biological parent to Node A? (Loddrett tracking up the spine)
        else if (nodeB.relations.children.has(nodeA) || nodeA.relations.parents.has(nodeB)) {
          if (canDraw(nodeB.lowerGate, nodeA.upperGate)) {
            DrawingUtils.drawLink(nodeB.lowerGate, nodeA.upperGate, links, offBy, canvas);
            nodeB.lowerGate.svg!.classList.add('is-connected');
            nodeA.upperGate.svg!.classList.add('is-connected');
          }
        } 
        // RULE 3: Horizontal flanke connections (Symmetrically validated cross-quadrant friends)
        else if (nodeA.relations.friends.has(nodeB) || nodeB.relations.friends.has(nodeA)) {
          if (canDraw(nodeA.friendGate, nodeB.friendGate)) {
            DrawingUtils.drawLink(nodeA.friendGate, nodeB.friendGate, links, offBy, canvas);
            nodeA.friendGate.svg!.classList.add('is-connected');
            nodeB.friendGate.svg!.classList.add('is-connected');
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

  /**
   * Compiles and mounts the elastic info satellite toggle button onto the center element.
   * Encapsulates total metrics regarding suppressed data nodes to enrich metadata discovery.
   */
  private renderInfoBtnForCenterNode() {
    const centerNote = this.graph.centerNote;
    if (!centerNote) return;

    const centerDiv = centerNote.div; 

    if (centerDiv) {
      // 1. Flush obsolete info switches inherited from previous navigation states
      const gammelBtn = centerDiv.querySelector('.rv-info-btn');
      if (gammelBtn) gammelBtn.remove();

      // 2. COUNTER: Totals all layout records condemned or flagged as ignored in the active cycle
      const antallIgnorert = Array.from(this.graph.noteCache.values())
        .filter(n => n.assignedArea === "ignored" || n.isInitiallyIgnored === true).length;

      // 3. CONDITIONAL INJECTION: Activates only if ignored items are detected in memory bounds
      if (antallIgnorert > 0) {
        const infoBtn = centerDiv.createDiv("rv-plusminus rv-info-btn");

        // Deploys the international standardized symbol for info metadata nodes
        infoBtn.textContent = "i";

        // Stamps the raw count directly as an HTML dataset attribute for hover telemetry consumption
        infoBtn.setAttribute("data-ignored-count", antallIgnorert.toString());

        centerDiv.appendChild(infoBtn);
      }
    }
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
}

