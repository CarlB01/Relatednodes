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
    
    // 1. KORRIGERT: Finn den nærmeste tag-gruppen (.rv-groups) som denne knappen tilhører.
    // .closest() klatrer oppover i HTML-treet til den finner riktig boks, uansett antall wrappers!
    const groupDiv = target.closest(`.${RV_CLASSES.GROUPS}`) as HTMLElement;
    if (!groupDiv) return;
    
    // 2. KORRIGERT: Hent alle de individuelle note-knappene (.item) inni denne spesifikke gruppen.
    // Vi bruker querySelectorAll for maksimal nettleser-hastighet.
    const items = Array.from(groupDiv.querySelectorAll('.item')) as HTMLElement[];
    if (items.length <= 1) return; // Ingenting å skjule hvis det bare er 1 note

    const textContent = target.textContent || "";
    const textParts = textContent.split(" ");
    const label = textParts[0] || "";

    // Sjekk om knappen akkurat nå viser pluss-tegnet
    if (textParts[1] === RV_CLASSES.PLUS) {
      // === APNE GRUPPEN (EXPAND) ===
      groupDiv.classList.add('expanded');
      
      // Vis absolutt alle notene fra indeks 1 og utover (beholder den første synlig)
      items.slice(1).forEach(item => item.classList.remove('hidden'));
      
      // Oppdater teksten på knappen til å vise minus-tegnet
      target.textContent = `${label} ${RV_CLASSES.MINUS}`;
    } else {
      // === LUKK GRUPPEN (COLLAPSE) ===
      groupDiv.classList.remove('expanded');
      
      // Skjul alle notene bortsett fra den aller første
      items.slice(1).forEach(item => item.classList.add('hidden'));
      
      // Oppdater teksten på knappen tilbake til pluss-tegnet
      target.textContent = `${label} ${RV_CLASSES.PLUS}`;
    }
    
    // Siden boksene på skjermen akkurat endret høyde/form, MÅ vi be AreaManager 
    // om å beregne de nye piksel-koordinatene og flytte SVG-linjene live!
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
    this.contentEl.on("click", ".rv-plusminus", (event, target) => {
      event.preventDefault();
      if (!target || !(target instanceof HTMLElement)) return;

      this.onPlusMinusBtnClicked(target);
    });

    // En felles, flyktig popup-referanse for denne fanen
    let activePopup: HTMLElement | null = null;

    // 2. EVENT: Brukeren HOVRER over pluss/minus-knappen (Viser popup-boble live!)
    this.contentEl.on("mouseover", ".rv-plusminus", (event, target) => {
      if (!target || !(target instanceof HTMLElement)) return;

      // Hvis det mot formodning henger igjen en gammel popup, fjern den først
      if (activePopup) {
        activePopup.remove();
        activePopup = null;
      }

      // Vi henter ut hvor mange notater denne gruppen inneholder.
      // (Forutsetter at din DOMUtils dytter inn f.eks. button.setAttribute('data-count', group.notes.length.toString()) når den lages!)
      const count = target.getAttribute("data-count") || "?";
      
      // Sjekk om gruppen allerede er utvidet (hvis den har minus-tegn, er den expanded)
      const isExpanded = target.textContent?.includes('−') ?? false;
      const hoverText = isExpanded 
        ? `Klikk for å skjule ${count} notater` 
        : `Klikk for å vise ${count} skjulte notater`;

      // Bygg den lekre popupen ferskt i minnet (Bruker dine egne beskrivende klasser fra DOMUtils!)
      activePopup = createDiv({ cls: "rv-info-hover bordered-div rounded-div" });
      
      // Strukturer innholdet nøyaktig slik du opprinnelig designet det
      activePopup.createEl("p", { text: "Skjulte data", cls: "popup-title" });
      const ul = activePopup.createEl("ul");
      ul.createEl("li", { text: hoverText });

      // CSS-Styling for å plassere popupen rett over eller ved siden av pluss/minus-knappen:
      activePopup.style.position = "absolute";
      activePopup.style.zIndex = "var(--layer-menu)"; // Obsidians offisielle z-indeks for menyer
      activePopup.style.pointerEvents = "none";       // Sørger for at den ikke blokkerer musen
      activePopup.style.background = "var(--background-secondary-alt)";
      activePopup.style.border = "1px solid var(--border-color)";
      activePopup.style.padding = "6px 10px";
      activePopup.style.borderRadius = "4px";

      // Finn ut nøyaktig hvor knappen er på skjermen relativt til fanens container
      const viewRect = this.contentEl.getBoundingClientRect();
      const btnRect = target.getBoundingClientRect();

      // Plasser popupen dønn perfekt rett OVER pluss/minus-knappen! [dan]
      activePopup.style.left = `${btnRect.left - viewRect.left}px`;
      activePopup.style.top = `${btnRect.top - viewRect.top - 55}px`; // Skyver den 55 piksler opp

      // Dytt popupen synlig inn i fanen din
      this.contentEl.appendChild(activePopup);
    });

    // 3. EVENT: Brukeren flytter musen BORT fra pluss/minus-knappen (Sletter popupen øyeblikkelig)
    this.contentEl.on("mouseout", ".rv-plusminus", (event, target) => {
      if (activePopup) {
        activePopup.remove(); // Sletter fysisk fra DOM-treet for å unngå minneforurensning! [dan]
        activePopup = null;
      }
    });
  }
  
  // #endregion
}
