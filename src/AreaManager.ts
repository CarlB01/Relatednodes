import { RelatedData } from "./data.js";
import { NoteClass } from "./NoteClass.js";
import { Platform, Point } from "obsidian";
import { DrawingUtils } from "./DrawingUtils.js";
import { DOMUtils } from "./DOMUtils.js";
import { GateProperties } from "./GateClass.js";
import { RV_CLASSES } from "./constants.js";
import RelatednotesPlugin from "./main.js";

export class AreaManager {
  containerEl: HTMLElement;

  backContainerSVG!: SVGSVGElement;
  center!: HTMLElement;
  left!: HTMLElement;
  right!: HTMLElement;
  upper!: HTMLElement;
  lower!: HTMLElement;
    
  private related: RelatedData;
  private plugin: RelatednotesPlugin;
  
  // Den sentrale minne-cachen for SVG-linjene
  private linkCache = new Map<string, { svgElement: SVGPathElement; used: boolean }>();
    
  private animationFrameId: number | null = null;

  constructor(
    related: RelatedData, 
    parentEl: HTMLElement,
    plugin: RelatednotesPlugin
  ){
    this.related = related;
    this.containerEl = parentEl;
    this.plugin = plugin;
  }

  initiate() {
    this.containerEl.addClass(RV_CLASSES.CONTAINER); 
  }

  /**
   * Planlegger en ny, frisk opptegning synkronisert med skjermens oppdatering (60Hz).
   * Kalles automatisk ved rulling, vindusendringer og etter den store dytten til skjermen.
   */
  public requestRedraw() {
    // Hvis det allerede er planlagt en tegning, avbryt det forrige varselet
    if (this.animationFrameId !== null) {
        cancelAnimationFrame(this.animationFrameId);
    }

    // Planlegg en ny frame synkronisert med nettleseren/skjermen
    this.animationFrameId = requestAnimationFrame(() => {

      // check heights of lef/right areas - make upper/lower yield
      this.yieldIfLeftTall();
      this.yieldIfRightTall();

      // Draw new lines based on recent coords.
      if (this.related?.centerNote) {
        this.drawAllGraphLinks();
      }
      // Nullstill ID-en så neste frame kan kjøre fritt
      this.animationFrameId = null;
    });
  }

  private setupScrollEventListeners() {
    // En liste over alle områdene som har fått tildelt rulling i CSS-en din
    const scrollableAreas = [this.upper, this.lower, this.left, this.right];

    for (const area of scrollableAreas) {
      if (!area) continue;

      // Finn den faktiske samlingsboksen (.rv-area-collections) som ruller inni området
      const scrollContainer = area.querySelector(`.${RV_CLASSES.COLLECTION}`) as HTMLElement;
      
      if (scrollContainer) {
        this.plugin.registerDomEvent(
          scrollContainer, 
          'scroll', 
          () => {
            this.requestRedraw(); // Sørger for at Beziér-kurvene følger med live! [dan]
          }, 
          { passive: true }
        );
      }
    }
  }

  /**
   * JS update to CSS if (data-left-tall)
   * Is called after graph is updated but before lines are drawn.
   * Makes upper area yield left upper corner to left area.
   */
  yieldIfLeftTall() {
    const vc = this.containerEl;
    const descr = `.${RV_CLASSES.LEFT_AREA} .${RV_CLASSES.COL_WRAPPER}`;
    const leftWrapper = vc.querySelector(descr) as HTMLElement;
    if (!leftWrapper) return;
    
    const currentValue = vc.getAttribute(RV_CLASSES.LEFT_TALL);
    const isLeftTall = leftWrapper.scrollHeight > this.center.offsetHeight;
    const newValue = isLeftTall ? "true" : "false";

    if (currentValue !== newValue) {
        vc.setAttribute('data-left-tall', newValue);
    }
  }

  /**
   * JS update to CSS if (data-right-tall)
   * As above - Makes lower area yield right lower corner to right area.
   */
  yieldIfRightTall() {
    const vc = this.containerEl;
    const descr = `.${RV_CLASSES.RIGHT_AREA} .${RV_CLASSES.COL_WRAPPER}`;
    const rightWrapper = vc.querySelector(descr) as HTMLElement;
    if (!rightWrapper) return;
    
    const currentValue = vc.getAttribute(RV_CLASSES.RIGHT_TALL);
    const isRightTall = rightWrapper.scrollHeight > (this.center.offsetHeight + this.upper.offsetHeight);
    const newValue = isRightTall ? "true" : "false";

    if (currentValue !== newValue) {
      vc.setAttribute('data-right-tall', newValue);
    }
  }
  
  /**
   * Check how much backContainerSVG is off related to future container measures.
   * @returns amount of pixels the drawing routine must adjust coords
   */
  private offBy(): Point | null{
    const isMobile = Platform.isMobile;
    
    if (!this.containerEl) return null;

    const rect = this.containerEl.getBoundingClientRect();
    
    // SAFEGUARD 1: Avoid drawing if the container is hidden or currently off-screen (0x0 size)
    // This stops drawings from completely breaking or vanishing
    if (rect.width === 0 || rect.height === 0) {
        return null; 
    }

    let x = rect.left; 
    let y = rect.top;

    if (isMobile) {
        // SAFEGUARD 2: Include native window offset tracking
        x += window.scrollX || 0;
        y += window.scrollY || 0;
    } else {
        x += this.containerEl.scrollLeft || 0;
        y += this.containerEl.scrollTop || 0;
    }

    return { x: x, y: y };
  }

  public renderGraph() { 
    const centerNote = this.related.centerNote;
    if (!centerNote) return;
    
    const related = this.related;
    const memoryFragment = document.createDocumentFragment();

    // Klargjør .rv-container i minnet
    const mainContainerEl = memoryFragment.createDiv({ cls: RV_CLASSES.CONTAINER });
    mainContainerEl.setAttribute(RV_CLASSES.LEFT_TALL, 'false');
    mainContainerEl.setAttribute(RV_CLASSES.RIGHT_TALL, 'false');

    this.center = mainContainerEl.createDiv({ cls: RV_CLASSES.CENTER_AREA });
    this.left   = mainContainerEl.createDiv({ cls: RV_CLASSES.LEFT_AREA });
    this.right  = mainContainerEl.createDiv({ cls: RV_CLASSES.RIGHT_AREA });
    this.upper  = mainContainerEl.createDiv({ cls: RV_CLASSES.TOP_AREA });
    this.lower  = mainContainerEl.createDiv({ cls: RV_CLASSES.BOTTOM_AREA });
    
    this.backContainerSVG = mainContainerEl.createSvg("svg", { cls: RV_CLASSES.SVG_LAYER });

    // 0. CENTER
    this.renderQuadrant(this.center, [ [centerNote] ], "center");

    // 1. UPPER AREA (Kun 1 kolleksjon: Ekte parents. Undefined/Ignored holdes HELT utenfor)
    const cleanParentsOnly = Array.from(centerNote.relations.parents).filter(n => n.relation === "parent"); 
    const sortedParents = related.getSortedNotesForQuadrant(cleanParentsOnly, false);
    this.renderQuadrant(this.upper, [ sortedParents ], "upper");
  
    // 2. LEFT AREA (Kun 1 kolleksjon: Ekte friends. Undefined/Ignored holdes HELT utenfor)
    const cleanFriendsOnly = Array.from(centerNote.relations.friends).filter(n => n.relation === "friend"); 
    const sortedFriends = related.getSortedNotesForQuadrant(cleanFriendsOnly, false);
    this.renderQuadrant(this.left, [ sortedFriends ], "left");

    // 3. LOWER AREA (Kolleksjon 1: Ekte barn. Kolleksjon 2: Senterets felles oppsamling av ALT udefinert)    
    const allNotesInCache = Array.from(related.noteCache.values()).filter(n => n.isUsed);
    
    // Kolleksjon 1: Kun noder med den definerte relasjonen "child"
    const childrenOnly = related.getSortedNotesForQuadrant(
      allNotesInCache.filter(n => n.relation === "child"), false
    );
    // Kolleksjon 2: ALT udefinert i hele cachen (uansett om kilden var udefinert frontmatter eller bodytext!)
    const totalUndefinedBucket = related.getSortedNotesForQuadrant(
      allNotesInCache.filter(n => n.relation === "undefined"), false
    );
    const lowerCollections = [childrenOnly, totalUndefinedBucket].filter(c => c.length > 0);
    this.renderQuadrant(this.lower, lowerCollections, "lower");

    // 4. RIGHT AREA (Søsken-området: Skiller mellom kriterie-søsken og brødtekst/udefinerte søsken)
    const rawSiblings = Array.from(centerNote.relations.siblings);
    
    // Kolleksjon 1: Solide søsken som ble oppdaget via de brukerstyrte frontmatter-kriteriene hos parent
    const solidSiblings = related.getSortedNotesForQuadrant(
      rawSiblings.filter(n => n.relation === "sibling" || n.discoverySource === "frontmatter-kriterium"), true
    );
    
    // Kolleksjon 2: Søsken som ble funnet i parent/søskens brødtekst eller udefinerte frontmatter-egenskaper
    const looseTextSiblings = related.getSortedNotesForQuadrant(
      rawSiblings.filter(n => n.relation === "undefined" || n.discoverySource === "bodytext" || n.discoverySource === "frontmatter-udefinert"), true
    );
    const siblingCollections = [solidSiblings, looseTextSiblings].filter(c => c.length > 0);
    this.renderQuadrant(this.right, siblingCollections, "right");

    // ERSTATT SKJERMEN
    this.containerEl.empty(); 
    this.containerEl.appendChild(memoryFragment);

    // NÅ er områdene fysisk tilstede, og vi kobler på lytterne og linjene i samme mikrosekund:
    this.setupScrollEventListeners(); 
    this.requestRedraw(); 
  }

  private renderQuadrant(
    area: HTMLElement, 
    collections: NoteClass[][], // Tar imot de rå kolleksjonene (f.eks. [[children], [undefined]])
    areaName: "upper" | "lower" | "left" | "right" | "center"
  ) {
    area.empty(); // Obsidians native, lynraske tømming
    const noteCount = collections.flat().length;
    if (noteCount === 0) return;

    // 1. OPPRETT DET USYNLIGE FRAGMENTET I MINNET
    const areaFragment = document.createDocumentFragment();
    
    // Vi looper gjennom de overordnede kolleksjonene (f.eks. maks 2 i lower area)
    collections.forEach(collection => {
      if (collection.length === 0) return;

      // PRINSIPP: Hver kolleksjon får sin egen etasje-stabler (.rv-area-collections). 
      // Siden disse stables vertikalt i CSS, vil Kolleksjon 2 legge seg vakkert UNDER Kolleksjon 1!
      const areaCollectionDiv = areaFragment.createDiv({ cls: RV_CLASSES.COLLECTION });

      // Hver kolleksjon får sin egen kolonneflyt (.rv-columns-wrapper)
      const colWrapDiv = areaCollectionDiv.createDiv({ cls: RV_CLASSES.COL_WRAPPER});

      // Vi grupperer notene i denne kolleksjonen etter tag!
      const tagGroupedNotes = this.related.groupByFirstTag(collection);

      tagGroupedNotes.forEach(group => {
        // Hver unike tag-gruppe får sin egen "usynlige" gruppe-DIV (.rv-groups)
        const groupDiv = colWrapDiv.createDiv({ cls: RV_CLASSES.GROUPS });

        group.notes.forEach(note => {
          // STEMPEL: Sikringen settes på nøyaktig riktig sted
          note.assignedArea = areaName;

          // RENDRE: Bygg knappen, a-lenken og de 3 portene ferdig i minnet
          const noteElement = note.render(); 
          groupDiv.appendChild(noteElement);

          // Region-referanser for portene
          if (note.upperGate)  note.upperGate.areaElement = area;
          if (note.lowerGate)  note.lowerGate.areaElement = area;
          if (note.friendGate) note.friendGate.areaElement = area;
        });

        // Din pluss/minus-logikk
        if (group.notes.length > 4 && noteCount > 20) {
          const firstNoteInstance = group.notes[0];
          if (firstNoteInstance && firstNoteInstance.div) {
            
            // Sender med det ekte gruppe-objektet ({ tag, notes }) til din DOMUtils
            DOMUtils.buildPlusMinusBtn(firstNoteInstance.div, group);
            
            // Skjul de resterende notene i denne spesifikke tag-gruppen
            group.notes.slice(1).forEach(note => {
              note.div?.parentElement?.classList.add('hidden');
            });
          }
        } 
      });
    });

    // 3. Den store dytten til skjermen
    area.appendChild(areaFragment);
  }

  /**
   * Denne metoden kjøres når du skal tegne opp alle SVG-linjene på skjermen
   */
  drawAllGraphLinks() {
    const centerNote = this.related.centerNote;
    if (!centerNote) return;
    
    const offBy = this.offBy();
    if (!offBy) return;
    
    const links = this.linkCache;
    const canvas = this.backContainerSVG;

    // 1. START-FASE: Marker alle eksisterende SVG-linjer i cachen som ubrukt
    for (const link of links.values()) {
        link.used = false; 
    }
    
    // SIKRINGSDØRVAKT: Sjekker om begge portene er fysisk tegnet ut og synlige i DOM-en
    const canDraw = (from: GateProperties, to: GateProperties) => {
      return from && to && from.svg && to.svg && 
             from.parentNote.div && to.parentNote.div;
    };

    // Hent ut kun de notene som faktisk overlevde Garbage Collection og er i bruk på skjermen
    const visibleNotes = Array.from(this.related.noteCache.values())
      .filter(n => n.isUsed && n.assignedArea !== "ignored");

    // ==========================================================================
    // 2. TEGNE-FASE: Vi parer notene i en dobbel-loop for å unngå duplikate linjer
    // ==========================================================================
    for (let i = 0; i < visibleNotes.length; i++) {
      const nodeA = visibleNotes[i];
      
      if (!nodeA) continue;

      for (let j = i + 1; j < visibleNotes.length; j++) {
        const nodeB = visibleNotes[j];
  
        if (!nodeB) continue;

        // --- KATEGORI A: VERTIKALE RELASJONER (Parents / Children / Siblings) ---
      
        // Sjekk 1: Er nodeB et barn av nodeA?
        if (nodeA.relations.children.has(nodeB)) {
          // Linjen går fra toppen av barnet (up) til bunnen av forelderen (down)
          if (canDraw(nodeB.upperGate, nodeA.lowerGate)) {
            DrawingUtils.drawLink(nodeB.upperGate, nodeA.lowerGate, links, offBy, canvas);
          }
        } 
        // Sjekk 2: Er nodeA et barn av nodeB?
        else if (nodeA.relations.parents.has(nodeB)) {
          // Linjen går fra toppen av barnet (up) til bunnen av forelderen (down)
          if (canDraw(nodeA.upperGate, nodeB.lowerGate)) {
            DrawingUtils.drawLink(nodeA.upperGate, nodeB.lowerGate, links, offBy, canvas);
          }
        }

        // --- KATEGORI B: HORISONTALE RELASJONER (Friends & Kryssende Baits) ---
        
        // Sjekk om disse to unike nodene deler et eller flere aktive baits (fra trinn 3c)
        const delerBait = nodeA.crossingBaits.size > 0 && 
                          Array.from(nodeA.crossingBaits).some(b => nodeB.crossingBaits.has(b));

        // Hvis de er venner, søsken av samme center, eller deler et kryssende agn:
        if (nodeA.relations.friends.has(nodeB) || nodeA.relations.siblings.has(nodeB) || delerBait) {
          
          // Siden friendGate dynamisk er plassert på enten venstre eller høyre flanke 
          // av NoteClass.render() basert på kvadrant, kan vi trygt koble sammen 
          // friendGate mot friendGate. Akse-regelen og CSS-en din sikrer at de møtes horisontalt!
          if (canDraw(nodeA.friendGate, nodeB.friendGate)) {
            DrawingUtils.drawLink(nodeA.friendGate, nodeB.friendGate, links, offBy, canvas);
          }
        }
      }
    }

    // 3. OPPRYDDINGS-FASE: Slett alle linjer i cachen som ikke ble gjenbrukt i denne runden
    for (const [key, link] of this.linkCache.entries()) {
        if (!link.used) {
            link.svgElement.remove(); // Fjern fysisk fra SVG-containeren i DOM-en
            this.linkCache.delete(key); // Fjern fra minne-cachen
        }
    }
  }

}