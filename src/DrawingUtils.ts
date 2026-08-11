import { Point } from "obsidian";
import { Gate } from "./Gate";

/**
 * High-performance vector rendering utility for SVG path generations.
 * Calculates mathematical control points for seamless horizontal and vertical Bezier curve mappings.
 */
export class DrawingUtils {
  
  /**
   * Evaluates the relative distance vector between two point hashes (p1 - p2).
   */
  static sub = (p1: Point, p2: Point): Point => ({ x: p1.x - p2.x, y: p1.y - p2.y });

  /**
   * Toggles visibility hidden state inside the active line cache pool.
   * Invoked instantly when a node viewport boundaries scroll out of bounds.
   * COMPLIANT REFACTOR: Replaces unsafe 'any' maps with explicit structural layout interfaces [dan].
   * @param fromGate The originating structural Gate node wrapper instance.
   * @param toGate The target destination Gate node wrapper instance.
   * @param linkCache The centralized memory map matrix tracking active vector paths.
   */
  private static hideLineInCache(
    fromGate: Gate, 
    toGate: Gate, 
    linkCache: Map<string, { svgElement: SVGPathElement; used: boolean }>
  ) {
    const pathA = fromGate.parentNote.path;
    const pathB = toGate.parentNote.path;

    const lineId = pathA.localeCompare(pathB) < 0 
      ? `${pathA}->${pathB}` 
      : `${pathB}->${pathA}`;
    
    // ==========================================================================
    // TYPESAFE CACHE FETCHING: Since linkCache is strictly typed above,
    // TypeScript knows that cacheItem contains a native SVGPathElement seamlessly [dan]!
    // ==========================================================================
    const cacheItem = linkCache.get(lineId);
    if (cacheItem && cacheItem.svgElement) {
      cacheItem.svgElement.addClass('is-hidden');
    }
  }

  /**
   * Primary orchestrator compiling vector curves between docking nodes with full cache reuse.
   * Incorporates real-time parent container scrolling boundaries to prune clipped paths instantly.
   * @param fromGate Source vector connector point.
   * @param toGate Target vector connector point.
   * @param linkCache Centralized map containing all generated SVG path elements.
   * @param offBy Global coordinate layout offset point data.
   * @param svgContainer Target background layer where path nodes are physically mounted.
   */
  static drawLink(
      fromGate: Gate, 
      toGate: Gate, 
      linkCache: Map<string, { svgElement: SVGPathElement; used: boolean }>,
      offBy: Point,
      svgContainer: SVGSVGElement,
      strokeColor: string | null = null
  ) {
    // 1. VIEWPORT GUTTER CHECK: Intercept paths if gates have scrolled outside active view segments
    const rawP1 = fromGate.center();
    const rawP2 = toGate.center();

    if (!fromGate || !toGate || !fromGate.areaElement || !toGate.areaElement) {
        return;
    }

    const areaRectFrom = fromGate.areaElement.getBoundingClientRect();
    if (areaRectFrom) {
        if (rawP1.y < areaRectFrom.top || rawP1.y > areaRectFrom.bottom) {
            this.hideLineInCache(fromGate, toGate, linkCache);
            return;
        }
    }

    const areaRectTo = toGate.areaElement.getBoundingClientRect();
    if (areaRectTo) {
        if (rawP2.y < areaRectTo.top || rawP2.y > areaRectTo.bottom) {
            this.hideLineInCache(fromGate, toGate, linkCache);
            return;
        }
    }

    // 2. COORDINATE TRANSLATION: Deduct layout offset deltas to secure localized map placements
    const p1 = this.sub(rawP1, offBy);
    const p2 = this.sub(rawP2, offBy);

    const pathA = fromGate.parentNote.path;
    const pathB = toGate.parentNote.path;

    const lineId = pathA.localeCompare(pathB) < 0 
      ? `${pathA}->${pathB}` 
      : `${pathB}->${pathA}`;

    // 3. CACHE VALUATION & INSTANCE RECYCLING
    let cacheItem = linkCache.get(lineId);
    let pathEl: SVGPathElement;

    if (cacheItem) {
        pathEl = cacheItem.svgElement;
        
        pathEl.removeClass('is-hidden'); 
        
        if (!svgContainer.contains(pathEl)) {
            svgContainer.appendChild(pathEl);
        }
        cacheItem.used = true;
    } else {        
        pathEl = svgContainer.createSvg("path", {
            attr: {
                id: lineId,
                class: "rv-link-path",
                fill: "none"
            }
        });
        linkCache.set(lineId, { svgElement: pathEl, used: true });
    }
    linkCache.get(lineId)!.used = true;

    // 4. PATH COMPILES: Dynamically build Bezier string paths based on explicit docking targets
    const dAttribute = this.calculateBezierPath(p1, p2, fromGate, toGate);

    // 5. DOM HYDRATION: Commit the string trajectory parameter down to the target path node
    pathEl.setAttribute("d", dAttribute);

    // 6. Optional per-link color override (falls back to CSS when null)
    if (strokeColor && strokeColor.trim().length > 0) {
      if (pathEl.style.stroke !== strokeColor) {
        pathEl.style.stroke = strokeColor;
      }
    } else if (pathEl.style.stroke) {
      pathEl.style.removeProperty("stroke");
    }
  }

  /**
   * Compiles Bezier path configurations and returns a normalized SVG "d" vector string.
   */
  private static calculateBezierPath(
    p1: Point, 
    p2: Point, 
    fromGate: Gate, 
    toGate: Gate
  ): string {
    // Evaluates vector alignment to select either vertical spine mapping or horizontal gate routing
    const isFriendLink = fromGate.direction === 'left' || fromGate.direction === 'right';

    if (isFriendLink) {
        // === HORIZONTAL BEZIER CURVE CHANNEL ===
        const bendStrength = Math.max(35, Math.abs(p2.x - p1.x) * 0.4);

        const dirA = fromGate.direction === 'left' ? -1 : 1;
        const cp1x = p1.x + (bendStrength * dirA);
        const cp1y = p1.y; 

        const dirB = toGate.direction === 'left' ? -1 : 1;
        const cp2x = p2.x + (bendStrength * dirB);
        const cp2y = p2.y; 

        return `M ${p1.x} ${p1.y} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
    }

    // ==========================================================================
    // VERTICAL BEZIER S-CURVE CHANNEL (Parents / Children Spine Routing)
    // ==========================================================================
    const verticalStrength = Math.max(40, Math.abs(p2.y - p1.y) * 0.7);

    // Locks horizontal axis delta targets to guarantee 100% vertical launch angles
    const dirVertA = fromGate.direction === 'up' ? -1 : 1;
    const cp1x = p1.x; 
    const cp1y = p1.y + (verticalStrength * dirVertA);

    // Locks horizontal landing delta targets to guarantee 100% vertical arrival angles
    const dirVertB = toGate.direction === 'up' ? -1 : 1;
    const cp2x = p2.x; 
    const cp2y = p2.y + (verticalStrength * dirVertB);

    return `M ${p1.x} ${p1.y} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
  }
}
