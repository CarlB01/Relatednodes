import { Point } from "obsidian";
import { GateProperties } from "./GateClass";

export class DrawingUtils {
  
  static GATE_COLOR = 'var(--bases-table-header-color)';
  static GATE_RADIUS = 2.5;
  static FACTOR = 1;

  // Liten hjelpemetode for å beregne p1 minus p2
  static sub = (p1: Point, p2: Point): Point => ({ x: p1.x - p2.x, y: p1.y - p2.y });

  // Liten hjelpemetode for å skjule linjen hvis den ruller ut av syne
  private static hideLineInCache(fromGate: GateProperties, toGate: GateProperties, linkCache: Map<string, any>) {
    const lineId = `${fromGate.parentNote.basename}->${toGate.parentNote.basename}`;
    const cacheItem = linkCache.get(lineId);
    if (cacheItem) cacheItem.svgElement.style.display = 'none';
  }

  /**
   * Hovedmetode for å tegne en linje mellom to porter med full gjenbruk via cache.
   */
  static drawLink(
      fromGate: GateProperties, 
      toGate: GateProperties, 
      linkCache: Map<string, { svgElement: SVGPathElement; used: boolean }>,
      offBy: Point,
      svgContainer: SVGSVGElement
  ) {
    // 1. SJEKK OM PORTENE ER SCROLLET UT AV SINE RESPEKTIVE OMRÅDER (Kritisk presisjon)
    // Vi bruker de rå skjermkoordinatene (getGateCenter uten å trekke fra offBy ennå)
    const rawP1 = fromGate.center();
    const rawP2 = toGate.center();

    // Sjekk fromGate (P1) mot sitt eget område
    if (fromGate.areaElement) {
        const areaRect = fromGate.areaElement.getBoundingClientRect();
        // Hvis gaten er over toppen eller under bunnen av sitt EGET rullefelt:
        if (rawP1.y < areaRect.top || rawP1.y > areaRect.bottom) {
            this.hideLineInCache(fromGate, toGate, linkCache);
            return;
        }
    }

    // Sjekk toGate (P2) mot sitt eget område
    if (toGate.areaElement) {
        const areaRect = toGate.areaElement.getBoundingClientRect();
        if (rawP2.y < areaRect.top || rawP2.y > areaRect.bottom) {
            this.hideLineInCache(fromGate, toGate, linkCache);
            return;
        }
    }

    // 2. Hvis begge overlevde sjekken, beregner vi de relative SVG-koordinatene som før
    const p1 = this.sub(rawP1, offBy);
    const p2 = this.sub(rawP2, offBy);

    const lineId = `${fromGate.parentNote.basename}->${toGate.parentNote.basename}`;
    
    // 3. CACHE-SJEKK & TEGNING
    let cacheItem = linkCache.get(lineId);
    let pathEl: SVGPathElement;

    if (cacheItem) {
        pathEl = cacheItem.svgElement;
        pathEl.style.display = ''; // Vis den igjen hvis den var skjult
        cacheItem.used = true;
    } else {
        pathEl = svgContainer.createSvg("path", {
            attr: {
                id: lineId,
                stroke: this.GATE_COLOR,
                "stroke-width": 0.5 * this.FACTOR,
                fill: "none"
            }
        });
        linkCache.set(lineId, { svgElement: pathEl, used: true });
    }

      // 4. BEZIER-DIRECTION: Oversett portenes retning til din bezier-retning
      let bezierDir: 'up' | 'down' | 'horizontal' | 'friend' = 'down';
      if (fromGate.direction === 'left' || fromGate.direction === 'right') bezierDir = 'friend';
      else if (fromGate.direction === 'up') bezierDir = 'up';
      else if (fromGate.direction === 'down') bezierDir = 'down';

      // 5. MATHS: Beregn bezier-kurven ved hjelp av din eksisterende logikk
      const dAttribute = this.calculateBezierPath(p1, p2, bezierDir);
      
      // 6. UPDATE: Oppdater stien i DOM-en (Dette er lynraskt!)
      pathEl.setAttribute("d", dAttribute);
  }

  /**
   * Din eksisterende formel, skrevet om til å returnere en ren SVG 'd'-streng i stedet for å tegne direkte.
   */
  private static calculateBezierPath(
      p1: Point, 
      p2: Point, 
      direction: 'up' | 'down' | 'horizontal' | 'friend',
      curvature = 0.5
  ): string {
      const c1: Point = { x: 0, y: 0 };
      const c2: Point = { x: 0, y: 0 };
      const isHorizontal = direction === 'horizontal' || direction === 'friend';

      if (isHorizontal) {
          const xdiff = p2.x - p1.x;
          c1.x = p1.x + xdiff * curvature;
          c1.y = p1.y;
          c2.x = p2.x - xdiff * curvature;
          c2.y = p2.y;
      } else {
          const xdiff = p2.x - p1.x;
          const ydiff = p2.y - p1.y;
          const distance = Math.sqrt(xdiff * xdiff + ydiff * ydiff);
          const verticalOffset = Math.min(Math.max(distance * curvature, 45), 160);

          c1.x = p1.x;
          c2.x = p2.x;

          if (direction === 'down') {
              c1.y = p1.y + verticalOffset;
              c2.y = p2.y - verticalOffset;
          } else {
              c1.y = p1.y - verticalOffset;
              c2.y = p2.y + verticalOffset;
          }
      }

      // Returner den ferdige SVG-stien
      return `M ${p1.x} ${p1.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${p2.x} ${p2.y}`;
  }

}
