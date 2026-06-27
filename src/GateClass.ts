import { Point } from "obsidian";
import { NoteClass } from "./NoteClass";

export type Direction = "up" | "down" | "left" | "right";

export class GateProperties {
  private readonly gatecolor = 'var(--bases-table-header-color)';
  private readonly radius = 2.5;
  private readonly factor = 1;

  direction: Direction;
  svg: SVGSVGElement | null = null;
  circleEl: SVGCircleElement | null = null;
	connections: NoteClass[] = [];
  
  areaElement: HTMLElement | null = null;
  parentNote: NoteClass;

  constructor(parentNote: NoteClass, direction: Direction) {
    this.parentNote = parentNote;
    this.direction = direction;
  }

  /**
   * Genererer eller oppdaterer SVG-porten for denne gaten.
   * Returnerer et ferdig SVG-element klart for appendChild().
   */
  public render(): SVGSVGElement {

    const {gatecolor, radius, direction, factor} = this;
    const parentDiv = this.parentNote.div;

    const hasConnections = this.connections.length > 0;
    const fill = hasConnections ? this.gatecolor : "transparent";

    
    // 1. GJENBRUK: Elementet må eksistere i minnet, OG det må fysisk være 
    // en del av den NYE parentDiv på skjermen for å kunne gjenbrukes!
    if (this.svg && this.circleEl && parentDiv && parentDiv.contains(this.svg)) {
      this.circleEl.setAttribute("fill", fill);
      return this.svg;
    }

    // Hvis parentDiv IKKE inneholder gaten (f.eks. etter gjenbruk fra cache), 
    // betyr det at den gamle må kastes og en ny frisk må lages for dette vinduet.

    // 2. NYTT ELEMENT: Hvis det ikke finnes (eller lå i en slettet DOM-del)
      
    // Opprett hoved-SVG-beholderen
    this.svg = createSvg("svg", {
      attr: {
        width: radius * 2,
        height: radius * 2,
        class: `rv-gate-node direction-${direction}`,
        style: "position: absolute; z-index: 5; overflow: visible;"
      }
    });
    
    // Opprett sirkelen på innsiden
    this.circleEl = this.svg.createSvg("circle", {
      attr: {
        cx: radius,
        cy: radius,
        r: radius * factor,
        fill: fill,
        stroke: gatecolor,
        "stroke-width": factor
      }
    });

    return this.svg;
  }

  /**
   * Hjelpefunksjon for å finne det nøyaktige midtpunktet til en port basert på dens HTML-element.
   */
  center(): Point {
    // Sikkerhetssjekk: Hvis gaten ikke er tegnet eller mangler sitt eget SVG-element, returner 0
    if (!this.svg) return { x: 0, y: 0 };
    
    // Hent gatens EGEN fysiske plassering i nettleservinduet (ikke notat-diven!)
    const rect = this.svg.getBoundingClientRect();
    
    // Siden gaten har en fast fysisk sirkelstørrelse inni seg, 
    // legger vi bare til den faste radiusen (2.5 piksler) for å treffe dønn i midten!
    const radius = 2.5; 

    return {
        x: rect.left + radius,
        y: rect.top + radius
    };
  }
};



