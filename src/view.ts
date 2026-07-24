import RelatednotesPlugin from './main.js';
import { HoverPopover, TFile, WorkspaceLeaf, HoverParent, MarkdownView, FileView, Platform, ItemView, TAbstractFile, App} from 'obsidian';
import { AreaManager } from './AreaManager.js';
import { RV } from './constants.js';

export class RelatednotesView extends ItemView implements HoverParent {

  private plugin: RelatednotesPlugin;
  app: App;
  public areaManager!: AreaManager;
  
  private currentFilePath: string = ""; // Holder styr på hvilken fil dette vinduet viser akkurat nå
  private lastMouseEvent: MouseEvent | null = null;
  private lastMouseTarget: HTMLElement | null = null;
  hoverPopover: HoverPopover | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: RelatednotesPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.app = plugin.app;
  }

  // #region SUPPORT & FUNCTIONS
  
  getViewType(): string { return RV.RELATED_NOTES_VIEW_TYPE }
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

    // Hent bladet basert på din GJELDENDE visnings-ID (RV.RELATED_NOTES_VIEW_TYPE) [dan]
    
    const leaves = this.app.workspace.getLeavesOfType(RV.RELATED_NOTES_VIEW_TYPE); 
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
    this.setupDataReadyHandler();
    this.setupMobileSafeguards();
    this.setupVisibilitySafeguards();
    this.setupInternalLinkHandler();
    this.setupPlusMinusBtnHandler();
    this.setupInfoBtnHandler();
  
    
    // 3. ÅPNINGSSEKVENS: Kjør når nettleseren er klar
    requestAnimationFrame(async () => {
      // Hent filen som faktisk er åpen på skjermen akkurat nå
      const activeFile = this.getMostRecentMarkdownFile();

      if (activeFile) { 
        await this.onFileChange(activeFile);
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

  async onFileChange(file: TFile | null) {
    if (!file) return;

    this.currentFilePath = file.path; // Lås vinduets identitet til denne filen
    await this.plugin.relatedData.update(file); 
  }

  private onPlusMinusBtnClicked(target: HTMLElement) {
    const plus = RV.PLUS;   // Det eksakte pluss-tegnet ditt (f.eks. '+')
    const minus = RV.MINUS; // Det eksakte minus-tegnet ditt (f.eks. '−')

    // Finn den nærmeste tag-gruppe-containeren (.rv-groups) som denne knappen styrer [dan]
    const groupDiv = target.closest(`.${RV.GROUPS}`) as HTMLElement;
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
      const count = items.length.toString();
      target.textContent = `${plus}${count}`;
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

    this.plugin.registerHoverLinkSource(RV.RELATED_NOTES_VIEW_TYPE, {
      display: 'My custom Hover', // Name shown in Page Preview settings
      defaultMod: false,          // or true if you want Ctrl/Cmd required
    });
  }

  private setupDataReadyHandler() {
    // ==========================================================================
    // FLER-VINDUS-BROEN:
    // Hvert vindu lytter på den felles hendelsen. Men takket være stisjekken, 
    // vil dette vinduet KUN re-vandre og tegne kurvene sine dersom de vaskede 
    // dataene tilhører den filen som DETTE vinduet faktisk viser på skjermen!
    // ==========================================================================
    this.plugin.registerEvent(
      this.app.workspace.on("related:data-ready" as any, ((vasketPath: string) => {
        
        if (vasketPath === this.currentFilePath && this.areaManager) {
          this.areaManager.renderGraph(); // Re-tegner KUN dette vinduets linjer!
        }
      }) as any) 
    );
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

  private setupPlusMinusBtnHandler() {
    this.contentEl.on("click", `.${RV.PLUS_MINUS_BTN}`, (event, target) => {
      event.preventDefault();
      if (!target || !(target instanceof HTMLElement)) return;
      this.onPlusMinusBtnClicked(target);
    });
  }

  private setupInfoBtnHandler() {
    // Felles, flyktig referanse for info-popupen
    let activeInfoPopup: HTMLElement | null = null;

    // HOVER INN PÅ INFO-KNAPPEN (Viser antall ignorerte noder live!) [dan]
    this.contentEl.on("mouseover", ".rv-info-btn", (event, target) => {
      if (!target || !(target instanceof HTMLElement)) return;

      if (activeInfoPopup) { activeInfoPopup.remove(); activeInfoPopup = null; }

      // Hent ut antallet vi stemplet på knappen i sted [dan]
      const count = target.getAttribute("data-ignored-count") || "0";
      const hoverText = `${count} skjulte filer`;
 
      // Bygg din lekre popover-beholder i minnet [dan]
      activeInfoPopup = createDiv({ cls: RV.INFO_HOVER });
      activeInfoPopup.createSpan({ text: hoverText, cls: "popup-title" });
      
      // Sett basestyling (Matcher dine eksisterende glass-menyer)
      activeInfoPopup.style.position = "absolute";
      activeInfoPopup.style.zIndex = "var(--layer-menu)";
      activeInfoPopup.style.pointerEvents = "none";
      activeInfoPopup.style.background = "var(--background-secondary-alt)";
      activeInfoPopup.style.border = "1px solid var(--border-color)";
      activeInfoPopup.style.padding = "6px 10px";
      activeInfoPopup.style.borderRadius = "4px";
      activeInfoPopup.style.boxShadow = "0 2px 8px rgba(0, 0, 0, 0.25)";

      // Trikset: Gjør den usynlig et millisekund for å måle den rå bredden live [dan]
      activeInfoPopup.style.visibility = "hidden";
      this.contentEl.appendChild(activeInfoPopup);

      const popupWidth = activeInfoPopup.offsetWidth || 180;
      const viewRect = this.contentEl.getBoundingClientRect();
      const btnRect = target.getBoundingClientRect();
      const padding = 10;

      // Intelligent kantsjekk: Hvis høyre side er for trang, dytter vi den til venstre flanke [dan]
      const vilKrasjePåHøyreSide = (btnRect.right + padding + popupWidth) > viewRect.right;

      if (vilKrasjePåHøyreSide) {
        activeInfoPopup.style.left = `${btnRect.left - viewRect.left - popupWidth - padding}px`;
      } else {
        activeInfoPopup.style.left = `${btnRect.right - viewRect.left + padding}px`;
      }

      // Sentrer vertikalt på Y-aksen nøyaktig som pluss/minus-knappen
      activeInfoPopup.style.top = `${btnRect.top - viewRect.top - 15}px`;
      activeInfoPopup.style.visibility = "visible";
      
      target.addClass('is-hovered');
    });

    // HOVER UT FRA INFO-KNAPPEN (Sletter popuputen for å forhindre minnelekkasjer!) [dan]
    this.contentEl.on("mouseout", ".rv-info-btn", (event, target) => {
      if (target) target.removeClass('is-hovered');
      if (activeInfoPopup) {
        activeInfoPopup.remove();
        activeInfoPopup = null;
      }
    });

  }

  // #endregion

  // #region LINK CLICK HANDLING

  public setupInternalLinkHandler() {

    // 1. CLICK
    this.contentEl.on("click", ".focusable-note-link", (event, target) => {
      event.preventDefault();
      const path = target.getAttribute("data-link-path");
      if (path) this.onInternalLinkClicked(path);
    });

    // 2. MOUSEOVER
    this.contentEl.on("mouseover", ".focusable-note-link", (event: MouseEvent, target: HTMLElement) => {
      this.lastMouseEvent = event;
      this.lastMouseTarget = target;

      // Hvis brukeren allerede holder nede Cmd/Ctrl når de glir inn over lenken
      if (event.metaKey && !target.hasClass('is-hovered')) {
        this.onMouseOverLink(event, target);
        target.addClass('is-hovered');
      }
    });

    // 3. MOUSEENTER
    this.contentEl.on("mouseenter", ".focusable-note-link", (event: MouseEvent, target: HTMLElement) => {
      target.removeClass('is-hovered');
      this.lastMouseEvent = null;
      this.lastMouseTarget = null;
    });

    // 4. KEYDOWN
    this.registerDomEvent(window, "keydown", (event: KeyboardEvent) => {
      if (event.key === "Meta") {

        // Sjekker om musen faktisk ligger fysisk over vårt lagrede mål akkurat nå via standard :hover
        if (this.lastMouseTarget && this.lastMouseTarget.matches(':hover')) {
          if (this.lastMouseEvent && !this.lastMouseTarget.hasClass('is-hovered')) {
            this.onMouseOverLink(this.buildMouseEvent(), this.lastMouseTarget);
            this.lastMouseTarget.addClass('is-hovered');
          }
        }
      }
    });

    // 5. KEYUP
    this.registerDomEvent(window, "keyup", (event: KeyboardEvent) => {
      if (event.key === "Meta") {
        const elements = document.querySelectorAll(".focusable-note-link.is-hovered");
        elements.forEach(el => el.removeClass("is-hovered"));
      }
    });
  }

  /** SMALL helper function */
  private buildMouseEvent(): MouseEvent {
    return new MouseEvent("mouseover", {
      bubbles: true,
      cancelable: true,
      view: window,
      metaKey: true, 
      ctrlKey: true, 
      clientX: this.lastMouseEvent ? this.lastMouseEvent.clientX : 0, 
      clientY: this.lastMouseEvent ? this.lastMouseEvent.clientY : 0
    });
  }

  private onMouseOverLink(event: MouseEvent, targetBox: HTMLElement) {
    const linktext = targetBox.getAttribute("data-link-path") || targetBox.getAttribute("data-href");
    const sourcePath = targetBox.getAttribute("data-link-path");

    if (linktext) {

      this.app.workspace.trigger('hover-link', {
        event: event,
        source: RV.RELATED_NOTES_VIEW_TYPE,
        targetEl: targetBox,
        linktext: linktext,
        sourcePath: sourcePath || linktext,
        hoverParent: this
      });
      
      targetBox.addClass('is-hovered');
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

    const currentCenter = this.plugin.relatedData.centerNote;
    if (currentCenter && currentCenter.path === selectedFile.path) {      
      this.areaManager.requestRedraw(); 
      return; 
    }

    // Hvis det var en NY node, kjører vi den fulle, dype navigasjonen som før:
    this.openLinkInAdjacentPane(internalLink);
    await this.onFileChange(selectedFile);
    this.areaManager.renderGraph();
  }

  // #endregion
}
