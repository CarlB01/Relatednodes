import { Plugin, Notice, WorkspaceLeaf, EventRef, TFile, TAbstractFile } from 'obsidian';
import { SettingTab } from "./SettingTab.js";
import { RelatednotesView } from './view.js';
import { RV } from './constants.js';
import { NetworkGraph } from './NetworkGraph.js';
import { SettingsManager } from './SettingsManager.js';

export default class RelatednotesPlugin extends Plugin {
  declare settings: SettingsManager;
  public relatedData!: NetworkGraph;
  
  private resolvedEventRef: EventRef | undefined;
  
  async onload() {
    await this.loadSettings();

    this.relatedData = new NetworkGraph(this, this.settings);

    this.addSettingTab(new SettingTab(this.app, this));
  
    // Registers the plugin view architecture allowing it to open as a sidebar or main tab
    this.registerView(
      RV.RELATED_NOTES_VIEW_TYPE,
      (leaf) => new RelatednotesView(leaf, this)
    );

    // Binds all global application listeners natively (file-open, rename, resolve)
    this.registerGlobalEvents();

    // Ribbon icon to trigger view activation
    this.addRibbonIcon("apple", "Open Related Notes", () => {
      this.activateRelatedNotesView();
    });

    // Native command palette registration
    this.addCommand({
      id: 'open-related-notes',
      name: 'Open Related Notes View',
      callback: () => this.activateRelatedNotesView(),
    });    
  }

  /**
   * Binds global application lifecycle events to synchronize memory caches with vault mutations.
   */
  private registerGlobalEvents() {
    // A. Intercepts note navigation events to synchronize the layout state centrally
    this.registerEvent(
      this.app.workspace.on('file-open', async (file: TFile | null) => {
        if (!file) return;
        // ==========================================================================
        // MOBILE LIFECYCLE SAFEGUARD: 
        // Introduces a micro-timeout loop (70ms) to accommodate iOS animation physics.
        // Guarantees the mobile Quick Switcher view has fully closed and unmounted 
        // before routing the fresh file stream down to the data calculation core [dan]!
        // ==========================================================================
        setTimeout(() => {
          this.app.workspace.getLeavesOfType(RV.RELATED_NOTES_VIEW_TYPE).forEach(leaf => {
            if (leaf.view instanceof RelatednotesView) {
              leaf.view.onFileChange(file);
            }
          });
        }, 70); // 70ms is invisible on desktop but ensures rock-solid execution on iOS/Android [dan]
      })
    );

    // B. Intercepts vault rename events to update internal key structures
    this.registerEvent(
      this.app.vault.on('rename', async (file: TAbstractFile, oldPath: string) => {
        if (!(file instanceof TFile)) return;
        this.relatedData.handleFileRename(file, oldPath);
      })
    );

    // ==========================================================================
    // METADATA RESOLUTION EVENT ROUTING (Interceptor Pipeline)
    // ==========================================================================

    // C. Intercepts metadata resolution flags when a note finishes background parsing updates
    this.registerEvent(
      this.app.metadataCache.on('resolve', async (file: TFile) => {
        const dataWasUpdated = await this.relatedData.handleFileResolve(file);
        
        if (dataWasUpdated) {
          this.app.workspace.getLeavesOfType(RV.RELATED_NOTES_VIEW_TYPE).forEach(leaf => {
            if (leaf.view instanceof RelatednotesView) {
              const myView = leaf.view;

              // Immediate operational guard blocking rendering loops during active cold-start periods
              if (!myView.isFullyStarted) return; 

              if (myView.resolveDebounceTimer) {
                clearTimeout(myView.resolveDebounceTimer);
              }
              
              // High-speed runtime cooldown provides near-instantaneous live layout updates as the user typing
              myView.resolveDebounceTimer = setTimeout(() => {
                if (myView.areaManager) {
                  myView.areaManager.renderGraph(); 
                }
              }, 250); 
            }
          });
        }
      })
    );
  }

  /**
   * Activates the custom panel inside the primary viewport framework.
   * Safeguards against initialization race conditions and prevents duplicated leaves.
   */
  async activateRelatedNotesView() {
    // 1. TIMING SAFEGUARD: Defers activation if the core cache is still indexing on cold start
		const isCacheReady = (this.app.metadataCache as typeof this.app.metadataCache & { initialized?: boolean }).initialized;
    if (!isCacheReady) {
      if (!this.resolvedEventRef) {
        this.resolvedEventRef = this.app.metadataCache.on('resolved', () => {
          this.activateRelatedNotesView();
          this.unregisterResolvedEvent(); 
        });
        this.registerEvent(this.resolvedEventRef);
      }
      return; 
    }

    const { workspace } = this.app;
    
    // 2. DUPLICATE SAFEGUARD: Avoids redundant tabs by checking for existing active leaves
    let leaf = workspace.getLeavesOfType(RV.RELATED_NOTES_VIEW_TYPE)[0];
    
    if (leaf) {
      workspace.revealLeaf(leaf);
      return;
    }

    // 3. MOUNT NEW PANEL: Instantiates a fresh leaf container inside the left sidebar split
    let newLeaf: WorkspaceLeaf | null | undefined = workspace.getLeftLeaf(false);

    if (newLeaf) {
      await newLeaf.setViewState({
        type: RV.RELATED_NOTES_VIEW_TYPE,
        active: true,
      });
      
      workspace.revealLeaf(newLeaf);
      workspace.leftSplit?.expand(); // Vertically expands the sidebar partition width

      // INITIAL CONTEXT INJECTION: Feeds the newly instantiated leaf with the current active file
      const activeFile = this.app.workspace.getActiveFile();
      if (activeFile) {
        if (newLeaf.view instanceof RelatednotesView) {
          newLeaf.view.onFileChange(activeFile);
        }
      }
    } else {
      new Notice("Could not create view leaf");
    }
  }
  
  onunload() {
    this.unregisterResolvedEvent();
  }

  /**
   * Safe clean-up mechanism removing listeners to prevent reference leaks.
   */
  private unregisterResolvedEvent() {
    if (this.resolvedEventRef) {
      this.app.metadataCache.offref(this.resolvedEventRef);
      this.resolvedEventRef = undefined; 
    }
  }

  /**
   * Initializes settings manager defaults and hydrates instances with disk state records.
   */
  async loadSettings() {
    this.settings = new SettingsManager();
    
    const loadedData = await this.loadData();
    
    Object.assign(this.settings, loadedData);
    
    this.settings.prepare();
  }

  async saveSettings() {
    this.settings.prepare();
    await this.saveData(this.settings);
  }
}
