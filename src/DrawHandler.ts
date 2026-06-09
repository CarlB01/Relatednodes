import { Point } from "obsidian";
import { GATE_DOWN, GATE_LEFT, GATE_RIGHT, GATE_UP, LeftTop, } from "./settings.js";
import { Gate, NoteProperties, RelatedData } from "./data.js";
import { Areas } from "./Areas.js";

export class DrawHandler {
  readonly gateColor: string = 'var(--bases-table-header-color)';
  readonly GATE_RADIUS = 2.5;
  private areas: Areas;
  private related: RelatedData;
  private redrawTimeout: ReturnType<typeof setTimeout> | null = null;
  
  factor: number = 1;
  offBy: Point = {x:0,y:0};
  scrolledOffby: Point = {x:0,y:0};
  private rafId: number | null = null;

  allGates() {
    let center = this.related.centerNote!;
    this.gatesForNotes([center]);
    this.gatesForNotes(center.upperGate?.connections!);
    this.gatesForNotes(center.lowerGate?.connections!);
    this.gatesForNotes(center.lowerGate?.unspecified!);
    this.gatesForNotes(this.related.siblings);
    this.gatesForNotes(center.friendGate?.connections!);
  }

  requestRedraw() {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    
    this.rafId = requestAnimationFrame(() => {
        this.allConnects();
        // Add other lightweight live updates here
        this.rafId = null;
    });
  }

  updateOffBy() {
    if (this.offBy.x != 0) return;
    
    const svg = this.areas.containerEl.createSvg("svg", {
      attr: {
        width: "1px",
        height: "1px",
        style: `position: absolute; z-index: -10; top: 0; left: 0; `
      }
    });
    const rect = svg.getBoundingClientRect();
    const x = rect.x; 
    const y = rect.y; // window.pageYOffset-

    this.offBy = {x: x, y: y};
  }
  constructor(
    area: Areas,
    related: RelatedData
  ){
    this.areas = area;
    this.related = related;
  }

  // ========= organizers ==================

  private centralVerticals(central: NoteProperties) {
    central.upperGate!.connections.forEach(relatedNote => {
      this.connectGates(relatedNote.lowerGate!, central.upperGate!, 'parent-area');
    });
    
    const mainLowerRect = this.areas.bottom.getBoundingClientRect(); 
    central.lowerGate!.connections.forEach(relatedNote => {
      if (this.outsideOf(relatedNote.upperGate!, mainLowerRect)) return;
      this.connectGates(central.lowerGate!, relatedNote.upperGate!, 'lower-area');
    });

    central.lowerGate!.unspecified.forEach(relatedNote => {
      if (this.outsideOf(relatedNote.upperGate!, mainLowerRect)) return;
      this.connectGates(central.lowerGate!, relatedNote.upperGate!, 'lower-area');
    });
  }

  private centralHorisontals(central: NoteProperties) {
    central.friendGate!.connections.forEach((relatedNote: any) => {
      this.horisontalConnect([central, relatedNote]);
    });
  }

  private siblingsVerticals(siblings: NoteProperties[], ) {
    
    const container = this.areas.right.getBoundingClientRect();

    siblings.forEach((sibling: NoteProperties) => {

      
      if (this.outsideOf(sibling.upperGate!, container)) {return};

      sibling.upperGate!.connections.forEach((upperNote: NoteProperties) => {
        this.connectGates(upperNote!.lowerGate!, sibling.upperGate!, 'sibling-area'); 
      })
    });
  }
    
  private gatesForNotes (connections: NoteProperties[]) {
    connections.forEach(cn => {
      cn.upperGate!.svg = this.drawGate2(GATE_UP, cn.upperGate!, cn!.div!);
      cn.lowerGate!.svg = this.drawGate2(GATE_DOWN, cn.lowerGate!, cn!.div!);
      cn.friendGate!.svg = this.drawGate2(
        cn.friendGate!.direction == 'right'
          ? GATE_RIGHT
          : GATE_LEFT,
        cn.friendGate!, 
        cn!.div!
      );
    });
  }

  private connectGates(lowerGate: Gate, upperGate: Gate, area:string) {
    
    const rect = [
      lowerGate.svg?.getBoundingClientRect(),
      upperGate.svg?.getBoundingClientRect()
    ] 
    this.drawBezier(
      {
        x: rect[0]!.x + this.scrolledOffby.x,
        y: rect[0]!.y + this.scrolledOffby.y
      },
      {
        x: rect[1]!.x + this.scrolledOffby.x,
        y: rect[1]!.y + this.scrolledOffby.y
      },
      area,
      this.areas.backContainerSVG
    );
  }

  private horisontalConnect(note: [NoteProperties, NoteProperties]) {
    
    var left: number;
    var right: number;
    
    // determine what gates are to be connected
    if (note[0].relation == 'center' && note[1].relation == 'friend'){
      left = 1;
      right = 0;
    } else { 
      left = 0;
      right = 1;
    };

    const rect = [
      note[left]!.friendGate!.svg?.getBoundingClientRect(),
      note[right]!.friendGate!.svg?.getBoundingClientRect()
    ] 
    
    this.drawHorizontalBezier(
      {
        x: rect[0]!.x + this.scrolledOffby.x,
        y: rect[0]!.y + this.scrolledOffby.y
      },
      {
        x: rect[1]!.x + this.scrolledOffby.x,
        y: rect[1]!.y + this.scrolledOffby.y
      },
      this.areas.backContainerSVG
    );
  }

  // ========= measures ==================

  private outsideOf(subGate: Gate, containerRect: DOMRect): boolean {
    let s = subGate.svg!.getBoundingClientRect(); 
    let c = containerRect; 
    if (s.right > c.right || s.left < c.left) {return true};
    if (s.top < c.top || s.bottom > c.bottom) {return true};
    return false;
  }

  // ========= drawing ==================
  
  allConnects() {
    
    let related = this.related;
    if (!related.centerNote) return;

    this.areas.backContainerSVG.style.width = '100%';
    this.areas.backContainerSVG.style.height = '100%';

    this.scrolledOffby = {
      x: window.scrollX - this.offBy.x,
      y: window.scrollY - this.offBy.y
    };

    // friend-area, sibling-area, parent-area, lower-area
      this.areas.backContainerSVG.empty();
      this.centralVerticals(related.centerNote!);
      this.centralHorisontals(related.centerNote!)
      this.siblingsVerticals(related.siblings);
  };

  private drawBezier(
    p1: Point, 
    p2: Point, 
    area: string,
    svg: SVGSVGElement,
    options: { color?: string; strokeWidth?: number; curvature?: number } = {}
  ) {
    const { color = this.gateColor, strokeWidth = 0.5 * this.factor, curvature = 0.75 } = options;

    const ydiff = Math.abs(p2.y - p1.y);

    const c1: Point = { x: p1.x, y: 0 };
    const c2: Point = { x: p2.x, y: 0 };

    // Vertical Bézier curve logic
    if (ydiff >= 10) {
        // Going downwards (or almost horizontal)
        const distance = Math.max(ydiff, 60);
        c1.y = p1.y + distance * curvature;
        c2.y = p2.y - distance * curvature;
    } else {
        // Going upwards
        const distance = Math.min(ydiff, -60);
        c1.y = p1.y - distance * curvature;   
        c2.y = p2.y + distance * curvature;
    }

    this.plotPath(p1, c1, c2, p2, area, svg, color, strokeWidth);
  }

  private drawHorizontalBezier(
    p1: Point, 
    p2: Point, 
    svg: SVGSVGElement,
    options: { color?: string; strokeWidth?: number; curvature?: number } = {}
  ) {
    const { color = this.gateColor, strokeWidth = 0.5 * this.factor, curvature = 0.75 } = options;

    const xdiff = p2.x - p1.x;

    const c1: Point = { 
        x: p1.x + xdiff * curvature, 
        y: p1.y 
    };

    const c2: Point = { 
        x: p2.x - xdiff * curvature, 
        y: p2.y 
    };

    this.plotPath(p1, c1, c2, p2, 'friend-area', svg, color, strokeWidth);
  }

/*
  private drawHoriontalBezier(p1: Point, dir1: Direction, p2:Point, dir2: Direction, svg: SVGSVGElement) {

    var c1: Point = {x: 0, y: p1.y};
    var c2: Point = {x: 0, y: p2.y}; 
    
    const xdiff = p2.x-p1.x;

    if (xdiff >= 0) {
      c1.x = (p1.x + xdiff*0.75);
      c2.x = (p2.x - xdiff*0.75);
    } else {
      c1.x = (p1.x - xdiff*0.75);
      c2.x = (p2.x + xdiff*0.75);
    }

    this.plotPath(p1, c1, c2, p2, svg);
  }
  
  */

  private plotPath(
    p1: Point, 
    c1: Point, 
    c2: Point, 
    p2: Point, 
    attrib: string = '',
    svg: SVGSVGElement,
    color: string,
    strokeWidth: number
) {
    const d = `M ${p1.x.toFixed(2)} ${p1.y.toFixed(2)} 
               C ${c1.x.toFixed(2)} ${c1.y.toFixed(2)}, 
                 ${c2.x.toFixed(2)} ${c2.y.toFixed(2)}, 
                 ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;

    svg.createSvg("path", {
        attr: {
            d,
            stroke: color,
            "stroke-width": strokeWidth.toFixed(2),
            fill: "transparent",
            class: attrib,
            "stroke-linecap": "round",
            "vector-effect": "non-scaling-stroke"   // helps with zooming
        }
    });
}
/*
  private plotPath(p1:Point, c1: Point, c2: Point, p2:Point, svg: SVGSVGElement) {
    
    const formatCoord = (p: Point): string => {
      return `${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
    };

    const path = `M ${formatCoord(p1)} C ${formatCoord(c1)}, ${formatCoord(c2)}, ${formatCoord(p2)}`;
    
    svg.createSvg("path", {
      attr: {
        d: path,
        stroke: this.gateColor, //this.gateColor, // Bruker Obsidians fargetema
          "stroke-width": (0.5 * this.factor).toFixed(1),
        fill: "transparent"
      },
    });

  }
*/
  private drawGate2(pos: LeftTop, gate: Gate, el: HTMLElement): SVGSVGElement {

    const radius = this.GATE_RADIUS;
    const contentsCount = gate.connections.length + gate.unspecified.length;
    return this.drawCircle(
      pos.left,
      pos.top,
      radius, 
      (contentsCount == 0)
        ? "transparent"
        : this.gateColor, 
      el
    );

  } 

  private drawCircle(left: string, top: string, r: number, fill: string, el: HTMLElement): SVGSVGElement {
    const svg = el.createSvg("svg", {
      attr: {
        width: r*2,
        height: r*2,
        style: `position: absolute; z-index: 5; left: ${left}; top: ${top}; `
      }
    });
    svg.createSvg("circle", {
      attr: {
        r: r * this.factor,
        fill: fill,
        stroke: fill == 'transparent'
          ? this.gateColor
          : fill, // Bruker Obsidians fargetema
          "stroke-width": this.factor.toFixed(1),
      },
    });
    svg.setAttribute("overflow", "visible");
    
    return svg
  }
}
