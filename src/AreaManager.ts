import { RelatedData } from "./data.js";
import { NoteClass } from "./NoteClass.js";
import { Platform, Point } from "obsidian";
import { DrawingUtils } from "./DrawingUtils.js";
import { DOMUtils } from "./DOMUtils.js";
import { GateProperties } from "./GateClass.js";
import { RV_CLASSES } from "./constants.js";
import RelatednotesPlugin from "./main.js";

export class AreaManager {
  containerEl: HTMLElement;

  backContainerSVG!: SVGSVGElement;
  center!: HTMLElement;
  left!: HTMLElement;
  right!: HTMLElement;
  upper!: HTMLElement;
  lower!: HTMLElement;
    
  private related: RelatedData;
  private plugin: RelatednotesPlugin;
  
  // Den sentrale minne-cachen for SVG-linjene
  private linkCache = new Map<string, { svgElement: SVGPathElement; used: boolean }>();
    
  private animationFrameId: number | null = null;

  constructor(
    related: RelatedData, 
    parentEl: HTMLElement,
    plugin: RelatednotesPlugin
  ){
    this.related = related;
    this.containerEl = parentEl;
    this.plugin = plugin;
  }

  initiate() {
    this.containerEl.addClass(RV_CLASSES.CONTAINER); 
  }

  /**
   * Planlegger en ny, frisk opptegning synkronisert med skjermens oppdatering (60Hz).
   * Kalles automatisk ved rulling, vindusendringer og etter den store dytten til skjermen.
   */
  public requestRedraw() {
    // Hvis det allerede er planlagt en tegning, avbryt det forrige varselet
    if (this.animationFrameId !== null) {
        cancelAnimationFrame(this.animationFrameId);
    }

    // Planlegg en ny frame synkronisert med nettleseren/skjermen
    this.animationFrameId = requestAnimationFrame(() => {

      // Tvinger en liten micro-timeout slik at CSS Grid-rammene har landet 100% 
      // på de ekte pikslene sine før vi gjør getBoundingClientRect()! [dan]
      setTimeout(() => {
        this.yieldIfLeftTall();
        this.yieldIfRightTall();

        if (this.related?.centerNote) {
          this.drawAllGraphLines(); // Tegner strekene fjellstøtt på rett plass!
        }
      }, 50); // 50ms er usynlig for det blotte øye, men en evighet for nettleser-geometri

      // Nullstill ID-en så neste frame kan kjøre fritt
      this.animationFrameId = null;
    });
  }

  private setupScrollEventListeners() {
    // En liste over alle områdene som har fått tildelt rulling i CSS-en din
    const scrollableAreas = [this.upper, this.lower, this.left, this.right];

    for (const area of scrollableAreas) {
      if (!area) continue;

      this.plugin.registerDomEvent(
        area, 
        'scroll', 
        () => {
          this.requestRedraw(); // Sørger for at Beziér-kurvene følger med live! [dan]
        }, 
        { passive: true }
      );
    }
  }

  /**
   * JS update to CSS if (data-left-tall)
   * Is called after graph is updated but before lines are drawn.
   * Makes upper area yield left upper corner to left area.
   */
  yieldIfLeftTall() {
    const vc = this.containerEl;
    const descr = '.rv-area.left';
    const leftWrapper = vc.querySelector(descr) as HTMLElement;
    if (!leftWrapper) return;
    
    const currentValue = vc.getAttribute(RV_CLASSES.LEFT_TALL);
    const isLeftTall = leftWrapper.scrollHeight > this.center.offsetHeight;
    const newValue = isLeftTall ? "true" : "false";

    if (currentValue !== newValue) {
        vc.setAttribute(RV_CLASSES.LEFT_TALL, newValue);
    }
  }

  /**
   * JS update to CSS if (data-right-tall)
   * As above - Makes lower area yield right lower corner to right area.
   */
  yieldIfRightTall() {
    const vc = this.containerEl;
    const descr = '.rv-area.right';
    const rightWrapper = vc.querySelector(descr) as HTMLElement;
    if (!rightWrapper) return;
    
    const currentValue = vc.getAttribute(RV_CLASSES.RIGHT_TALL);
    const isRightTall = rightWrapper.scrollHeight > (this.center.offsetHeight + this.upper.offsetHeight);
    const newValue = isRightTall ? "true" : "false";

    if (currentValue !== newValue) {
      vc.setAttribute('data-right-tall', newValue);
    }
  }
  
  /**
   * Check how much backContainerSVG is off related to future container measures.
   * @returns amount of pixels the drawing routine must adjust coords
   */
  private offBy(): Point | null{
    const isMobile = Platform.isMobile;
    
    if (!this.containerEl) return null;

    const rect = this.containerEl.getBoundingClientRect();
    
    // SAFEGUARD 1: Avoid drawing if the container is hidden or currently off-screen (0x0 size)
    // This stops drawings from completely breaking or vanishing
    if (rect.width === 0 || rect.height === 0) {
        return null; 
    }

    let x = rect.left; 
    let y = rect.top;

    if (isMobile) {
        // SAFEGUARD 2: Include native window offset tracking
        x += window.scrollX || 0;
        y += window.scrollY || 0;
    } else {
        x += this.containerEl.scrollLeft || 0;
        y += this.containerEl.scrollTop || 0;
    }

    return { x: x, y: y };
  }

  public renderGraph() { 
    const centerNote = this.related.centerNote;
    if (!centerNote) return;
    
    const related = this.related;
    const memoryFragment = document.createDocumentFragment();

    // Klargjør .rv-container i minnet
    const mainContainerEl = memoryFragment.createDiv({ cls: RV_CLASSES.CONTAINER });
    mainContainerEl.setAttribute(RV_CLASSES.LEFT_TALL, 'false');
    mainContainerEl.setAttribute(RV_CLASSES.RIGHT_TALL, 'false');

    this.center = mainContainerEl.createDiv({ cls: RV_CLASSES.AREA_CENTER });
    this.left   = mainContainerEl.createDiv({ cls: RV_CLASSES.AREA_LEFT });
    this.right  = mainContainerEl.createDiv({ cls: RV_CLASSES.AREA_RIGHT });
    this.upper  = mainContainerEl.createDiv({ cls: RV_CLASSES.AREA_TOP });
    this.lower  = mainContainerEl.createDiv({ cls: RV_CLASSES.AREA_BOTTOM });
    
    this.backContainerSVG = mainContainerEl.createSvg("svg", { cls: RV_CLASSES.SVG_LAYER });

    // 0. CENTER
    this.renderQuadrant(this.center, [ [centerNote] ], "center");

    // 1. UPPER AREA (Kun 1 kolleksjon: Ekte parents. Undefined/Ignored holdes HELT utenfor)
    const cleanParentsOnly = Array.from(centerNote.relations.parents).filter(n => n.relation === "parent"); 
    const sortedParents = related.getSortedNotesForQuadrant(cleanParentsOnly, false);
    this.renderQuadrant(this.upper, [ sortedParents ], "upper");
  
    // 2. LEFT AREA (Kun 1 kolleksjon: Ekte friends. Undefined/Ignored holdes HELT utenfor)
    const cleanFriendsOnly = Array.from(centerNote.relations.friends).filter(n => n.relation === "friend"); 
    const sortedFriends = related.getSortedNotesForQuadrant(cleanFriendsOnly, false);
    this.renderQuadrant(this.left, [ sortedFriends ], "left");

    // 3. LOWER AREA (Kolleksjon 1: Ekte barn. Kolleksjon 2: Senterets felles oppsamling av ALT udefinert)    
    const allNotesInCache = Array.from(related.noteCache.values()).filter(n => n.isUsed);
    
    // Kolleksjon 1: Kun noder med den definerte relasjonen "child"
    const childrenOnly = related.getSortedNotesForQuadrant(
      allNotesInCache.filter(n => n.relation === "child"), false
    );
    // Kolleksjon 2: ALT udefinert i hele cachen (uansett om kilden var udefinert frontmatter eller bodytext!)
    const totalUndefinedBucket = related.getSortedNotesForQuadrant(
      allNotesInCache.filter(n => n.relation === "undefined"), false
    );
    const lowerCollections = [childrenOnly, totalUndefinedBucket].filter(c => c.length > 0);
    this.renderQuadrant(this.lower, lowerCollections, "lower");

    // 4. RIGHT AREA (Søsken-området: Skiller mellom kriterie-søsken og brødtekst/udefinerte søsken)
    const rawSiblings = Array.from(centerNote.relations.siblings);
    
    // Kolleksjon 1: Solide søsken som ble oppdaget via de brukerstyrte frontmatter-kriteriene hos parent
    const solidSiblings = related.getSortedNotesForQuadrant(
      rawSiblings.filter(n => n.relation === "sibling" || n.discoverySource === "frontmatter-kriterium"), true
    );
    
    // Kolleksjon 2: Søsken som ble funnet i parent/søskens brødtekst eller udefinerte frontmatter-egenskaper
    const looseTextSiblings = related.getSortedNotesForQuadrant(
      rawSiblings.filter(n => n.relation === "undefined" || n.discoverySource === "bodytext" || n.discoverySource === "frontmatter-udefinert"), true
    );
    const siblingCollections = [solidSiblings, looseTextSiblings].filter(c => c.length > 0);
    this.renderQuadrant(this.right, siblingCollections, "right");

    // ERSTATT SKJERMEN
    this.containerEl.empty(); 
    this.containerEl.appendChild(memoryFragment);

    // NÅ er områdene fysisk tilstede, og vi kobler på lytterne og linjene i samme mikrosekund:
    this.setupScrollEventListeners(); 
    this.requestRedraw(); 
  }

  private renderQuadrant(
    area: HTMLElement, 
    collections: NoteClass[][], // Tar imot de rå kolleksjonene (f.eks. [[children], [undefined]])
    areaName: "upper" | "lower" | "left" | "right" | "center"
  ) {
    area.empty(); // Obsidians native, lynraske tømming
    const noteCount = collections.flat().length;
    if (noteCount === 0) return;

    // 1. OPPRETT DET USYNLIGE FRAGMENTET I MINNET
    const areaFragment = document.createDocumentFragment();
    
    // Vi looper gjennom de overordnede kolleksjonene (f.eks. maks 2 i lower area)
    collections.forEach(collection => {
      if (collection.length === 0) return;

      // PRINSIPP: Hver kolleksjon får sin egen etasje-stabler (.rv-area-collections). 
      // Siden disse stables vertikalt i CSS, vil Kolleksjon 2 legge seg vakkert UNDER Kolleksjon 1!
      const areaCollectionDiv = areaFragment.createDiv({ cls: RV_CLASSES.COLLECTION });

      // Hver kolleksjon får sin egen kolonneflyt (.rv-columns-wrapper)
      const colWrapDiv = areaCollectionDiv.createDiv({ cls: RV_CLASSES.COL_WRAPPER});

      // Vi grupperer notene i denne kolleksjonen etter tag!
      const tagGroupedNotes = this.related.groupByFirstTag(collection);

      tagGroupedNotes.forEach(group => {
        // Hver unike tag-gruppe får sin egen "usynlige" gruppe-DIV (.rv-groups)
        const groupDiv = colWrapDiv.createDiv({ cls: RV_CLASSES.GROUPS });

        const groupNotes = group.notes; // Array/liste med alle notene i denne tag-gruppen
        const overGrensen = groupNotes.length > 4;

        //Bygg knappen, a-lenken og de 3 portene ferdig i minnet
        groupNotes.forEach((note, index) => {
          // STEMPEL: Sikringen settes på nøyaktig riktig sted
          note.assignedArea = areaName;

          // RENDRE: Bygg knappen, a-lenken og de 3 portene ferdig i minnet
          const noteEl = note.render(); 
          if (overGrensen && index > 0) {
            noteEl.classList.add('hidden');
          };
          groupDiv.appendChild(noteEl);

          // Region-referanser for portene
          if (note.upperGate)  note.upperGate.areaElement = area;
          if (note.lowerGate)  note.lowerGate.areaElement = area;
          if (note.friendGate) note.friendGate.areaElement = area;
        });

        // Hvis gruppen har mer enn 1 medlem, legger vi på pluss/minus-knappen på den første noten
        if (groupNotes.length > 1) {
          // 1. KORRIGERT & TYPESIKKERT: Hent ut den aller første noten fra listen safely
          const firstNote = groupNotes[0];
          
          // 2. DØRVAKT: Sjekk eksplisitt at noten og dens HTML-div eksisterer før vi går videre
          if (firstNote && firstNote.div) {
            const firstNoteDiv = firstNote.div;
            
            // Bygg knappen via din oppdaterte DOMUtils (overgensen ble bestemt lenger opp i funksjonen)
            const plusMinusBtn = DOMUtils.buildPlusMinusBtn(firstNoteDiv, group, overGrensen);
            
            // Dytt knappen absolutt posisjonert inn på den første noten [dan]
            firstNoteDiv.appendChild(plusMinusBtn);
          }
        }
      });
    });

    // 3. Den store dytten til skjermen
    area.appendChild(areaFragment);
  }

  /**
   * Denne metoden kjøres når du skal tegne opp alle SVG-linjene på skjermen
   */
  drawAllGraphLines() {
    const centerNote = this.related.centerNote;
    if (!centerNote) return;
    
    const offBy = this.offBy();
    if (!offBy) return;
    
    const links = this.linkCache;
    const canvas = this.backContainerSVG;

    // 1. START-FASE: Marker linjer som ubrukt, og nullstill ALLE synlige porter
    const visibleNotes = Array.from(this.related.noteCache.values())
      .filter(n => n.isUsed && n.assignedArea !== "ignored");

    for (const link of links.values()) {
        link.used = false; 
    }

    // Fjern tilkoblings-klassen fra alle porter før vi begynner å tegne på nytt [dan]
    for (const note of visibleNotes) {
      note.upperGate.svg?.classList.remove('is-connected');
      note.lowerGate.svg?.classList.remove('is-connected');
      note.friendGate.svg?.classList.remove('is-connected');
    }
    
    // DØRVAKT: Sjekker om begge portene er fysisk tegnet ut og synlige i DOM-en
    const canDraw = (from: GateProperties, to: GateProperties) => {
      return from && to && from.svg && to.svg && 
             from.parentNote.div && to.parentNote.div &&
             from.parentNote.div.offsetHeight > 0;
    };

    // // Hjelpefunksjon: Sjekker om det eksisterer en reell, fysisk kobling i YAML eller brødtekst mellom to noder.
    const harEkteFysiskLink = (a: NoteClass, b: NoteClass): boolean => {
      // Hent ut BÅDE de eksisterende (resolved) og uopprettede (unresolved) koblingene fra Obsidian [dan]
      const resolvedLinks = this.plugin.app.metadataCache.resolvedLinks;
      const unresolvedLinks = this.plugin.app.metadataCache.unresolvedLinks;
      
      // INTERN HJELPEFUNKSJON: Gjør oppslagene 100% eksplisitte og vanntette for TypeScript!
      const sjekkKobling = (fraPath: string, tilBasename: string): boolean => {
        // 1. Sjekk eksisterende lenker (resolvedLinks lagrer stier som nøkler: resolvedLinks[fraPath][tilPath]) [dan]
        const resObj = resolvedLinks[fraPath];
        if (resObj) {
          // Siden resolvedLinks bruker fulle stier som under-nøkler, sjekker vi om noen av stiene matcher tilBasename [dan]
          const harTreff = Object.keys(resObj).some(path => path.toLowerCase().endsWith(`/${tilBasename.toLowerCase()}.md`) || path.toLowerCase() === `${tilBasename.toLowerCase()}.md`);
          if (harTreff) return true;
        }

        // 2. Sjekk uopprettede lenker (unresolvedLinks lagrer basenames som under-nøkler: unresolvedLinks[fraPath][tilBasename]) [dan]
        const unresObj = unresolvedLinks[fraPath];
        if (unresObj && typeof unresObj === 'object') {
          if (tilBasename in unresObj) return true;
        }

        return false;
      };

      // Sjekk to-veis i Obsidians offisielle registre [dan]
      if (sjekkKobling(a.path, b.basename) || sjekkKobling(b.path, a.basename)) {
        return true;
      }

      // Sjekk 3: Sjekk om de deler et agn i din egen sources-modell
      const baitForB = this.related.baitCache.get(b.basename.toLowerCase());
      const baitForA = this.related.baitCache.get(a.basename.toLowerCase());

      if (baitForB && baitForB.sources.has(a)) return true;
      if (baitForA && baitForA.sources.has(b)) return true;

      return false;
    };

    // ==========================================================================
    // 2. TEGNE-FASE: Kun linjer mellom noder med REELL, FYSISK LINK!
    // ==========================================================================
    for (let i = 0; i < visibleNotes.length; i++) {
      const nodeA = visibleNotes[i];
      if (!nodeA) continue;

      for (let j = i + 1; j < visibleNotes.length; j++) {
        const nodeB = visibleNotes[j];
        if (!nodeB) continue;

        // PRINSIPP: Hvis det IKKE finnes en ekte, fysisk link/frontmatter-kobling 
        // mellom akkurat disse to nodene, tegner vi ALDRI linje! [dan]
        if (!harEkteFysiskLink(nodeA, nodeB)) continue;

        // --- KATEGORI A: VERTIKALE RELASJONER (Parents / Children) ---
        if (nodeA.relations.children.has(nodeB)) {
          if (canDraw(nodeB.upperGate, nodeA.lowerGate)) {
            DrawingUtils.drawLink(nodeB.upperGate, nodeA.lowerGate, links, offBy, canvas);
            
            // BINGO! Begge disse to portene har nå en aktiv linje [dan]
            nodeB.upperGate.svg!.classList.add('is-connected');
            nodeA.lowerGate.svg!.classList.add('is-connected');
          }
        } 
        else if (nodeA.relations.parents.has(nodeB)) {
          if (canDraw(nodeA.upperGate, nodeB.lowerGate)) {
            DrawingUtils.drawLink(nodeA.upperGate, nodeB.lowerGate, links, offBy, canvas);
            
            nodeA.upperGate.svg!.classList.add('is-connected');
            nodeB.lowerGate.svg!.classList.add('is-connected');
          }
        }

        // --- KATEGORI B: HORISONTALE RELASJONER (Friends & Søsken & Kryssende Baits) ---
        // Siden de overlevde dørvakten over, betyr det at de HAR en beviselig link, 
        // og vi kobler dem vakkert horisontalt flanke-til-flanke via friendGate! [dan]
        else {
          if (canDraw(nodeA.friendGate, nodeB.friendGate)) {
            DrawingUtils.drawLink(nodeA.friendGate, nodeB.friendGate, links, offBy, canvas);
          
            nodeA.friendGate.svg!.classList.add('is-connected');
            nodeB.friendGate.svg!.classList.add('is-connected');
          }
        }
      }
    }  
    // 3. OPPRYDDINGS-FASE: Slett alle linjer i cachen som ikke ble gjenbrukt i denne runden
    for (const [key, link] of this.linkCache.entries()) {
      if (!link.used) {
        link.svgElement.remove(); // Fjern fysisk fra SVG-containeren i DOM-en
        this.linkCache.delete(key); // Fjern fra minne-cachen
      }
    }
  }

}