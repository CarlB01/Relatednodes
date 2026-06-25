import RelatednotesPlugin, { RELATED_NOTES_VIEW_TYPE, relatednodesID } from './main.js';
import { HoverPopover, TFile, WorkspaceLeaf, HoverParent, MarkdownView, FileView, Platform, ItemView} from 'obsidian';
import { RelatedData} from './data.js';
import { AreaManager } from './AreaManager.js';

export class RelatednotesView extends ItemView implements HoverParent {

  readonly type = relatednodesID;
  private readonly displayWelcomeText = 'to view related notes, please open one of your notes first';
      
  private related: RelatedData;
  private areaManager: AreaManager;
  private plugin: RelatednotesPlugin;
  private mostRecentActiveFile: TFile | null = null;
    
  hoverPopover: HoverPopover | null = null;
  private animationFrameId: number | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: RelatednotesPlugin) {
    super(leaf);
    this.plugin = plugin;
    
    // handling of data
    this.related = new RelatedData(this.app, this.plugin, () => this.onDataUpdated());

    // handling of graph layout    
    this.areaManager = new AreaManager(this.related, this.contentEl);
  }

  
  // #region SUPPORT & FUNCTIONS
  
  getViewType(): string { return RELATED_NOTES_VIEW_TYPE }
  getDisplayText(): string { return "Related Notes" }
  getIcon(): string { return "lucide-apple" }

  /**
   * Den oppdaterte dørvakten som sikrer silkemyk linjeoppdatering 
   * BÅDE under scrolling og når brukeren drar i skillevegger!
   */
  public requestRedraw() {
    // Hvis det allerede er planlagt en tegning i denne framen, 
    // avbryter vi det FORRIGE varselet slik at vi kan planlegge et nytt 
    // med de aller nyeste piksel-målene fra drag-bevegelsen!
    if (this.animationFrameId !== null) {
        cancelAnimationFrame(this.animationFrameId);
    }

    // Planlegg en ny, frisk tegning synkronisert med skjermens oppdatering (60Hz)
    this.animationFrameId = requestAnimationFrame(() => {

      const viewContainer = this.containerEl.querySelector('.related-view-container') || this.containerEl;

      // ==========================================================================
        // ASYMMETRISK KOLLISJONS-FYSIKK FOR VENSTRE SIDE (JavaScript-styrt)
        // ==========================================================================
        const leftArea = viewContainer.querySelector('.related-left-area') as HTMLElement;
        const centerArea = viewContainer.querySelector('.related-center-area') as HTMLElement;

        if (leftArea && centerArea) {
            const centerRect = centerArea.getBoundingClientRect();
            const containerRect = viewContainer.getBoundingClientRect();

            // 1. Finn den absolutte bunn-veggen (bunnkanten av senternotatet)
            // Siden vi vil at venstre side ALDRI skal presses lavere enn dette, er dette vårt faste nullpunkt.
            const spaceToTop = centerRect.bottom - containerRect.top;

            // 2. Sjekk den EKTE naturlige innholdshøyden til venstre boks (scrollHeight)
            const leftContentHeight = leftArea.scrollHeight;
            const centerHeight = centerRect.height;

            if (leftContentHeight > centerHeight) {
                // Hvis listen blir høyere enn senternotatet:
                // Tving den ut av grid-stivheten ved å gjøre den absolutt inni sin kolonne
                leftArea.style.position = 'absolute';
                leftArea.style.bottom = `${containerRect.bottom - centerRect.bottom + 5}px`; // Lås bunnen 5px over lower-area
                leftArea.style.top = 'auto'; // La toppen være helt fri til å klatre oppover
                
                // Sett makshøyden slik at den stopper nøyaktig når den treffer toppen av vinduet!
                leftArea.style.maxHeight = `${spaceToTop - 20}px`; 
            } else {
                // Hvis den har få elementer: La den falle tilbake til ren CSS-sentrering i rad 3
                leftArea.style.position = '';
                leftArea.style.bottom = '';
                leftArea.style.top = '';
                leftArea.style.maxHeight = '45vh'; // Standard trygg default
            }
        }

      // 1. Gjør det automatiske Yield-byttet i JavaScript (data-right-tall)
      const rightWrapper = viewContainer.querySelector('.related-right-area .related-columns-wrapper') as HTMLElement;

      // 2. Tegn linjene på nytt basert på de ferskeste drag-koordinatene!
      if (this.related?.centerNote) {
        this.areaManager.drawAllGraphLinks(this.related.centerNote);
      }
      // Nullstill ID-en så neste frame kan kjøre fritt
      this.animationFrameId = null;
    });
  }
  // #endregion

  // #region ACTIONS
  
  /**
   * Helper function.
   * @param leaf 
   * @returns true if leaf is relatedview itself.
   */
  private activeSelf(leaf?: WorkspaceLeaf): boolean | null {
    if (!leaf) return null;
     
    // const file = (leaf.view as MarkdownView).file;
    // const viewType = leaf.view.getViewType(); // viewType === 'bases'
    const element = leaf.containerEl.querySelector(`.${RELATED_NOTES_VIEW_TYPE}`);
    if (element) return true;
    return false
  }

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
      // 1. Ensure leaf.view is loaded and is an instance of FileView
      if (leaf.view instanceof FileView) {
        // 2. TypeScript now safely recognizes the .file property
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
  async openLinkInAdjacentPane(filename: string) {
    const file = this.getFile(filename);
    if (!file) return;

    if (!this.mostRecentActiveFile) return;

    //1. target the leaf that contains "old" centered link 
    let targetLeaf = this.findLeafWithFile(this.mostRecentActiveFile);

    //2. alternatively replace most recent view
    if (!targetLeaf) {
      const recentLeaf = this.app.workspace.getMostRecentLeaf();
      if (recentLeaf && ['empty', 'markdown'].contains(recentLeaf.view.getViewType())
      ){
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
    
    /*this.app.workspace.iterateAllLeaves((leaf: WorkspaceLeaf) => {
      console.log(' - - ',leaf.getViewState().type);
    })*/
    const leaves = this.app.workspace.getLeavesOfType('bases'); //it was NOT relatednodesID
    const targetLeaf = leaves[0];
    if (targetLeaf === undefined) return;
    
    // Bring the leaf to the foreground (and expand the sidebar if docked there)
    await this.app.workspace.revealLeaf(targetLeaf);
  
    // Set the leaf as active/focused
    this.app.workspace.setActiveLeaf(targetLeaf);
  }
  
  private displayWelcome() {
    const containerEl = this.areaManager.containerEl;
    const center = this.areaManager.center;
    containerEl.appendChild(center);
    console.log('displayed welcome');
  }

  private revealSomeLeafAndFile(): [TFile | null, WorkspaceLeaf | null] {
    const { workspace } = this.app;

    // 0. Get the currently active file
    const currentFile = this.app.workspace.getActiveFile();
    if (currentFile) return [currentFile, null];
  
    // 1. Get the currently active view if it is a Markdown file
    const activeView = workspace.getActiveViewOfType(MarkdownView);
    
    if (activeView && activeView.file) {
        return [activeView.file, activeView.leaf];
    }

    // 2. Fallback: If focus is on a sidebar/plugin, find the most recently active markdown leaf
    const mdLeaves = workspace.getLeavesOfType('markdown');
    if (mdLeaves.length > 0) {
        const fallbackLeaf = mdLeaves[0]; // Henter det første panelet
        
        // Sjekk eksplisitt at fallbackLeaf og view eksisterer for å tilfredsstille TypeScript
        if (fallbackLeaf && fallbackLeaf.view instanceof MarkdownView) {
            const leafFile = fallbackLeaf.view.file;
            if (leafFile) {
                return [leafFile, fallbackLeaf];
            }
        }
    }

    // 3. Last resort fallback: No markdown leaves are open at all
    const lastOpenedFilepaths = workspace.getLastOpenFiles();
    const firstPath = lastOpenedFilepaths[0]; // Dette blir string | undefined

    if (firstPath) {
        // Nå vet TypeScript at firstPath er en garantert string
        const file = this.app.vault.getFileByPath(firstPath);
        if (file) {
            return [file, null];
        }
    }

    return [null, null];
  }

  // #endregion

  // #region ACTION RECEIVERS

   async onOpen() {

    // 1. set up areas
    this.contentEl.empty();
    this.areaManager.initiate()

    // 2. set up various monitors
    this.registerFileOpenListener()
    this.registerWorkspaceLayoutChanges();
    this.registerContainerScrolled();
    this.registerRightAreaScrolled();
    this.registerLowerAreaScrolled();
    this.registerHoverLinkSource();
    this.setupMobileSafeguards();
    this.setupVisibilitySafeguards();
    
    this.setupInternalLinkHandler();
    this.setupPlusMinusBtnHandler();
    
    // 3. Fetch a file - or display welcome
    requestAnimationFrame(() => { //  When browser CSS is ready
      const [initialFile, initialLeaf] = this.revealSomeLeafAndFile();

      if (initialFile) { 
        this.mostRecentActiveFile = initialFile;
        this.related.update(initialFile);
      } else {
        this.onActiveLeafChanged(initialLeaf);
        this.displayWelcome();
      }
    });
   
  }

  async onClose() {
  }

  /**
   * onDataUpdated is called by Obsidian whenever there is a configuration
   * or data change in the vault which may affect your view.
   */
  public onDataUpdated(): void {
    
    console.log('onDataUpdated', this.related.centerNote?.basename)
    
    this.areaManager.updateGraph();

  }

  private onActiveLeafChanged(leaf: WorkspaceLeaf | null) {

    console.log('onActiveLeafChanged', this.related.centerNote?.basename)
    
    // 2. SAFEGUARD: Catch when focus shoots back and forth after selecting a file
    if (leaf && leaf.view instanceof MarkdownView) {
      // If our panel happens to still be visible, queue a safe redraw
      if (this.areaManager.containerEl.isShown()) {
        setTimeout(() => {
          this.onVisibilityChange();
        }, 150);
      }
      this.app.workspace.revealLeaf(leaf);
    }
  }

  /**
   * Calls for update of related data model from user click.
   * Opens selection in adjacent pane.
   * @param internalLink 
   */
  private onInternalLinkClicked(internalLink: string): void {

    const selectedFile = this.getFile(internalLink);
    
    if (selectedFile) {
      console.log('onActiveLeafChanged', selectedFile.basename)
      this.mostRecentActiveFile = selectedFile;
      this.related.update(selectedFile)
      this.openLinkInAdjacentPane(internalLink);
    }
  }

  private onMouseOverLink(targetBox: HTMLElement) {
    const linktext = targetBox.getAttribute("data-basename");
      const sourcePath = targetBox.getAttribute("data-path");

      if (linktext) {
        // Fyr av Obsidians offisielle Page Preview-event
        this.app.workspace.trigger('hover-link', {
          event: event,
          source: "related-nodes-view", // ID for din plugin-visning
          targetEl: targetBox,
          linktext: linktext,
          sourcePath: sourcePath || linktext,
          hoverParent: { hoverPopover: null, containerEl: this.containerEl }
        });
        
        targetBox.addClass('is-hovered');
      }
  }

  private onPlusMinusBtnClicked(target: HTMLElement) {
    const minus = '−';
    const plus = '+';

    const containerDiv = target.parentElement?.parentElement?.parentElement;
    const divs = containerDiv?.findAll('.related-linkDiv');
    const textParts = target.textContent.split(" ");

    if (textParts[1] == plus) {
      containerDiv!.classList.add('expanded');
      divs!.slice(1).forEach(d => d.classList.remove('hidden'));
      target.textContent = `${textParts[0]} ${minus}`;
    } else {
      containerDiv!.classList.remove('expanded');
      divs!.slice(1).forEach(d => d.classList.add('hidden'));
      target.textContent = `${textParts[0]} ${plus}`;
    };
  }
  
  async onExternalSettingsChange() {
    console.log('onExternalSettingsChange', this.mostRecentActiveFile?.basename)
    this.related.update(this.mostRecentActiveFile)
	};

  private onWorkspaceLayoutChanged() {
    console.log('workspaceLayoutChanged', this.related.centerNote?.basename)
    this.areaManager.drawAllGraphLinks(this.related.centerNote);
  }

  override onResize() {
    super.onResize();

    console.log('onResize', this.related.centerNote?.basename)
    this.requestRedraw()
  }

  private onVisibilityChange() {
    console.log('onVisibilityChange', this.related.centerNote?.basename)
    this.requestRedraw()
  }

  private onTransformWidthEnded() {
    console.log('onTransformWidthEnded', this.related.centerNote?.basename)
    this.requestRedraw()  
  }

  private onOrientationChanged() {
    this.requestRedraw()  
  }

  private onContainerScrolled() {
    console.log('onContainerScrolled', this.related.centerNote?.basename)
    this.requestRedraw()  
  }

  private onRightAreaScrolled() {
    console.log('onRightAreaScrolled', this.related.centerNote?.basename)
    this.requestRedraw()  
  }

  // #endregion
  
  // #region REGISTER & SETUP
  
  /** Event som lytter på ALL fremtidig navigasjon
   * 'file-open' er mer robust enn 'active-leaf-change' fordi det garanterer 
   * at vi får et TFile-objekt med en gang brukeren bytter fane eller notat.
   */
  private registerFileOpenListener() {
    this.registerEvent(
      this.app.workspace.on('file-open', (file: TFile | null) => {
        if (file) {
          this.mostRecentActiveFile = file;
          this.related.update(file);
        }
      })
    );
  }

  private registerWorkspaceLayoutChanges() {

    // 'layout-change' fires when a structural layout shift occurs, 
    // including: 
    // 
    // Opening or closing tabs/leaves (e.g., 
    // - clicking a note, opening a new split pane, closing a sidebar tab
    // Moving leaves around 
    // - dragging a tab from the main workspace into the sidebar, 
    // - re-arranging split panels
    // Toggling view modes 
    // - switching a note leaf from Editing view to Reading view
    // Collapsing or expanding sidebars
    // - hiding or exposing the file tree
    this.registerEvent(
      this.app.workspace.on('layout-change', () => {
        this.onWorkspaceLayoutChanged()
      })
    );
  }

  private registerContainerScrolled() {
    // Main container scroll
    let containerEl = this.containerEl;
    let plugin = this.plugin;
    
    if (!containerEl) return;
    
    plugin.registerDomEvent(containerEl, 'scroll', () => {
       this.onContainerScrolled();
    }, { 
      passive: true 
    });

  }

  private registerRightAreaScrolled() {
    // Main container scroll
    let containerEl = this.containerEl;
    let plugin = this.plugin;
    
    // Right Area scroll
    plugin.registerDomEvent(this.areaManager.right, 'scroll', () => {
      this.onRightAreaScrolled() 
    },{ 
      passive: true 
    });
  }

  private registerLowerAreaScrolled() {
    let plugin = this.plugin;

    if (this.areaManager.lower) {
      plugin.registerDomEvent(this.areaManager.lower, 'scroll', () => {
        this.requestRedraw() 
      },{ 
        passive: true 
      });
    }
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
          this.onTransformWidthEnded(); // Final clean redraw at rest
        }
      });
    }

    // SAFEGUARD 4: Fallback for orientation changes (turning iPhone landscape/portrait)
    this.registerDomEvent(window, 'orientationchange', () => {
      setTimeout(() => {
          this.onOrientationChanged();
      }, 200); // 200ms delay gives iOS time to complete the rotation layout
    });
  }
	
  private setupVisibilitySafeguards() {
    // 1. SAFEGUARD: Detect when the view physically enters/leaves the iPhone screen
    const visibilityObserver = new IntersectionObserver((entries) => {
      for (let entry of entries) {
        // isIntersecting is true the exact moment the panel slides into view
        if (entry.isIntersecting) {
          // 1. Wait for the initial layout timeout
          setTimeout(() => {
            // 2. Wait until the browser thread is completely idle (finished rendering complex UI)
            if ('requestIdleCallback' in window) {
                window.requestIdleCallback(() => {
                  this.onVisibilityChange();
                }, { timeout: 200 }); // Timeout forces execution after 200ms maximum if busy
            } else {
                // Fallback for environments without idle callback support
                this.onVisibilityChange();
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

      const basename = target.getAttribute("data-link-path");
      if (basename) {
        this.onInternalLinkClicked(basename);
      }
    });

    // 2. LINK HOVERED
    this.contentEl.on("mouseover", ".focusable-note-link", (event) => {
      // Check if Mouse is over a linkDiv
      //const targetBox = (event.target as HTMLElement).closest(".focusable-note-link") as HTMLElement | null;
      const targetBox = event.target as HTMLElement;
      if (!targetBox) return;

      this.onMouseOverLink(targetBox);
      targetBox.addClass('is-hovered');
    });

    // 3. LINK HOVER ENDED
    this.contentEl.on("mouseout", ".focusable-note-link", (event) => {
      const targetBox = event.target as HTMLElement;
      if (!targetBox) return;
      
      targetBox.removeClass('is-hovered');
    });

  }

  private setupPlusMinusBtnHandler() {
    this.contentEl.on("click", ".related-plusminus", (event, target) => {
      event.preventDefault();
      if (!target || !(target instanceof HTMLElement)) return;

      this.onPlusMinusBtnClicked(target);
    });
    /*
    // prepare the popup
    const title = 'Hidden';
    const count = group.notes.length;
    const text = `<ul><li>click to show ${count} notes</li></ul>`;
    const popup = createDiv(`${DOMUtils.INFO_HOVER_DESCR}`);
    popup.innerHTML = `<p>${title}</p><p>${text}</p>`;
    popup.style.positionAnchor = anchor;


        //events
    this.plugin.registerDomEvent(button, 'mouseover', (evt: MouseEvent) => {
      containerDiv?.appendChild(popup);
    });
    this.plugin.registerDomEvent(button, 'mouseout', (evt: MouseEvent) => {
      containerDiv?.removeChild(popup);
    });
    */
  }
  
  // #endregion
  
  // #region LEFTOVERS

  /*
  private revealSomeLeafAndFile(): [TFile | null, WorkspaceLeaf | null] {
    
    const mdLeaves = this.app.workspace.getLeavesOfType('markdown');
    
    // 1. this is the only opened leaf/file -> use it
    if (mdLeaves.length == 1) {
      const mdLeaf = mdLeaves.first();
      if (mdLeaf) {
        const leafFile = (mdLeaf.view as MarkdownView).file;
        if (leafFile) return [leafFile, mdLeaf];
      }
    }

    const lastOpenedFilepaths = this.app.workspace.getLastOpenFiles();
    
    // 2. no markdown leaves, no last opened file? -> exit with [null, null]
    if (mdLeaves.length == 0 && lastOpenedFilepaths.length == 0) {
      console.log('no markdown leaves, no last opened file');
      return [null, null];
    }

    // 3. No open markdown leaves? - return last used md file
    if (mdLeaves.length == 0 && lastOpenedFilepaths.length > 0) {
      const filepath = lastOpenedFilepaths.first();
      if (filepath) {
        const file = this.getFile(filepath);
        if (file) return [file, null]
      }
    }

    // 4. return the leaf with the file that is NOT in lastOpenedFilepaths (yet)
    // most likely the active file?
    if (mdLeaves.length > 1 && lastOpenedFilepaths.length > 0) {
      for (const mdLeaf of mdLeaves) {
				const leafFile = (mdLeaf.view as MarkdownView).file;
        if (leafFile && !lastOpenedFilepaths.contains(leafFile.path)) {
          return [leafFile, mdLeaf]
        }
			}
    }

    // 5. fallback 
    return [null, null];
  }
    */

  // #endregion
}
