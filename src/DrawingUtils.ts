import { Point } from "obsidian";
import { GateProperties } from "./GateClass";
import { RV_CLASSES } from "./constants";

export class DrawingUtils {
  
  // Liten hjelpemetode for å beregne p1 minus p2
  static sub = (p1: Point, p2: Point): Point => ({ x: p1.x - p2.x, y: p1.y - p2.y });

  // Liten hjelpemetode for å skjule linjen hvis den ruller ut av syne
  private static hideLineInCache(fromGate: GateProperties, toGate: GateProperties, linkCache: Map<string, any>) {
    const pathA = fromGate.parentNote.path;
    const pathB = toGate.parentNote.path;

    const lineId = pathA.localeCompare(pathB) < 0 
    ? `${pathA}->${pathB}` 
    : `${pathB}->${pathA}`;
    
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

    const pathA = fromGate.parentNote.path;
    const pathB = toGate.parentNote.path;

    const lineId = pathA.localeCompare(pathB) < 0 
    ? `${pathA}->${pathB}` 
    : `${pathB}->${pathA}`;

    // 3. CACHE-SJEKK & TEGNING
    let cacheItem = linkCache.get(lineId);
    let pathEl: SVGPathElement;

    if (cacheItem) {
        pathEl = cacheItem.svgElement;
        pathEl.style.display = ''; // Vis den igjen hvis den var skjult
        pathEl.style.visibility = 'visible'
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

    // 4. BÉZIER-DIRECTION: Sender med hele gaten for å vite retningen på svingen! [dan]
    const dAttribute = this.calculateBezierPath(p1, p2, fromGate, toGate);

    // 5. UPDATE: Oppdater stien i DOM-en (Dette er lynraskt!)
    pathEl.setAttribute("d", dAttribute);
  }

  /**
   * Din eksisterende formel, skrevet om til å returnere en ren SVG 'd'-streng i stedet for å tegne direkte.
   */
  private static calculateBezierPath(
    p1: Point, 
    p2: Point, 
    fromGate: GateProperties, 
    toGate: GateProperties
    ): string {
    // Sjekk om det er en kobling mellom to friend-porter (horisontale flanker)
    const isFriendLink = fromGate.direction === 'left' || fromGate.direction === 'right';

    if (isFriendLink) {
        // === HORISONTAL BÉZIER ===
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
    // KORRIGERT VERTIKAL BÉZIER (For foreldre/barn via up/down-porter)
    // ==========================================================================
    const verticalStrength = Math.max(40, Math.abs(p2.y - p1.y) * 0.7);

    // Bestem retningen for start-kontrollpunktet (cp1) [dan]
    // Hvis porten peker opp, må linjen skyte OPP (-), ellers NED (+) [dan]
    const dirVertA = fromGate.direction === 'up' ? -1 : 1;
    const cp1x = p1.x; // Låst horisontalt -> Garanterer 100% loddrett start! [dan]
    const cp1y = p1.y + (verticalStrength * dirVertA);

    // Bestem retningen for landings-kontrollpunktet (cp2) [dan]
    // Hvis mottaker-porten peker opp, må den lande ovenfra (-), ellers nedenfra (+) [dan]
    const dirVertB = toGate.direction === 'up' ? -1 : 1;
    const cp2x = p2.x; // Låst horisontalt -> Garanterer 100% loddrett landing! [dan]
    const cp2y = p2.y + (verticalStrength * dirVertB);

    // Returnerer den perfekte, loddrette S-kurven [dan]
    return `M ${p1.x} ${p1.y} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
    }
 
}
