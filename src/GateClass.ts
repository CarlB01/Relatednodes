import { Point } from "obsidian";
import { NoteClass } from "./NoteClass";
import { RV_CLASSES } from "./constants";

export type Direction = "up" | "down" | "left" | "right";

export class GateProperties {
  direction: Direction;
  svg: SVGSVGElement | null = null;
  circleEl: SVGCircleElement | null = null;
	
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

    const parentDiv = this.parentNote.div;
    
    // Hent status direkte fra NoteClass sitt minne-Set (tar O(1) tid)
    const hasConnections = this.hasActiveConnections();
    const fill = hasConnections ? RV_CLASSES.GATE_COLOR : "transparent";
    
    
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
        width: RV_CLASSES.RADIUS * 2,
        height: RV_CLASSES.RADIUS * 2,
        class: `${RV_CLASSES.GATE_SVG} ${this.direction}`,
        style: "position: absolute; z-index: 5; overflow: visible;"
      }
    });
    
    // Opprett sirkelen på innsiden
    this.circleEl = this.svg.createSvg("circle", {
      attr: {
        cx: "50%",
        cy: "50%",
        r: "40%",
        fill: fill,
        stroke: RV_CLASSES.GATE_COLOR,
        "stroke-width": RV_CLASSES.FACTOR
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

  private hasActiveConnections(): boolean {
    const rel = this.parentNote.relations;
    const area = this.parentNote.assignedArea;
    const dir = this.direction; // "up" | "down" | "left" | "right"

    // ==========================================================================
    // 1. VERTIKALE RELASJONER (Foreldre / Barn) - Bruker ALLTID top eller bottom
    // ==========================================================================
    
    if (dir === "up") {
      // Topp-porten lyser hvis noten er et barn, eller om den selv har foreldre
      if (area === "lower") return true; // Barn tar imot link fra center på sin 'up' gate
      if (area === "right") return true; // Søsken tar ALLTID imot link fra parent på sin 'up' gate
      return rel.parents.size > 0;       // For alle andre: lys opp hvis vi har en forelder over oss
    }

    if (dir === "down") {
      // Bunn-porten lyser hvis noten er en forelder, eller om den selv har barn
      if (area === "upper") return true; // Parent linker til center og søsken fra sin 'lower' gate
      return rel.children.size > 0;      // For alle andre: lys opp hvis vi har barn under oss
    }

    // ==========================================================================
    // 2. HORISONTALE RELASJONER (Friends, Siblings & Kryssende Baits)
    // ==========================================================================
    
    // Siden "friend" og kryssende baits alltid tegnes horisontalt, må vi sjekke 
    // om det eksisterer slike relasjoner for denne noten overhodet.
    // (Her må du også sjekke ditt nye baitCache/Set for kryssende baits)
    const harHorisontaleRelasjoner = rel.friends.size > 0 || 
                                    rel.siblings.size > 0; 
//                                   || this.parentNote.hasCrossingBaits(); // Hjelpemetode for dine baits

    if (harHorisontaleRelasjoner) {
      // SENTER-NOTEN (Primærnoten)
      if (area === "center") {
        // Senter-noten sender venstre-linker ut fra sin venstre flanke
        return dir === "left";
      }

      // FRIENDS (Bor primært i venstre area)
      if (area === "left") {
        // Din regel: "friend gaten på høyre side av note-div (kortest vei til center)"
        return dir === "right";
      }

      // SIBLINGS (Bor primært i høyre area)
      if (area === "right") {
        // For den horisontale biten (baits/venner) bruker den venstre flanke inn mot midten.
        // (Merk at den også lyser opp på 'up' for den vertikale koblingen fra parent!)
        return dir === "left";
      }

      // FOR ALLE ANDRE OMRÅDER (Upper/Lower noder som har en horisontal link/bait til noen)
      // Hvis en node i upper/lower må linkes horisontalt, velger vi den flanken 
      // som peker inn mot den vertikale ryggraden (kolonne 3), eller basert på hvor målnoden bor.
      if (dir === "left" || dir === "right") {
        return true; 
      }
    }

    return false;
  }


};



