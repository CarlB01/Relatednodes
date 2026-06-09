import { 
    BasesView,
    QueryController,
    HoverPopover,
    TFile,
    WorkspaceLeaf,
    HoverParent,
    MarkdownView,
    WorkspaceSplit,
    FileView,
} from 'obsidian';

import { RelatedData} from './data.js';
import RelatednotesPlugin, { relatednodesID } from './main.js';
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

export class RelatednotesView extends BasesView implements HoverParent {
  readonly type = relatednodesID;
  private readonly displayWelcomeText = 'to view related notes, please open one of your notes first';
  private readonly groupDivInfo = 'related-group';
  private readonly linkDescr = 'related-link';
      
  private related: RelatedData;
  private linksHandler: LinksHandler;
  private areas: Areas;

  hoverPopover: HoverPopover | null = null;
  
  constructor(
    controller: QueryController, 
    parentEl: HTMLElement,
    public plugin: RelatednotesPlugin,
  ) {
    super(controller);

    // hide bases toolbar for relatednotes in particular
    this.displayBasesToolbar(parentEl, plugin.settings.displayBasesToolbar);
    
    // handling of links
    this.linksHandler = new LinksHandler(plugin,
      (internalLink: string) => this.onInternalLinkClicked(internalLink)
    );

    // handling of data
    this.related = new RelatedData(this.app, this.plugin,
      (message) => this.updateHub(message)
    );

    // handling of areas - 'parent', 'child', 'friend', 'sibling' 
    this.areas = new Areas(this.related, this.linksHandler, parentEl, plugin);
  }
  
  onload(): void {

    this.app.workspace.onLayoutReady(async () => {
      // set up workspace resize monitors
      this.registerWorkspaceChanges();
      this.setupSplitterTracking()
      this.plugin.registerHoverLinkSource(relatednodesID, {
        display: 'My custom Hover', // Name shown in Page Preview settings
        defaultMod: false,          // or true if you want Ctrl/Cmd required
      });

      this.displayWelcome();
      let f = null;
      let l = null;
      [f,l] = this.revealSomeLeafAndFile()
      this.updateHub('activeLeafChanged', l);
    });
  }

  onunload() {
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
  private async updateHub(caller: updateMessage, item?: any | null) {
    
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
        const leaf = item instanceof WorkspaceLeaf ? item : null;
        if (leaf && !this.activeSelf(leaf)) {
          const file = (leaf.view as MarkdownView).file;
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
    const element = leaf.containerEl.querySelector(`.${this.areas.containerDescr}`);
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

  private displayBasesToolbar(parentEl: HTMLElement, displayHeader: boolean) {
    
    const basesHeader = parentEl.parentElement?.parentElement
      ?.getElementsByClassName("bases-header")[0]
    if (displayHeader) {
      basesHeader?.removeAttribute('bases-header-collapsible')
      basesHeader?.setAttribute("class", 'bases-header');
    } else {
      basesHeader?.setAttribute("class", 'bases-header-collapsible')
    }
      
  }

  private registerWorkspaceChanges() {

    // Register workspace resize
    this.registerEvent(this.app.workspace.on('resize', () => {
      this.updateHub('workspaceResized');
    }));

      
    // Method 1: Recommended - active-leaf-change
    this.registerEvent(
      this.app.workspace.on('active-leaf-change', async (leaf: WorkspaceLeaf | null) => {
        this.updateHub('activeLeafChanged', leaf);
      })
    );

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
	
  private revealSomeLeafAndFile(): [TFile | null, WorkspaceLeaf | null] {
    
    const mdLeaves2 = this.app.workspace.getLeavesOfType('markdown');
    
    const lastOpenFiles2 = this.app.workspace.getLastOpenFiles();
    for (const filePath of lastOpenFiles2) {
			console.log('filepath', filePath);
			for (const mdLeaf of mdLeaves2) {
				console.log('filename', (mdLeaf.view as MarkdownView).file?.name);
				const file = (mdLeaf.view as MarkdownView).file
				const filename = file?.name;
				if (filename == filePath) {
					this.app.workspace.revealLeaf(mdLeaf);
					return [file, mdLeaf]
				}
			}
		}
/*			
		
		
			const file = this.getFile(filePath);
      if (file) {
        const targetLeaf = this.findLeafWithFile(file);
        console.log('lastOpenFiles', (file.basename));
      }
    }
    


    const mdLeaves = this.app.workspace.getLeavesOfType('markdown');
    for (const mdLeaf of mdLeaves) {
      console.log('mdLeaves', mdLeaves.length)
      if (mdLeaf instanceof MarkdownView) {
        const activeFile = mdLeaf.file;
        console.log('mdLeaves', activeFile?.basename)
      }
    }
    for (const mdLeaf of mdLeaves) {
      if (mdLeaf instanceof MarkdownView &&  mdLeaf.file?.extension !='base') {
        const activeFile = mdLeaf.file;
        return [activeFile, mdLeaf];
      }
    }

    const lastOpenFiles = this.app.workspace.getLastOpenFiles();
    for (const filePath of lastOpenFiles) {
      if (!filePath.endsWith('.base')) {
        const file = this.getFile(filePath);
        if (file) {
          const targetLeaf = this.findLeafWithFile(file);
          return [this.getFile(filePath), targetLeaf];
        }
      }
    }    
*/
    return [null, null];
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
    // Your specific rendering logic (canvas update, SVG adjustments, calculations)
    console.log('redraw?')
    this.areas.draw.allConnects();
  }
  
  private isViewHidden(leaf: WorkspaceLeaf): boolean {
      if (!leaf?.view?.containerEl) return true;

      const container = leaf.view.containerEl;
      const rect = container.getBoundingClientRect();

      // Hidden if collapsed or zero-sized
      return rect.width < 5 || rect.height < 5;
  }

}
