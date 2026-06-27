import { RelatedData } from "./data.js";
import { NoteClass } from "./NoteClass.js";
import { Platform, Point } from "obsidian";
import { DrawingUtils } from "./DrawingUtils.js";
import { DOMUtils } from "./DOMUtils.js";
import { Direction, GateProperties } from "./GateClass.js";

export class AreaManager {

  private readonly RELATED_VIEW_CONTAINER = 'rv-container';
  private readonly svgLayerDescr = 'rv-svg-layer';
  
  private readonly centerAreaDescr = 'rv-center-area';
  private readonly leftAreaDescr = 'rv-left-area';
  private readonly rightAreaDescr = 'rv-right-area';
  private readonly topAreaDescr = 'rv-upper-area';
  private readonly bottomAreaDescr = 'rv-lower-area';
  
  private readonly areaCollectionDescr = 'rv-area-collections';
  private readonly colWrapDescr = 'rv-columns-wrapper';
  private readonly leftWrapDescr = `.${this.leftAreaDescr} .${this.colWrapDescr}`;
  private readonly rightWrapDescr = `.${this.rightAreaDescr} .${this.colWrapDescr}`;

  private readonly groupDivDescr = 'rv-groups';

  private readonly leftTallDescr = 'data-left-tall';
  private readonly rightTallDescr = 'data-right-tall';
  
  containerEl: HTMLElement;
  backContainerSVG!: SVGSVGElement;

  center!: HTMLElement;
  left!: HTMLElement;
  right!: HTMLElement;
  upper!: HTMLElement;
  lower!: HTMLElement;
    
  private related: RelatedData;
  
  // Den sentrale minne-cachen for SVG-linjene
  private linkCache = new Map<string, { svgElement: SVGPathElement; used: boolean }>();
    
  constructor(
    related: RelatedData,
    parentEl: HTMLElement,
  ){
    this.related = related;
    this.containerEl = parentEl;
  }

  initiate() {
    const el = this.containerEl;
    el.addClass(this.RELATED_VIEW_CONTAINER);
    
    this.center = el.createDiv(this.centerAreaDescr);
    this.left  = el.createDiv(this.leftAreaDescr);
    this.right = el.createDiv(this.rightAreaDescr);
    this.upper = el.createDiv(this.topAreaDescr);
    this.lower = el.createDiv(this.bottomAreaDescr);
    
    this.backContainerSVG = el.createSvg("svg", this.svgLayerDescr);
  }

  /**
   * JS update to CSS if (data-left-tall)
   * Is called after graph is updated but before lines are drawn.
   * Makes upper area yield left upper corner to left area.
   */
  yieldIfLeftTall() {
    const vc = this.containerEl;
    const leftWrapper = vc.querySelector(this.leftWrapDescr) as HTMLElement;
    if (!leftWrapper) return;
    
    const currentValue = vc.getAttribute(this.leftTallDescr);
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
    const rightWrapper = vc.querySelector(this.rightWrapDescr) as HTMLElement;
    if (!rightWrapper) return;
    
    const currentValue = vc.getAttribute(this.rightTallDescr);
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

/*
  allConnect() {
    
    const related = this.related;
    const centerNote = related.centerNote;
    if (!centerNote) return;

    const svg = this.backContainerSVG;
    svg.style.width = '100%';
    svg.style.height = '100%';

    this.scrolledOffby = {
      x: window.scrollX - this.offBy.x,
      y: window.scrollY - this.offBy.y
    };

    this.updateGraphLines()
  };
*/
  renderGraph() {
    let centerNote = this.related.centerNote;
    if (!centerNote) return;

    const {upperGate, lowerGate, friendGate, siblings} = centerNote;
    const {center, upper, lower, left, right} = this;
    const related = this.related;

    const viewContainer = this.containerEl;
    if (viewContainer) {
        viewContainer.setAttribute(this.rightTallDescr, 'false');
        viewContainer.setAttribute(this.leftTallDescr, 'false');
    }

    // 0. Center
    this.renderQuadrant(center, [[centerNote]]);

    // 1. Upper (Parents)
    const sortedParents = related.getSortedNotesForQuadrant(upperGate.connections, false);
    this.renderQuadrant(upper, [sortedParents]);
    
    // 2. Lower (Children + Runde 1 Undefined)
    const allLowerConnections = lowerGate.connections;    
    const childrenOnly = related.getSortedNotesForQuadrant(
      allLowerConnections.filter(n => n.relation === "child")
    );
    const undefinedOnly = related.getSortedNotesForQuadrant(
      allLowerConnections.filter(n => n.relation === "undefined")
    );
    const lowerCollection = [childrenOnly, undefinedOnly].filter(c => c.length > 0);
    this.renderQuadrant(lower, lowerCollection);

    // 3. Left (Friends)
    const sortedFriends = related.getSortedNotesForQuadrant(friendGate.connections, false);
    this.renderQuadrant(left, [sortedFriends]);

    // 4. Right (Siblings + Runde 2 Undefined)
    const siblingsOnly = related.getSortedNotesForQuadrant(
      siblings.filter(n => n.relation === "sibling")
    );
    const undefinedSiblings = related.getSortedNotesForQuadrant(
      siblings.filter(n => n.relation === "undefined")
    );
    const siblingCollection = [siblingsOnly, undefinedSiblings].filter(c => c.length > 0);
    this.renderQuadrant(right, siblingCollection);
  }

  /**
   * Tar en liste med ferdigsorterte noder og sørger for at de tegnes i oppgitt kvadrant.
   */
  private renderQuadrant(area: HTMLElement, collections: NoteClass[][]) {
    // 1. TØM GAMMEL SUB-STRUKTUR (Kritisk for ren DOM)
    area.innerHTML = "";

    const noteCount = collections.flat().length;
    if (noteCount === 0) return;

    collections.forEach(collection => {
      const areaCollectionDiv = area.createDiv(this.areaCollectionDescr);
      const colWrapDiv = areaCollectionDiv.createDiv(this.colWrapDescr)
      
      const groupedNotes = this.related.groupByFirstTag(collection);
      groupedNotes.forEach(group => {
        const groupDiv = colWrapDiv.createDiv(this.groupDivDescr);
        
        group.notes.forEach(note => {
          
          groupDiv.appendChild(note.render());

          // Fortell portene hvilken region de bor i
          if (note.upperGate) note.upperGate.areaElement = area;
          if (note.lowerGate) note.lowerGate.areaElement = area;
          if (note.friendGate) note.friendGate.areaElement = area;

        });

        // 2. LOGIKK FOR PLUSS/MINUS-KNAPP
        if (group.notes.length > 4 && noteCount > 20) {
          const firstNoteDiv = group.notes.first()?.div;
          if (firstNoteDiv) {
            DOMUtils.buildPlusMinusBtn(firstNoteDiv, group);
            
            // Skjul de resterende notene i gruppen
            group.notes.slice(1).forEach(note => {
              // Siden vi akkurat la note.div inn i linkDiv, må vi skjule linkDiv (parentElement)
              note.div?.parentElement?.classList.add('hidden');
            });
          }
        } 
      });
    });
  }

  /**
   * Denne metoden kjøres når du skal tegne opp alle SVG-linjene på skjermen
   */
  drawAllGraphLinks(centerNote: NoteClass | null) {
    if (!centerNote) return;
    
    const offBy = this.offBy();
    if (!offBy) return;
    
    const links = this.linkCache;
    const canvas = this.backContainerSVG;

    // 1. START-FASE: Marker alle eksisterende SVG-linjer i cachen som ubrukt
    for (const link of links.values()) {
        link.used = false; 
    }
    
    // HJELPEFUNKSJON: Sjekker om linjen i det hele tatt kan tegnes før vi prøver
    const canDraw = (from: GateProperties, to: GateProperties) => {
        // Begge portene MÅ eksistere, og begge MÅ ha en sirkel tilstede i DOM-en
        return from && to && from.svg && to.svg;
    };

    // HELPER: Decide type of Gate to return
    const theOther = (dir: Direction, other: NoteClass) => {
      switch (dir) {
        case 'down': return other.upperGate;
        case 'up': return other.lowerGate;
        default: return other.friendGate;
      }
    }

    // 2. TEGNE-FASE
    for (const gate of this.related.allGates) {
      for (const note of gate.connections) {
        const otherGate = theOther(gate.direction, note);
        if (canDraw(gate, otherGate)) {
          // Gjenbruker eller oppretter linjen, og markerer den som used = true internt  
          DrawingUtils.drawLink(gate, otherGate, links, offBy, canvas);
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