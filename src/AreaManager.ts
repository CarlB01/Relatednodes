import { RelatedData } from "./data.js";
import { NoteClass } from "./NoteClass.js";
import { Platform, Point } from "obsidian";
import { DrawingUtils } from "./DrawingUtils.js";
import { DOMUtils } from "./DOMUtils.js";
import { GateProperties } from "./GateClass.js";

export class AreaManager {

  private readonly RELATED_VIEW_CONTAINER = 'related-view-container';
  private readonly svgLayerDescr = 'related-svg-layer';
  
  private readonly centerAreaDescr = 'related-center-area';
  private readonly leftAreaDescr = 'related-left-area';
  private readonly rightAreaDescr = 'related-right-area';
  private readonly topAreaDescr = 'related-upper-area';
  private readonly bottomAreaDescr = 'related-lower-area';
  
  private readonly areaCollectionDescr = 'related-area-collections';
  private readonly colWrapDescr = 'related-columns-wrapper';

  private readonly groupDivDescr = 'related-groups';
  
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

  updateGraph() {
    const centerNote = this.related.centerNote;
    console.log('updateGraph', centerNote?.basename)
    
    //this.resetScaleFactor();
    this.renderGraph();
    this.drawAllGraphLinks(centerNote);
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
  private renderGraph() {
    let centerNote = this.related.centerNote;
    if (!centerNote) return;

    const {upperGate, lowerGate, friendGate, siblings} = centerNote;
    const {center, upper, lower, left, right} = this;
    const related = this.related;

    const viewContainer = this.containerEl;
    if (viewContainer) {
        viewContainer.setAttribute('data-right-tall', 'false');
    }

    // 0. Center
    this.renderQuadrant(center, [[centerNote]]);

    // 1. Upper (Parents)
    const sortedParents = related.getSortedNotesForQuadrant(upperGate.connections, false);
    this.renderQuadrant(upper, [sortedParents]);
    console.log('render parents', sortedParents.length)

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

    // 2. TEGNE-FASE: Gå gjennom alle de fire relasjonsstrømmene

    // A. Foreldre-linjer (Fra Center til Parents)
    for (const parent of centerNote.upperGate.connections) {
      if (canDraw(centerNote.upperGate, parent.lowerGate)) {
        // Gjenbruker eller oppretter linjen, og markerer den som used = true internt
        DrawingUtils.drawLink(centerNote.upperGate, parent.lowerGate, links, offBy, canvas);
      }
    }

    // B. Barn-linjer (Fra Center til Children/Undefined fra runde 1)
    for (const child of centerNote.lowerGate.connections) {
      if (canDraw(centerNote.lowerGate, child.upperGate)) {
        DrawingUtils.drawLink(centerNote.lowerGate, child.upperGate, links, offBy, canvas);
      }
    }

    // C. Venne-linjer (Fra Center til Friends - asymmetrisk koblet)
    for (const friend of centerNote.friendGate.connections) {
      if (canDraw(centerNote.friendGate, friend.friendGate)) {
        DrawingUtils.drawLink(centerNote.friendGate, friend.friendGate, links, offBy, canvas);
      }
    }

    // D. Søsken-linjer (Går fra Parent til Sibling, ikke fra Center!)
    const parents = centerNote.upperGate.connections;
    for (const sibling of centerNote.siblings) {
        // Finn hvilken forelder som eier dette søskenet basert på datagrunnlaget
        const sharedParent = parents.find(p => 
            p.lowerGate.connections.some(c => c.basename === sibling.basename)
        );

        if (sharedParent) {
          if (canDraw(sharedParent.lowerGate, sibling.upperGate)) {
            // Slektsskaps-linje: Tegnes fra forelderens bunnport til søskenets toppport
            DrawingUtils.drawLink(sharedParent.lowerGate, sibling.upperGate, links, offBy, canvas);
          }
        } else if (parents.length > 0 && parents[0]) {
          if (canDraw(parents[0].lowerGate, sibling.upperGate)) {
            // Fallback for undefined-noder i runde 2: Koble til første tilgjengelige forelder
            DrawingUtils.drawLink(parents[0].lowerGate, sibling.upperGate, links, offBy, canvas);
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