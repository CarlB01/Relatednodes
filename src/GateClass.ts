import { Point } from "obsidian";
import { NoteClass } from "./NoteClass";
import { RV } from "./constants";

export type Direction = "up" | "down" | "left" | "right";

export class GateProperties {
  direction: Direction;
  svg: SVGSVGElement | null = null;
  circleEl: SVGCircleElement | null = null;
	
  areaElement: HTMLElement | null = null;
  parentNote: NoteClass;
  public static cachedRadius: number | null = null

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
    
    // 1. GJENBRUK: Elementet må eksistere i minnet, OG det må fysisk være 
    // en del av den NYE parentDiv på skjermen for å kunne gjenbrukes!
    if (this.svg && this.circleEl && parentDiv && parentDiv.contains(this.svg)) {
      if (hasConnections) {
        this.svg.classList.add('is-connected');
      } else {
        this.svg.classList.remove('is-connected');
      }
      return this.svg;
    }
    
    // 2. NYTT ELEMENT: Hvis det ikke finnes (eller lå i en slettet DOM-del)
    
    // ==========================================================================
    // KORRIGERT & RENSET FOR STORSKALA (Slukker piksel-kollisjonen)
    // Vi SLETTER width og height herfra fullstendig! 
    // Vi legger i stedet inn 'viewBox: "0 0 10 10"' [dan]. Dette definerer et virtuelt 
    // koordinatsystem (et 10x10 rutenett) som lar sirkelen skalere seg 100% 
    // trinnløst og knivskarpt etter em-størrelsen i CSS-en din [dan]!
    // ==========================================================================
    this.svg = createSvg("svg", {
      attr: {
        viewBox: "0 0 10 10", // Det magiske relative rutenettet [dan]!
        class: `${RV.GATE_SVG} ${this.direction}`,
        style: "position: absolute; z-index: 5; overflow: visible;"
      }
    });
    
    // Hvis gaten fødes og allerede har aktive koblinger, legger vi på klassen med en gang [dan]
    if (hasConnections) {
      this.svg.classList.add('is-connected');
    }
    // Opprett sirkelen på innsiden (Låst til midten av vårt nye 10x10 rutenett) [dan]
    this.circleEl = this.svg.createSvg("circle", {
      attr: {
        cx: "5",   // Midten av 10x10 rutenettet på X-aksen (50%) [dan]
        cy: "5",   // Midten av 10x10 rutenettet på Y-aksen (50%) [dan]
        r: "4",    // Radius på 4 enheter gir en perfekt, delikat glassperle (40%) [dan]
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
    
    // Hvis vi ikke har målt radiusen ennå i denne runden, måler vi den én gang [dan]!
    if (GateProperties.cachedRadius === null && rect.width > 0) {
      GateProperties.cachedRadius = rect.width / 2;
    }

    // Bruker den lynraske, lagrede radiusen for alle de neste 200 portene i loopen [dan]!
    const r = GateProperties.cachedRadius || 4; // Fallback til 4px hvis alt er null

    return {
        x: rect.left + r,
        y: rect.top + r
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



