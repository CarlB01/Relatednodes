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
  private debounceTimer: NodeJS.Timeout | null = null;


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
      }, 150); // 50ms er usynlig for det blotte øye, men en evighet for nettleser-geometri

      // Nullstill ID-en så neste frame kan kjøre fritt
      this.animationFrameId = null;
    });
  }


  private setupScrollEventListeners() {
    // En liste over alle områdene som har fått tildelt rulling i CSS-en din
    const scrollableAreas = [this.upper, this.lower, this.left, this.right];

    for (const area of scrollableAreas) {
      if (!area) continue;

      const scrollWrapper = area.querySelector(`.${RV_CLASSES.COLLECTION_WRAPPER}`) as HTMLElement;
      if (!scrollWrapper) continue;

      this.plugin.registerDomEvent(
        scrollWrapper, 
        'scroll', 
        () => {
          this.requestRedraw(); 
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
    const collectionWrapper = areaFragment.createDiv(RV_CLASSES.COLLECTION_WRAPPER);
    
    // Vi looper gjennom de overordnede kolleksjonene (f.eks. maks 2 i lower area)
    collections.forEach(collection => {
      if (collection.length === 0) return;

      // PRINSIPP: Hver kolleksjon får sin egen etasje-stabler (.rv-area-collections). 
      // Siden disse stables vertikalt i CSS, vil Kolleksjon 2 legge seg vakkert UNDER Kolleksjon 1!
      const areaCollectionDiv = collectionWrapper.createDiv({ cls: RV_CLASSES.COLLECTION });

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
          if (overGrensen && index > 0 && this.plugin.settings.groupsCollapsed) {
            noteEl.classList.add('hidden');
          };
          groupDiv.appendChild(noteEl);

          // Region-referanser for portene
          if (note.upperGate)  note.upperGate.areaElement = area;
          if (note.lowerGate)  note.lowerGate.areaElement = area;
          if (note.friendGate) note.friendGate.areaElement = area;
        });

        if (overGrensen) {
          // 1. KORRIGERT & TYPESIKKERT: Hent ut den aller første noten fra listen safely
          const firstNote = groupNotes[0];
          
          if (firstNote && firstNote.div) {
            const firstNoteDiv = firstNote.div;
            
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

    // 1. START-FASE: Hent aktive noder og nullstill porter
    const visibleNotes = Array.from(this.related.noteCache.values())
      .filter(n => n.isUsed && n.assignedArea !== "ignored");

    for (const link of links.values()) {
        link.used = false; 
    }

    for (const note of visibleNotes) {
      note.upperGate.svg?.classList.remove('is-connected');
      note.lowerGate.svg?.classList.remove('is-connected');
      note.friendGate.svg?.classList.remove('is-connected');
    }
    
    const canDraw = (from: GateProperties, to: GateProperties) => {
      if (!from || !to || !from.svg || !to.svg || !from.parentNote.div || !to.parentNote.div) return false;
      
      // SIKRING: Sjekk at nodene faktisk har fått en reell plassering i vinduet.
      // Hvis de måles til 0 på absolutt alt, venter vi på at debounce-timeren vår 
      // tegner dem på nytt om 150ms når de har brettet seg ut [dan]!
      const rA = from.svg.getBoundingClientRect();
      const rB = to.svg.getBoundingClientRect();
      return rA.width > 0 || rB.width > 0;
    };

    const harEkteFysiskLink = (a: NoteClass, b: NoteClass): boolean => {
      const resolvedLinks = this.plugin.app.metadataCache.resolvedLinks;
      const unresolvedLinks = this.plugin.app.metadataCache.unresolvedLinks;
      
      const sjekkKobling = (fraPath: string, tilBasename: string): boolean => {
        const resObj = resolvedLinks[fraPath];
        if (resObj) {
          // KORRIGERT FOR STORSKALA: I stedet for eksakt matching, sjekker vi om stien 
          // inneholder eller slutter på filnavnet (tar høyde for .dokumenter, aliaser etc.)! [dan]
          const tilNameLower = tilBasename.toLowerCase();
          const harTreff = Object.keys(resObj).some(path => {
            const pLower = path.toLowerCase();
            return pLower.includes(tilNameLower) || pLower.endsWith(`/${tilNameLower}.md`);
          });
          if (harTreff) return true;
        }

        const unresObj = unresolvedLinks[fraPath];
        if (unresObj && typeof unresObj === 'object') {
          const tilNameLower = tilBasename.toLowerCase();
          const harTreff = Object.keys(unresObj).some(key => key.toLowerCase().includes(tilNameLower));
          if (harTreff) return true;
        }
        return false;
      };

      // Sjekk to-veis i Obsidians registre
      if (sjekkKobling(a.path, b.basename) || sjekkKobling(b.path, a.basename)) return true;

      // Sjekk 3: Sjekk din egen feilfrie sources-cache (Gjort case- og punktum-insensitiv!) [dan]
      const nameALower = a.basename.toLowerCase();
      const nameBLower = b.basename.toLowerCase();

      for (const [baitName, bait] of this.related.baitCache.entries()) {
        if (!bait.isUsed) continue;
        // Hvis agnet treffer en av nodene delvis (f.feks. "autisme" matcher "autisme.dokumenter") [dan]
        if (baitName.includes(nameALower) || nameALower.includes(baitName)) {
          if (bait.sources.has(b)) return true;
        }
        if (baitName.includes(nameBLower) || nameBLower.includes(baitName)) {
          if (bait.sources.has(a)) return true;
        }
      }

      return false;
    };

    for (let i = 0; i < visibleNotes.length; i++) {
      const nodeA = visibleNotes[i];
      if (!nodeA) continue;

      for (let j = i + 1; j < visibleNotes.length; j++) {
        const nodeB = visibleNotes[j];
        if (!nodeB) continue;

        if (!harEkteFysiskLink(nodeA, nodeB)) continue;

        // Sjekk A: Er de registrert som direkte venner eller søsken i minnekartene?
        const erDirekteVennerEllerSøsken = nodeA.relations.friends.has(nodeB) || nodeB.relations.friends.has(nodeA) ||
                                          nodeA.relations.siblings.has(nodeB) || nodeB.relations.siblings.has(nodeA);

        // Sjekk B: Deler de et KRYSSENDE agn (tverrgående kobling) som IKKE tilhører center-noten?
        const lowercaseCenterName = centerNote.basename.toLowerCase();
        
        const delerEkteKryssendeAgn = nodeA.crossingBaits.size > 0 && Array.from(nodeA.crossingBaits).some(bait => {
          // DØRVAKT: Hvis agnet de deler matcher navnet på senternoten, 
          // returnerer vi false! Dette eliminerer de indirekte linjene fullstendig [dan].
          if (bait.targetName.toLowerCase() === lowercaseCenterName) return false;
          
          // Hvis de deler et ANNET agn (f.eks. "the clan" eller et felles prosjekt), godkjenner vi det!
          return nodeB.crossingBaits.has(bait);
        });
        
        const erGyldigHorisontal = erDirekteVennerEllerSøsken || delerEkteKryssendeAgn;

 
        // REGEL 1: Er Node A biologisk forelder til Node B? (A har B i barn, eller B har A i foreldre) [dan]
        if (nodeA.relations.children.has(nodeB) || nodeB.relations.parents.has(nodeA)) {
          if (canDraw(nodeA.lowerGate, nodeB.upperGate)) {
            DrawingUtils.drawLink(nodeA.lowerGate, nodeB.upperGate, links, offBy, canvas);
            nodeA.lowerGate.svg!.classList.add('is-connected');
            nodeB.upperGate.svg!.classList.add('is-connected');
          }
        } 
        // REGEL 2: Er Node B biologisk forelder til Node A? [dan]
        else if (nodeB.relations.children.has(nodeA) || nodeA.relations.parents.has(nodeB)) {
          if (canDraw(nodeB.lowerGate, nodeA.upperGate)) {
            DrawingUtils.drawLink(nodeB.lowerGate, nodeA.upperGate, links, offBy, canvas);
            nodeB.lowerGate.svg!.classList.add('is-connected');
            nodeA.upperGate.svg!.classList.add('is-connected');
          }
        } 
        // REGEL 3: Horisontale relasjoner (Friends, søsken, crossing baits) [dan]
        else if (erGyldigHorisontal) {
          if (canDraw(nodeA.friendGate, nodeB.friendGate)) {
            DrawingUtils.drawLink(nodeA.friendGate, nodeB.friendGate, links, offBy, canvas);
            nodeA.friendGate.svg!.classList.add('is-connected');
            nodeB.friendGate.svg!.classList.add('is-connected');
          }
        }
      }
    }  

    // 3. OPPRYDDINGS-FASE
    for (const [key, link] of this.linkCache.entries()) {
      if (!link.used) {
        link.svgElement.remove(); 
        this.linkCache.delete(key); 
      }
    }

  }

}