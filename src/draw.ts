import { Point } from "obsidian";
import { GATE_DOWN, GATE_LEFT, GATE_RIGHT, GATE_UP, LeftTop, } from "./settings";
import { Direction, Gate, RelatedData, RelatedNode } from "./data";

export class Draw {
  readonly gateColor: string = 'var(--bases-table-header-color)';
  private containerEl: HTMLElement;
  private backContainerSVG: SVGSVGElement;
  readonly GATE_RADIUS = 2.5;
  private offBy: Point = {x:0,y:0};
  factor: number = 1;

  allGates(related: RelatedData) {
    let center = related.centerNode!;
    this.gatesForNodes([center]);
    this.gatesForNodes(center.upperGate?.connections);
    this.gatesForNodes(center.lowerGate?.connections);
    this.gatesForNodes(center.lowerGate?.unspecified);
    this.gatesForNodes(related.siblings);
    this.gatesForNodes(center.friendGate?.connections);
  }

  allConnects(related:RelatedData) {
      
    this.backContainerSVG.empty()
    
    this.centralVerticals(related.centerNode!);
    this.centralHorisontals(related.centerNode!)
    this.siblingsVerticals(related.siblings);
  };

  // ========= measuring ==================
  updateOffBy() {
    const svg = this.containerEl.createSvg("svg", {
      attr: {
        width: "1px",
        height: "1px",
        style: `position: absolute; z-index: -10; top: 0; left: 0; `
      }
    });
    const rect = svg.getBoundingClientRect();
    const x = window.pageXOffset-rect.x; 
    const y = window.pageYOffset-rect.y;

    this.offBy = {x: x, y: y};
  }

    

  // ===================== Private functions =====================
  constructor(
    containerEl: HTMLElement,
    backContainerSVG: SVGSVGElement 
  ){
    this.containerEl = containerEl;
    this.backContainerSVG = backContainerSVG;
  }

  // ========= organizers ==================

  private centralVerticals(central: RelatedNode) {
    
    central.upperGate.connections.forEach(relatedNode => {
      this.connectGates(relatedNode.lowerGate, central.upperGate);
    });
    central.lowerGate.connections.forEach(relatedNode => {
      this.connectGates(central.lowerGate, relatedNode.upperGate, );
    });
    central.lowerGate.unspecified.forEach(relatedNode => {
      this.connectGates(central.lowerGate, relatedNode.upperGate, );
    });
  }

  private centralHorisontals(central: RelatedNode) {
    central.friendGate.connections.forEach((relatedNode: any) => {
      this.horisontalConnect([central, relatedNode]);
    });
  }

  private siblingsVerticals(siblings: RelatedNode[], ) {
    
    const c = this.containerEl.getBoundingClientRect();

    siblings.forEach((sibling: RelatedNode) => {

      const s = sibling.div!.getBoundingClientRect();
      if (s.left > c.right ) {return};

      sibling.upperGate.connections.forEach((upperNode: RelatedNode) => {
        this.connectGates(upperNode!.lowerGate, sibling.upperGate); 
      })
    });
  }
    
  private gatesForNodes (connections: RelatedNode[]) {
    connections.forEach(cn => {
      cn.upperGate.svg = this.drawGate2(GATE_UP, cn.upperGate, cn!.div!);
      cn.lowerGate.svg = this.drawGate2(GATE_DOWN, cn.lowerGate, cn!.div!);
      cn.friendGate.svg = this.drawGate2(
        cn.friendGate.direction == 'right'
          ? GATE_RIGHT
          : GATE_LEFT,
        cn.friendGate, 
        cn!.div!
      );
    });
  }

  private connectGates(lowerGate: Gate, upperGate: Gate) {
    
    const rect = [
      lowerGate.svg?.getBoundingClientRect(),
      upperGate.svg?.getBoundingClientRect()
    ] 
    
    this.drawBezier(
      {
        x: rect[0]!.x + this.offBy.x,
        y: rect[0]!.y + this.offBy.y
      },
      "down",
      {
        x: rect[1]!.x + this.offBy.x,
        y: rect[1]!.y + this.offBy.y
      }, 
      "up",
      this.backContainerSVG
    );
  }

  private horisontalConnect(node: [RelatedNode, RelatedNode]) {
    
    var left: number;
    var right: number;
    
    // determine what gates are to be connected
    if (node[0].relation == 'center' && node[1].relation == 'friend'){
      left = 1;
      right = 0;
    } else { 
      left = 0;
      right = 1;
    };

    const rect = [
      node[left]!.friendGate.svg?.getBoundingClientRect(),
      node[right]!.friendGate.svg?.getBoundingClientRect()
    ] 
    
    this.drawHoriontalBezier(
      {
        x: rect[0]!.x + this.offBy.x,
        y: rect[0]!.y + this.offBy.y
      },
      "left",
      {
        x: rect[1]!.x + this.offBy.x,
        y: rect[1]!.y + this.offBy.y
      }, 
      "right",
      this.backContainerSVG
    );
  }

  // ========= drawing ==================
  private drawBezier(p1: Point, dir1: Direction, p2:Point, dir2: Direction, svg: SVGSVGElement) {

    var c1: Point = {x: p1.x, y: 0};
    var c2: Point = {x: p2.x, y: 0};
    
    const ydiff = p2.y-p1.y;

    if ((ydiff >= -10) && (dir1 == 'down')) {
      c1.y = (p1.y + Math.max(ydiff, 60)*0.75);
      c2.y = (p2.y - Math.max(ydiff, 60)*0.75);
    } else if ((ydiff < -10) && (dir1 == 'down')) {
      c1.y = (p1.y - Math.min(ydiff, -60)*0.75); 
      c2.y = (p2.y + Math.min(ydiff, -60)*0.75); 
    } else if ((ydiff < 0) && (dir1 == 'up')) {
      console.log('not in use')
    } else { // ((ydiff >= 0) && (dir1 == 'up')) { - not likely
      console.log('not in use2')
    }
    
    this.plotPath(p1, c1, c2, p2, svg);
  }

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
