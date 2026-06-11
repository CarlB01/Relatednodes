import { 
    HoverPopover,
    TFile,
    WorkspaceLeaf,
    HoverParent,
    MarkdownView,
    FileView,
    Platform,
    ItemView,
} from 'obsidian';

import { RelatedData} from './data.js';
import RelatednotesPlugin, { RELATED_NOTES_VIEW_TYPE, relatednodesID } from './main.js';
import { LinksHandler } from './LinksHandler.js';
import { Areas } from './Areas.js';

export type updateMessage = 
  'rightAreaResized' | 
  'rightAreaScrolled' | 
  'bottomAreaResized' |
  'bottomAreaScrolled' |
  'workspaceResized' |
  'documentResized' |
  'activeNoteChanged' | 
  'activeLeafChanged' |
  'internalLinkClicked' |
  'fileWasOpened' |
  'dataUpdated' | 
  'dataModelReady' |
  'externalSettingsChanged' |
  'workspaceLayoutChanged' |
  'workspaceResized' |
  'resizeHandleMoved' |
  'resizeHandleReleased' |
  'viewContainerScrolled' |
  'requestedFullRedraw';

export class RelatednotesView extends ItemView implements HoverParent {
  readonly type = relatednodesID;
  private readonly displayWelcomeText = 'to view related notes, please open one of your notes first';
  private readonly groupDivInfo = 'related-group';
  private readonly linkDescr = 'related-link';
      
  private related: RelatedData;
  private linksHandler: LinksHandler;
  private areas: Areas;
  plugin: RelatednotesPlugin;

  hoverPopover: HoverPopover | null = null;
  
  constructor(leaf: WorkspaceLeaf, plugin: RelatednotesPlugin) {
    super(leaf);
    this.plugin = plugin;
    
    // handling of links
    this.linksHandler = new LinksHandler(plugin,
      (internalLink: string) => this.onInternalLinkClicked(internalLink)
    );

    // handling of data
    this.related = new RelatedData(this.app, this.plugin,
      (message) => this.updateHub(message)
    );

    // handling of areas - 'parent', 'child', 'friend', 'sibling' 
    const { contentEl } = this;
    this.areas = new Areas(this.related, this.linksHandler, contentEl, plugin);
  }

  getViewType(): string {
    return RELATED_NOTES_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Related Notes";
  }

  getIcon(): string {
    return "lucide-apple"; // or any other icon
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    
    // set up workspace resize monitors
    this.registerWorkspaceChanges();
    this.setupSplitterTracking();
    this.setupMobileSafeguards();
    this.setupVisibilitySafeguards();
    this.plugin.registerHoverLinkSource(relatednodesID, {
      display: 'My custom Hover', // Name shown in Page Preview settings
      defaultMod: false,          // or true if you want Ctrl/Cmd required
    });
    
    this.app.workspace.onLayoutReady(async () => {

      this.displayWelcome();
      const [initialFile, initialLeaf] = this.revealSomeLeafAndFile();
      console.log('initialFile', initialFile?.basename);
      console.log('initialLeaf', initialLeaf?.containerEl.classList.toString());
        if (initialFile) {
            this.updateHub('activeLeafChanged', initialFile, initialLeaf);
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
    this.updateHub('dataUpdated') 
  }

  /**
   * Calls for update of related data model from user click.
   * Opens selection in adjacent pane.
   * @param internalLink 
   */
  private onInternalLinkClicked(internalLink: string): void {

    const selectedFile = this.getFile(internalLink);
    if (selectedFile) {
      this.related.update(selectedFile)
      this.openLinkInAdjacentPane(internalLink);
    }
  }
  
  async onExternalSettingsChange() {
		this.updateHub('externalSettingsChanged')
	};

  /**
   * The coordinator and handler of rebuilding relatednotes view.
   * @param caller - a string of type updateMessage.
   */
  private async updateHub(caller: updateMessage, item1?: any | null, item2?: any | null) {
    
    console.log('caller:', caller);

    let areas = this.areas;
    let related = this.related;

    switch (caller) {
      case 'bottomAreaResized' :
      case 'bottomAreaScrolled' :
        areas.drawAllConnections;
        return;
      
      case 'rightAreaResized':
      case 'rightAreaScrolled' : 
        areas.drawAllConnections;
        return;

      case 'requestedFullRedraw': 
        areas.drawAllConnections;
        return;

      case 'internalLinkClicked':
        return;

      case 'dataUpdated': 
      case 'externalSettingsChanged':
        related.update(related.mostRecentActiveFile);
        return;

      case 'dataModelReady':
        this.areas.resetScaleFactor();
        this.areas.draw.updateOffBy();
        this.areas.plotAll();
        this.areas.checkContentOverflow();
        this.areas.drawAllGates();
        this.areas.drawAllConnections();
        return;

      case 'activeLeafChanged':
        const file = item1 instanceof TFile ? item1 : null;
        const leaf = item2 instanceof WorkspaceLeaf ? item2 : null;
        
        if (leaf && file) {
          this.app.workspace.revealLeaf(leaf);
          this.related.update(file);
        }
        return;

      case 'workspaceLayoutChanged':
      case 'workspaceResized':
      case 'resizeHandleMoved':
      case 'resizeHandleReleased':
        this.areas.drawAllConnections();
        return;
        
      case 'activeNoteChanged':
      case 'documentResized':
      case 'fileWasOpened':
      case 'viewContainerScrolled':

      default:
        break;
    }
    
  }


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

    if (!this.related.mostRecentActiveFile) return;

    //1. target the leaf that contains "old" centered link 
    let targetLeaf = this.findLeafWithFile(this.related.mostRecentActiveFile);

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
    const popup = createDiv();
    popup.innerHTML = `<p>notes RELATED</p><p>${this.displayWelcomeText}</p>`;
    this.areas.center.appendChild(popup);
  }

  private registerWorkspaceChanges() {

    // Register workspace resize
    this.registerEvent(this.app.workspace.on('resize', () => {
      this.updateHub('workspaceResized');
    }));

    // Optional: Also listen to file-open (more specific to Markdown files)
    this.registerEvent(
      this.app.workspace.on('file-open', (file: TFile | null) => {
        if (file) this.updateHub('fileWasOpened');
      })
    );  
    
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
        this.updateHub('workspaceLayoutChanged')
      })
    );
  }

  	/**
   * get active file - with fallback getting last opened file.
   * does not accept .base files as last opened file.
   * @param filename - string
   * @returns [The matching TFile, or null and WorkspaceLeaf or null].
   */
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

  private revealSomeLeafAndFile(): [TFile | null, WorkspaceLeaf | null] {
    const { workspace } = this.app;

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

  setupMobileSafeguards() {
    if (!Platform.isMobile) return;

    // SAFEGUARD 3: Catch the exact moment the iOS slide-in sidebar animation completes.
    // Obsidian's mobile drawer uses a CSS slide-in transition.
    const leftSplit = this.areas.containerEl.closest('.mod-left-split') as HTMLElement;
    if (leftSplit) {
        this.registerDomEvent(leftSplit, 'transitionend', (e: TransitionEvent) => {
            // Only trigger if the width transition finished changing the layout
            if (e.propertyName === 'transform' || e.propertyName === 'width') {
                this.areas.draw.updateOffBy();
                this.redrawMyContainer(); // Final clean redraw at rest
            }
        });
    }

    // SAFEGUARD 4: Fallback for orientation changes (turning iPhone landscape/portrait)
    this.registerDomEvent(window, 'orientationchange', () => {
        setTimeout(() => {
            this.areas.draw.updateOffBy();
            this.redrawMyContainer();
        }, 200); // 200ms delay gives iOS time to complete the rotation layout
    });
  }
	
  setupVisibilitySafeguards() {
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
                            this.areas.draw.updateOffBy();
                            this.redrawMyContainer();
                        }, { timeout: 200 }); // Timeout forces execution after 200ms maximum if busy
                    } else {
                        // Fallback for environments without idle callback support
                        this.areas.draw.updateOffBy();
                        this.redrawMyContainer();
                    }
                }, 150); 
            }
        }
    }, { 
        threshold: 0.1 // Triggers as soon as even 10% of the view is visible
    });

    // Start watching your add-on container element
    visibilityObserver.observe(this.areas.containerEl);
    this.register(() => visibilityObserver.disconnect());

    // 2. SAFEGUARD: Catch when focus shoots back and forth after selecting a file
    this.registerEvent(

      this.app.workspace.on('active-leaf-change', (leaf: WorkspaceLeaf | null) => {
        if (leaf && leaf.view instanceof MarkdownView) {

          // When a new file opens, clear any stale tracking data
          this.areas.draw.offBy = { x: 0, y: 0 };
          
          // If our panel happens to still be visible, queue a safe redraw
          if (this.areas.containerEl.isShown()) {
              setTimeout(() => {
                  this.areas.draw.updateOffBy();
                  this.redrawMyContainer();
              }, 150);
          }
          const activeFile = leaf.view.file;
          this.updateHub('activeLeafChanged', activeFile, leaf)
        }
      })
    );
  }

  setupSplitterTracking() {

    // Find the left sidebar wrapper container holding your view
    const leftSidebar = this.areas.containerEl.closest('.mod-left-split');

    if (leftSidebar) {
      // Track if an animation frame is already waiting to render
      let isFrameScheduled = false;

      const styleObserver = new MutationObserver((mutations) => {
        for (let mutation of mutations) {
          if (mutation.attributeName === 'style') {
            // Only schedule a redraw if one isn't already queued for the next frame
            if (!isFrameScheduled) {
              isFrameScheduled = true;

              requestAnimationFrame(() => {
                this.redrawMyContainer();
                
                // Reset the flag after the redraw finishes so the next frame can queue up
                isFrameScheduled = false;
              });
            }
            // Break the loop early since we already handled this mutation batch
            break; 
          }
        }
      });

      styleObserver.observe(leftSidebar, {
          attributes: true,
          attributeFilter: ['style']
      });

      this.register(() => styleObserver.disconnect());
    } else {
      // Fallback: If not inside the standard left split, fall back to ResizeObserver
      //this.fallbackResizeObserver();
    }
  }

  fallbackResizeObserver() {
    // 1. Listen for mousedown on the workspace layout container
    // Using event delegation captures clicks on any existing or future splitters
    this.registerDomEvent(document.body, 'pointerdown', (event: PointerEvent) => {
      const target = event.target as HTMLElement;
      if (!target) return;

      // Use .closest() to match the splitter or any of its nested inner elements
      const splitter = target.closest('.workspace-splitter, .workspace-ribbon-splitter');

      if (splitter) {
        console.log('Splitter successfully caught via trackpad or mouse!', splitter);
        this.startDragTracking();
      }
    }, true); // Keep the capture phase (true) to ensure you intercept it first
  }

  startDragTracking() {
    let isDragging = true;
    let animationFrameId: number;

    // 2. Define the redraw loop synchronized with the screen refresh rate
    const updateLoop = () => {
      if (!isDragging) return;

      // --- EXECUTE YOUR REDRAW / RESIZE CODE HERE ---
      this.redrawMyContainer();

      // Continue the loop on the next frame
      animationFrameId = requestAnimationFrame(updateLoop);
    };

    // Start the loop
    animationFrameId = requestAnimationFrame(updateLoop);

    // 3. Define the cleanup mechanism when the mouse is released
    const stopDragTracking = () => {
      isDragging = false;
      cancelAnimationFrame(animationFrameId);

      // Clean up window listeners immediately
      window.removeEventListener('mouseup', stopDragTracking);
      
      // Final redraw to ensure pixel-perfect placement at rest
      this.updateHub('workspaceResized');
    };

    // Attach global mouseup to catch the release even if the mouse leaves the splitter
    window.addEventListener('mouseup', stopDragTracking);
  }

  redrawMyContainer() {
    this.areas.draw.allConnects();
  }
  
}
