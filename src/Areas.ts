import { Point } from "obsidian";
import { updateMessage } from "./view.js";
import { NoteProperties, RelatedData } from "./data.js";
import RelatednotesPlugin from "./main.js";
import { LinksHandler } from "./LinksHandler.js";
import { DrawHandler } from "./DrawHandler.js";

export class Areas {
  
  readonly containerDescr = 'related-view-container'
  private readonly svgLayerDescr = 'related-svg-layer';
  
  private readonly areaDescr = 'related-area';
  private readonly centerAreaDescr = 'related-center-area';
  private readonly leftAreaDescr = 'related-left-area';
  private readonly rightAreaDescr = 'related-right-area';
  private readonly topAreaDescr = 'related-top-area';
  private readonly bottomAreaDescr = 'related-bottom-area';

  private readonly groupDivDescr = 'related-groups';
  private readonly columnsDescr = 'related-columns';
  private readonly linkDescr = 'related-link';
  private readonly linkDivDescr = 'related-linkDiv'
  private readonly compactLinkDescr = 'related-compact';

  containerEl: HTMLElement;
  backContainerSVG: SVGSVGElement;

  center: HTMLElement;
  left: HTMLElement;
  right: HTMLElement;
  top: HTMLElement;
  bottom: HTMLElement;
  
  private rightAreaResizeObserver: ResizeObserver | null = null;
  private bottomAreaResizeObserver: ResizeObserver | null = null;
  
  private related: RelatedData;
  draw: DrawHandler;
  private links: LinksHandler;

  constructor(
    related: RelatedData,
    
    links: LinksHandler,
    parentEl: HTMLElement,
    public plugin: RelatednotesPlugin
  ){
    this.related = related;
    this.draw = new DrawHandler(this, this.related);
    this.links = links;

    this.containerEl = parentEl;
    this.containerEl.addClass(this.containerDescr);

    this.center = this.containerEl.createDiv(`${this.areaDescr} ${this.centerAreaDescr}`);
    this.left  = this.containerEl.createDiv(`${this.areaDescr} ${this.leftAreaDescr}`);
    this.right = this.containerEl.createDiv(`${this.areaDescr} ${this.rightAreaDescr}`);
    this.top = this.containerEl.createDiv(`${this.areaDescr} ${this.topAreaDescr}`);
    this.bottom = this.containerEl.createDiv(`${this.areaDescr} ${this.bottomAreaDescr}`);

    this.backContainerSVG = this.containerEl.createSvg("svg", this.svgLayerDescr);
  }

  resetScaleFactor() { this.draw.factor = 1};

  registerMonitors(callback: (callId: updateMessage) => void) {

    let containerEl = this.containerEl;
    let plugin = this.plugin;

    if (!containerEl) return;

    // Main container scroll
    plugin.registerDomEvent(containerEl, 'scroll', () => {
      callback('viewContainerScrolled') 
    }, { 
      passive: true 
    });
    
    // Right Area scroll
    plugin.registerDomEvent(this.right, 'scroll', () => {
       callback('rightAreaScrolled') 
    },{ 
      passive: true 
    });

    //Bottom area scroll
    plugin.registerDomEvent(this.bottom, 'scroll', () => { 
      callback('bottomAreaScrolled') 
    },{ passive: true 
    });

    // Right area ResizeObserver
    this.rightAreaResizeObserver = new ResizeObserver(() => {

      const rightHeight = this.right.scrollHeight;
      const availableHeight = this.center.getBoundingClientRect().bottom + window.pageYOffset - this.draw.offBy.y;
      console.log('resizing ...')
      if (rightHeight > availableHeight) {
        this.bottom.classList.add('narrow');
        this.right.classList.remove('short');
      } else {
        this.bottom.classList.remove('narrow');
        this.right.classList.add('short');
      }
      callback('rightAreaResized');
    });
    this.rightAreaResizeObserver.observe(this.right);

    plugin.register(() => {
      this.rightAreaResizeObserver?.disconnect();
      this.rightAreaResizeObserver = null;
    });

    // Bottom area ResizeObserver
    this.bottomAreaResizeObserver = new ResizeObserver((entries) => {
      callback('bottomAreaResized');
    });
    this.bottomAreaResizeObserver.observe(this.bottom);  

    plugin.register(() => {
      this.bottomAreaResizeObserver?.disconnect();
      this.bottomAreaResizeObserver = null;
    });
  }

  checkContentOverflow() {
    this.draw.factor = this.calcScaleFactor(this.top, this.center, this.bottom);
    this.scaleCSS(this.draw.factor);
  }
  
  handleResize() {
    this.checkContentOverflow();
    // all gates are now repositioned - need to redraw connections
    this.draw.requestRedraw();
  }
  
  updateOffBy() {this.draw.updateOffBy()}
  drawAllGates() { this.draw.allGates()};
  drawAllConnections() {this.draw.requestRedraw()};

  plotAll() {
    let centerNote = this.related.centerNote!;
    this.plot(this.center, [[centerNote]]);
    this.plot(this.top, [centerNote.upperGate!.connections]);
    this.plot(this.right, [this.related.sortedSiblings()]);
    this.plot(this.left, [centerNote.friendGate!.connections]);
    this.plot(this.bottom, 
      [centerNote.lowerGate!.connections,
      centerNote.lowerGate!.unspecified]);
  }

  private plot (
    area: HTMLElement,
    collections: NoteProperties[][]
  ){
    
    area.empty();

    const noteCount = collections.flat().length;
    const columnCount = this.calcColumns(noteCount, area).toString();
    area.style.setProperty('columns',`3rem ${columnCount}`);
    
    const compactType = area.hasClass(this.rightAreaDescr)
      ? this.compactLinkDescr
      : this.linkDescr;
    
    collections.forEach(collection => {
      const groupedNotes = this.related.groupByFirstTag(collection);
      const columnsDiv = area.createDiv(this.columnsDescr);
      
      groupedNotes.forEach(group => {
        const groupDiv = columnsDiv.createDiv(this.groupDivDescr);
        group.notes.forEach(note => {
          const linkDiv = groupDiv.createDiv(this.linkDivDescr);
          note.div = this.links.buildFileLink(linkDiv, note, compactType);
          this.links.buildInfoBtn(note);        
        });
        // hide with minus sign if too many notes in group
        if (group.notes.length > 4 && noteCount > 20) {
          this.links.buildPlusMinusBtn(group.notes.first()!.div!, group);
          group.notes.slice(1).forEach(note => {
            note.div?.parentElement?.classList.add('hidden');
          });
        }
      });
    });
  }

  private calcColumns(noteCount: number, region: HTMLElement) {
    
    if ([this.left, this.right].contains(region)) {
      return noteCount  < 5
        ? 1
        : noteCount < 11 
          ? 2
          : noteCount < 31
            ? 3
            : noteCount < 81
              ? 4
              : 5;  
    };
    return noteCount  < 3
      ? noteCount
      : noteCount < 11 
        ? 2
        : noteCount < 31
          ? 3
          : noteCount < 81
            ? 4
            : 5;
  }

  private calcScaleFactor (
    upper:HTMLElement, 
    center:HTMLElement, 
    lower:HTMLElement
  ): number {
    if (!upper || !center || !lower) { return 1};

    const totalHeight = 
          upper.getBoundingClientRect().height
        + center.getBoundingClientRect().height
        + lower.getBoundingClientRect().height;       

    if (totalHeight == 0) { return 1}

    const windowHeight = window.innerHeight-100;
    const fract = windowHeight/totalHeight;
    const smallpart = (1-fract-0.01)/4;
    const oldFactor = this.draw.factor;
    const newFactor = fract + smallpart;

    const minimalval = fract > 1 ? 1 : 0.9
    return Math.min(oldFactor * newFactor, minimalval);
  }

  private scaleCSS(value: number) {
    this.containerEl.style.setProperty('--scaleFactor', value.toFixed(2));
  }

}