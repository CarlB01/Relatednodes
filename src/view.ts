import RelatednotesPlugin, { relatednodesID } from './main.js';
import { HoverPopover, TFile, WorkspaceLeaf, HoverParent, MarkdownView, FileView, Platform, ItemView, TAbstractFile, App} from 'obsidian';
import { AreaManager } from './AreaManager.js';
import { RV_CLASSES } from './constants.js';

export class RelatednotesView extends ItemView implements HoverParent {

  readonly type = relatednodesID;      
  private plugin: RelatednotesPlugin;
  app: App;
  
  public areaManager!: AreaManager;
  
  hoverPopover: HoverPopover | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: RelatednotesPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.app = plugin.app;
  }

  // #region SUPPORT & FUNCTIONS
  
  getViewType(): string { return RV_CLASSES.RELATED_NOTES_VIEW_TYPE }
  getDisplayText(): string { return "Related Notes" }
  

  /**
   * Robust file resolver with multiple fallback strategies.
   * @param filename - The filename or linkpath to resolve.
   * @returns The matching TFile, or null to match Obsidian API conventions.
   */
  private getFile(filename: string, sourcePath: string = ''): TFile | null {
    if (!filename?.trim()) return null;

    const cleanName = filename.trim();

    // 1. Primary: Metadata Cache (best for links, aliases, headings, relative paths)
    let file = this.app.metadataCache.getFirstLinkpathDest(cleanName, sourcePath);
    if (file instanceof TFile) return file;

    // 2. Direct path lookup (Vault API)
    file = this.app.vault.getFileByPath(cleanName);
    if (file instanceof TFile) return file;

    // 3. Try adding .md extension
    if (!cleanName.endsWith('.md') && !cleanName.includes('.')) {
        file = this.app.vault.getFileByPath(cleanName + '.md');
        if (file instanceof TFile) return file;
    }

    // 4. Basename-only search
    const markdownFiles = this.app.vault.getMarkdownFiles();
    file = markdownFiles.find(f => f.basename === cleanName) ?? null;
    if (file instanceof TFile) return file;

    // 5. Alias search (final fallback)
    file = markdownFiles.find((f) => {
        const cache = this.app.metadataCache.getFileCache(f);
        const aliases = cache?.frontmatter?.aliases;

        if (Array.isArray(aliases)) {
            return aliases.some(alias => 
                typeof alias === 'string' && 
                alias.trim().toLowerCase() === cleanName.toLowerCase()
            );
        }
        if (typeof aliases === 'string') {
            return aliases.trim().toLowerCase() === cleanName.toLowerCase();
        }
        return false;
    }) ?? null;

    if (file instanceof TFile) return file;

    return null;
  }

  /**
   * Find if the file is already open in any leaf (especially useful for adjacent panes)
   * @param targetFile 
   * @returns WorkspaceLeaf or null
   */
  private findLeafWithFile(targetFile: TFile): WorkspaceLeaf | null {
    let found: WorkspaceLeaf | null = null;

    this.app.workspace.iterateAllLeaves((leaf) => {
      if (leaf.view instanceof FileView) {
        if (leaf.view.file?.path === targetFile.path) {
          found = leaf;
        }
      }
    });
    return found;
  }

  /**
   * 
   * @param filename 
   * @returns 
   */
  private async openLinkInAdjacentPane(filename: string) {
    const file = this.getFile(filename);
    if (!file) return;

    // SIKRING: Sjekk om det i det hele tatt finnes en aktiv senternote i minnet
    const centerNote = this.plugin.relatedData.centerNote;
    if (!centerNote) return;
    
    // Hent den fysiske TFile-referansen til den "gamle" senternoten fra stien i minnet [dan]
    const oldCenterFile = this.app.vault.getFileByPath(centerNote.path);
    if (!oldCenterFile) return;
    
    //1. target the leaf that contains "old" centered link 
    let targetLeaf = this.findLeafWithFile(oldCenterFile);

    //2. alternatively replace most recent view
    if (!targetLeaf) {
      const recentLeaf = this.app.workspace.getMostRecentLeaf();
      if (recentLeaf && ['empty', 'markdown'].contains(recentLeaf.view.getViewType())){
        targetLeaf = recentLeaf;
      }
    }

    //3. final fallback - open a new view
    if (!targetLeaf) {
        // Create a new split to the right
        targetLeaf = this.app.workspace.getLeaf('split', 'vertical');
    }

    await targetLeaf.openFile(file);
    await this.app.workspace.revealLeaf(targetLeaf);
    this.setFocusOnSelf();    
  }

  private async setFocusOnSelf() {
    const { workspace } = this.app;

    // Hent bladet basert på din GJELDENDE visnings-ID (relatednodesID) [dan]
    // Dette sørger for at systemet finner nøyaktig din Related Notes-fane på Mac eller iPad!
  
    const leaves = this.app.workspace.getLeavesOfType(relatednodesID); 
    const targetLeaf = leaves[0];

    if (targetLeaf === undefined) return;
    
    // Bring the leaf to the foreground (and expand the sidebar if docked there)
    await workspace.revealLeaf(targetLeaf);
  
    // Set the leaf as active/focused
    workspace.setActiveLeaf(targetLeaf);
  }

  /**
   * Henter den markdown-filen som for øyeblikket er åpen og mest nylig aktiv på skjermen.
   * Returnerer 'null' dersom det ikke finnes noen åpne markdown-faner.
   */
  private getMostRecentMarkdownFile(): TFile | null {
    const { workspace } = this.app;
    const mdLeaves = workspace.getLeavesOfType('markdown');
    
    if (mdLeaves.length === 0) return null;

    // Sorter bladene etter hvelvets interne tidsstempel (activeTime)
    mdLeaves.sort((a, b) => {
      const timeA = (a as any).activeTime ?? 0;
      const timeB = (b as any).activeTime ?? 0;
      return timeB - timeA;
    });

    const mostRecentLeaf = mdLeaves[0];
    if (mostRecentLeaf && mostRecentLeaf.view instanceof MarkdownView) {
      return mostRecentLeaf.view.file; // Returnerer filen, eller null hvis viewet mangler fil
    }

    return null;
  }

  private displayWelcome() {
    const containerEl = this.areaManager.containerEl;
    const center = this.areaManager.center;
    containerEl.appendChild(center);
    console.log('displayed welcome');
  }

  // #endregion

  // #region ACTION RECEIVERS

   async onOpen() {
    this.contentEl.empty();
    this.areaManager = new AreaManager(this.plugin.relatedData, this.contentEl, this.plugin);
    this.areaManager.initiate();

    // 2. set up various monitors:
    // registerHoverLinkSource - the obsidian way.
    // registerDomEvent        - the obsidian way - not 'addEventListener'
    // (unregisters automatically)
  
    this.registerWorkspaceLayoutChanges();
    this.registerHoverLinkSource();
    this.setupMobileSafeguards();
    this.setupVisibilitySafeguards();
    this.setupInternalLinkHandler();
    this.setupPlusMinusBtnHandler();
  
    
    // 3. ÅPNINGSSEKVENS: Kjør når nettleseren er klar
    requestAnimationFrame(async () => {
      // Hent filen som faktisk er åpen på skjermen akkurat nå
      const activeFile = this.getMostRecentMarkdownFile();

      if (activeFile) { 
        await this.plugin.relatedData.update(activeFile);
        this.areaManager.renderGraph();
      } else {
        this.displayWelcome();
      }
    });
   
  }

  async onClose() {
  }

  private onActiveLeafChanged(leaf: WorkspaceLeaf | null) {
    // 2. SAFEGUARD: Catch when focus shoots back and forth after selecting a file
    if (leaf && leaf.view instanceof MarkdownView) {
      
      // If our panel happens to still be visible, queue a safe redraw
      if (this.areaManager.containerEl.isShown()) {
        setTimeout(() => {
          this.areaManager.requestRedraw();
        }, 150); // 150ms timeout gir Obsidian tid til å fullføre animasjonen [dan]
      }
      // Sørg for at notat-bladet forblir synlig
      this.app.workspace.revealLeaf(leaf);
    }
  }

  /**
   * Calls for update of related data model from user click.
   * Opens selection in adjacent pane.
   * @param internalLink 
   */
  private async onInternalLinkClicked(internalLink: string): Promise<void> {
    const selectedFile = this.getFile(internalLink);
    if (!selectedFile) return;

    // ==========================================================================
    // DØRVAKT MOT DOBBEL-RENDERING: 
    // Hvis filen brukeren klikket på ALLEREDE er den aktive senternoten i minnet,
    // avbryter vi her! Dette stopper timing-kræsjen og forhindrer at linjene forsvinner [dan].
    // ==========================================================================
    const currentCenter = this.plugin.relatedData.centerNote;
    if (currentCenter && currentCenter.path === selectedFile.path) {      
      // Final safeguard: Hvis linjene mot formodning skulle ha flyttet seg litt, 
      // ber vi bare om en rask piksel-oppretting uten å røre datamodellen! [dan]
      this.areaManager.requestRedraw(); 
      return; 
    }

    // Hvis det var en NY node, kjører vi den fulle, dype navigasjonen som før:
    this.openLinkInAdjacentPane(internalLink);
    await this.plugin.relatedData.update(selectedFile);
    this.areaManager.renderGraph();
  }

  private onMouseOverLink(event: MouseEvent, targetBox: HTMLElement) {
    const linktext = targetBox.getAttribute("data-link-path") || targetBox.getAttribute("data-href");
    const sourcePath = targetBox.getAttribute("data-link-path");

    if (linktext) {
      // Fyr av Obsidians offisielle Page Preview-event
      this.app.workspace.trigger('hover-link', {
        event: event,
        source: relatednodesID,
        targetEl: targetBox,
        linktext: linktext,
        sourcePath: sourcePath || linktext,
        hoverParent: this
      });
      
      targetBox.addClass('is-hovered');
    }
  }

  private onPlusMinusBtnClicked(target: HTMLElement) {
    const plus = RV_CLASSES.PLUS;   // Det eksakte pluss-tegnet ditt (f.eks. '+')
    const minus = RV_CLASSES.MINUS; // Det eksakte minus-tegnet ditt (f.eks. '−')

    // Finn den nærmeste tag-gruppe-containeren (.rv-groups) som denne knappen styrer [dan]
    const groupDiv = target.closest(`.${RV_CLASSES.GROUPS}`) as HTMLElement;
    if (!groupDiv) return;

    // Hent alle de individuelle note-knappene (.item) inni denne spesifikke gruppen
    const items = Array.from(groupDiv.querySelectorAll('.item')) as HTMLElement[];
    if (items.length <= 1) return;

    const textContent = target.textContent || "";

    // REGEL 3: Hvis knappen viser '+', skal alle medlemmene vises, og symbolet byttes til minus! [dan]
    if (textContent.includes(plus)) {
      groupDiv.classList.add('expanded');
      
      // Vis absolutt alle notene (fjerner 'hidden' fra indeks 1 og utover) [dan]
      items.slice(1).forEach(item => item.classList.remove('hidden'));
      
      // Bytt symbol til minus
      target.textContent = minus;
    } 
    // REGEL 4: Hvis knappen viser minus, skal alle bortsett fra første medlem skjules, og endres til '+' [dan]
    else {
      groupDiv.classList.remove('expanded');
      
      // Skjul alle noder fra indeks 1 og utover
      items.slice(1).forEach(item => item.classList.add('hidden'));
      
      // Bytt symbol tilbake til pluss
      target.textContent = plus;
    }

    // Siden knapper akkurat dukket opp eller forsvant, har CSS-høydene endret seg.
    // Vi ber AreaManager om å hente de nye pikslene og flytte Beziér-kurvene live under neste bildefelt! [dan]
    this.areaManager.requestRedraw();
  }

  override onResize() {
    super.onResize();

    this.areaManager.requestRedraw();
  }

  // #endregion
  
  // #region REGISTER & SETUP
  
  /**
   * Lytter på strukturelle endringer i Obsidians grensesnitt (splits, draging i sidepaneler osv.)
   * og oppdaterer linjene live basert på de splitter nye piksel-koordinatene!
   */
  private registerWorkspaceLayoutChanges() {
    this.registerEvent(
      this.app.workspace.on('layout-change', () => {
        // Siden koordinatene akkurat flyttet på seg, ber vi tegneren om en umiddelbar frame-oppdatering
        this.areaManager.requestRedraw();
      })
    );
  }
  
  private registerHoverLinkSource() {

    this.plugin.registerHoverLinkSource(relatednodesID, {
      display: 'My custom Hover', // Name shown in Page Preview settings
      defaultMod: false,          // or true if you want Ctrl/Cmd required
    });
  }

  private setupMobileSafeguards() {
    if (!Platform.isMobile) return;

    // SAFEGUARD 3: Catch the exact moment the iOS slide-in sidebar animation completes.
    // Obsidian's mobile drawer uses a CSS slide-in transition.
    const leftSplit = this.areaManager.containerEl.closest('.mod-left-split') as HTMLElement;
    if (leftSplit) {
      this.registerDomEvent(leftSplit, 'transitionend', (e: TransitionEvent) => {
        // Only trigger if the width transition finished changing the layout
        if (e.propertyName === 'transform' || e.propertyName === 'width') {
          this.areaManager.requestRedraw(); // Final clean redraw at rest
        }
      });
    }

    // SAFEGUARD 4: Fallback for orientation changes (turning iPhone landscape/portrait)
    this.registerDomEvent(window, 'orientationchange', () => {
      setTimeout(() => {
          this.areaManager.requestRedraw();
      }, 200); // 200ms delay gives iOS time to complete the rotation layout
    });
  }
	
  private setupVisibilitySafeguards() {
    // 1. SAFEGUARD: Detect when the view physically enters/leaves the iPhone screen
    const visibilityObserver = new IntersectionObserver((entries) => {
      for (let entry of entries) {
        // isIntersecting is true the exact moment the panel slides into view
        if (entry.isIntersecting) {
          
          // Vent 150ms til iPhonens slide-in animasjon har roet seg fullstendig [dan]
          setTimeout(() => {
            
            // Wait until the browser thread is completely idle (finished rendering complex UI)
            if ('requestIdleCallback' in window) {
                window.requestIdleCallback(() => {
                  this.areaManager.requestRedraw();
                }, { timeout: 200 }); // Timeout forces execution after 200ms maximum if busy
            } else {
                // Fallback for environments without idle callback support
                this.areaManager.requestRedraw();
            }
          }, 150); 
        }
      }
    }, { 
        threshold: 0.1 // Triggers as soon as even 10% of the view is visible
    });

    // Start watching your add-on container element
    visibilityObserver.observe(this.areaManager.containerEl);
    this.register(() => visibilityObserver.disconnect());

    // 2. SAFEGUARD: Catch when focus shoots back and forth after selecting a file
    this.registerEvent(
      this.app.workspace.on('active-leaf-change', (leaf: WorkspaceLeaf | null) => {
        this.onActiveLeafChanged(leaf);
      })
    );
  }

  private setupInternalLinkHandler() {
    // 1. LINK CLICKED
    this.contentEl.on("click", ".focusable-note-link", (event, target) => {
      event.preventDefault();

      // Henter stien (path) direkte fra attributten vi la på <a>-elementet
      const path = target.getAttribute("data-link-path");
      if (path) {
        this.onInternalLinkClicked(path);
      }
    });

    // 2. LINK HOVERED (Vekker Obsidians offisielle Page Preview!)
    // SIKRING: Vi legger til 'target' i parameterlisten slik at Obsidians .on() 
    // garanterer at 'target' ALLTID er det ekte .focusable-note-link (<a>) elementet!
    this.contentEl.on("mouseover", ".focusable-note-link", (event, target) => {
      if (!target) return;

      // Videresender både event (for mus-koordinater) og target (for data-href) [dan]
      this.onMouseOverLink(event, target);
      
      // Legger til din hover-klasse for CSS-effekter
      target.addClass('is-hovered');
    });

    // 3. LINK HOVER ENDED (Fjerner popup og visuelle effekter safely)
    this.contentEl.on("mouseout", ".focusable-note-link", (event, target) => {
    if (target) {
      target.removeClass('is-hovered');
    }
  });

  }

  private setupPlusMinusBtnHandler() {
    // 1. EVENT: Brukeren KLIKKER på pluss/minus-knappen (Kollapser/ekspanderer gruppen)
    this.contentEl.on("click", `.${RV_CLASSES.PLUS_MINUS_BTN}`, (event, target) => {
      event.preventDefault();
      if (!target || !(target instanceof HTMLElement)) return;

      this.onPlusMinusBtnClicked(target);
    });

    // En felles, flyktig popup-referanse for denne fanen
    let activePopup: HTMLElement | null = null;

    // 2. EVENT: Brukeren HOVRER over pluss/minus-knappen (Viser popup-boble live!)
    this.contentEl.on("mouseover", `.${RV_CLASSES.PLUS_MINUS_BTN}`, (event, target) => {
      if (!target || !(target instanceof HTMLElement)) return;

      // Hvis det mot formodning henger igjen en gammel popup, fjern den først
      if (activePopup) { activePopup.remove(); activePopup = null; }

      // Hent ut de to unike data-stemplene vi akkurat la på knappen i utils-en [dan]!
      const count = target.getAttribute("data-count") || "?";
      const tag = target.getAttribute("data-tag") || "Gruppe";
  
      // Sjekk om gruppen allerede er utvidet (hvis den har minus-tegn, er den expanded)
      const isExpanded = target.textContent?.includes(RV_CLASSES.MINUS) ?? false;
      const hoverText = isExpanded 
        ? `Klikk for å skjule medlemmene` 
        : `Klikk for å vise ${count} noder i denne gruppen`;

      // Bygg den lekre popupen ferskt i minnet (Bruker dine egne beskrivende klasser fra DOMUtils!)
      activePopup = createDiv({ cls: RV_CLASSES.INFO_HOVER });

      // Vi bruker hele tag-navnet (f.eks. #samling) som en lekker tittel på popupen [dan]!
      activePopup.createEl("p", { text: tag, cls: "popup-title" });
      const ul = activePopup.createEl("ul");
      ul.createEl("li", { text: hoverText });

      // Sett basestyling (Må gjøres FØR vi måler bredden!)
      activePopup.style.position = "absolute";
      activePopup.style.zIndex = "var(--layer-menu)";
      activePopup.style.pointerEvents = "none";
      activePopup.style.background = "var(--background-secondary-alt)";
      activePopup.style.border = "1px solid var(--border-color)";
      activePopup.style.padding = "6px 10px";
      activePopup.style.borderRadius = "4px";

      // --- NYTT: GJØR POPUPEN USYNLIG OG DYTT DEN INN FOR Å MÅLE DEN ---
      activePopup.style.visibility = "hidden"; // Skjul den for brukeren et millisekund [dan]
      this.contentEl.appendChild(activePopup);

      // Nå kan vi måle nøyaktig hvor mange piksler bred popupen ble basert på teksten! [dan]
      const popupWidth = activePopup.offsetWidth || 160; // Fallback til 160px hvis tom [dan]

      // Hent de fysiske målene til knappen og selve Obsidian-visningen
      const viewRect = this.contentEl.getBoundingClientRect();
      const btnRect = target.getBoundingClientRect();

      // Luftmargin mellom knappen og popup-boblen (10 piksler er kjempepent)
      const padding = 10; 

      // ==========================================================================
      // INTELLIGENT KANT-SJEKK (Dersom høyre flanke er for trang)
      // ==========================================================================

      // Vi regner ut hvor høyre kant av popupen vil lande dersom vi legger den til høyre.
      // Hvis den lander utenfor bredden til hele fanen din (viewRect.right), er det for trangt [dan]!
      const vilKrasjePåHøyreSide = (btnRect.right + padding + popupWidth) > viewRect.right;

      if (vilKrasjePåHøyreSide) {
        // === PLASSER PÅ VENSTRE FLANKE ===
        activePopup.style.left = `${btnRect.left - viewRect.left - popupWidth - padding}px`;
      } else {
        // === PLASSER PÅ HØYRE FLANKE (Standard) ===
        activePopup.style.left = `${btnRect.right - viewRect.left + padding}px`;
      }

      // Sentrer popupen dønn perfekt vertikalt (Y-akse) i forhold til knappen [dan]
      // Vi tar knattekanten på topp, og trekker fra en liten justering for å sentrere høyden [dan]
      activePopup.style.top = `${btnRect.top - viewRect.top - 15}px`;

      // Gjør popupen synlig for brukeren igjen nå som den står på rett plass! [dan]
      activePopup.style.visibility = "visible";
      // Dytt popupen synlig inn i fanen din
      this.contentEl.appendChild(activePopup);
    });

    // 3. EVENT: Brukeren flytter musen BORT fra pluss/minus-knappen (Sletter popupen øyeblikkelig)
    this.contentEl.on("mouseout", `.${RV_CLASSES.PLUS_MINUS_BTN}`, (event, target) => {
      if (activePopup) { activePopup.remove(); activePopup = null; }
    });
  }
  
  // #endregion
}
