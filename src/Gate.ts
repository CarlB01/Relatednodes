import { Point } from "obsidian";
import { Node } from "./Node";
import { RV } from "./constants";

export type Direction = "up" | "down" | "left" | "right";

/**
 * Manages the layout properties and connection logic for individual docking port connectors.
 * Leverages high-performance structural memory bounds to process real-time geometry queries.
 */
export class Gate {
  direction: Direction;
  svg: SVGSVGElement | null = null;
  circleEl: SVGCircleElement | null = null;
	
  areaElement: HTMLElement | null = null;
  parentNote: Node;
  public static cachedRadius: number | null = null;

  constructor(parentNote: Node, direction: Direction) {
    this.parentNote = parentNote;
    this.direction = direction;
  }

  /**
   * Generates or recycles the specific SVG element framework for this connection gate.
   * Returns a configured SVGSVGElement ready for immediate DOM tree insertion.
   */
  public render(): SVGSVGElement {

    const parentDiv = this.parentNote.div;
    
    // Constant-time RAM connection state query (Sourced via O(1) memory checking)
    const hasConnections = this.hasActiveConnections();
    
    // 1. REUSE ENGINE: Verifies if the element exists in memory AND is physically 
    // mounted inside the correct parent layout capsule wrapper.
    if (this.svg && this.circleEl && parentDiv && parentDiv.contains(this.svg)) {
      if (hasConnections) {
        this.svg.classList.add('is-connected');
      } else {
        this.svg.classList.remove('is-connected');
      }
      return this.svg;
    }
    
    // 2. VECTOR INSTANTIATION: Executed exclusively on initial creation lifecycle
    // Avoids hardcoded width/height constraints; uses a virtual viewBox grid.
    this.svg = createSvg("svg", {
      attr: {
        viewBox: "0 0 10 10", 
        class: `${RV.GATE_SVG} ${this.direction}`,
        style: "position: absolute; z-index: 5; overflow: visible;"
      }
    });
    
    if (hasConnections) {
      this.svg.classList.add('is-connected');
    }

    // Positions vector circle locked directly to the center of the relative grid mesh
    this.circleEl = this.svg.createSvg("circle", {
      attr: {
        cx: "5",   
        cy: "5",   
        r: "4",    
      }
    });

    return this.svg;
  }

  /**
   * Evaluates the absolute midpoint layout coordinate point for the connection target vector.
   * Caches boundary dimensions exactly once per layout pass to protect CPU velocity.
   */
  center(): Point {
    if (!this.svg) return { x: 0, y: 0 };
    
    // Measures raw coordinates bound explicitly to the specific port node viewport rect
    const rect = this.svg.getBoundingClientRect();
    
    if (Gate.cachedRadius === null && rect.width > 0) {
      Gate.cachedRadius = rect.width / 2;
    }

    const r = Gate.cachedRadius || 4; 

    return {
        x: rect.left + r,
        y: rect.top + r
    };
  }

  /**
   * High-speed validation state evaluation checking structural network sets.
   * Direct routing rules defining matching paths mapped to the 3-rule vector paths.
   */
  private hasActiveConnections(): boolean {
    const rel = this.parentNote.relations;
    const area = this.parentNote.assignedArea;
    const dir = this.direction; 

    // ==========================================================================
    // TIER 1: VERTICAL CONNECTIONS BOUNDARIES (Parents / Children Spine Mappings)
    // ==========================================================================
    if (dir === "up") {
      if (area === "lower") return true; 
      if (area === "right") return true; 
      return rel.parents.size > 0;       
    }

    if (dir === "down") {
      if (area === "upper") return true; 
      return rel.children.size > 0;      
    }

    // ==========================================================================
    // TIER 2: LATERAL CONNECTIONS BOUNDARIES (Cross-quadrant friend intersections)
    // ==========================================================================
    const harHorisontaleRelasjoner = rel.friends.size > 0; 

    if (harHorisontaleRelasjoner) {
      if (area === "center") {
        return dir === "left";
      }

      if (area === "left") {
        return dir === "right";
      }

      if (area === "right") {
        return dir === "left";
      }

      if (dir === "left" || dir === "right") {
        return true; 
      }
    }

    return false;
  }
}
