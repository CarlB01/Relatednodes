import { Plugin, Notice, WorkspaceLeaf, EventRef, TFile, TAbstractFile } from 'obsidian';
import { SettingTab } from "./SettingTab.js";
import { MyBrainView } from './view.js';
import { RV } from './constants.js';
import { NetworkGraph } from './NetworkGraph.js';
import { SettingsManager } from './SettingsManager.js';

export default class MyBrainPlugin extends Plugin {
  declare settings: SettingsManager;
  public networkGraph!: NetworkGraph;
  
  private resolvedEventRef: EventRef | undefined;
  
  async onload() {
    await this.loadSettings();

    this.networkGraph = new NetworkGraph(this, this.settings);

    this.addSettingTab(new SettingTab(this.app, this));
  
    // Registers the plugin view architecture allowing it to open as a sidebar or main tab
    this.registerView(
      RV.MYBRAIN_VIEW_TYPE,
      (leaf) => new MyBrainView(leaf, this)
    );

    // Binds all global application listeners natively (file-open, rename, resolve)
    this.registerGlobalEvents();

    // Ribbon icon to trigger view activation
    this.addRibbonIcon(RV.ICON, "Open myBrain", () => {
      this.activateGraphView();
    });

    // Native command palette registration
    this.addCommand({
      id: 'open-mybrain',
      name: 'Open myBrain View',
      callback: () => this.activateGraphView(),
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
        
        // Micro-timeout accommodating mobile touch-screen navigation animation sequences safely
        setTimeout(() => {
          this.app.workspace.getLeavesOfType(RV.MYBRAIN_VIEW_TYPE).forEach(leaf => {
            if (leaf.view instanceof MyBrainView) {
              leaf.view.onFileChange(file);
            }
          });
        }, 70); // 70ms is invisible on desktop but ensures rock-solid execution on iOS/Android [dan]
      })
    );

        // ==========================================================================
    // CORE WORKSPACE MONITOR EVENTS (Vault Mutations Pipeline)
    // ==========================================================================

    // ==========================================================================
    // CORE WORKSPACE MONITOR EVENTS (Vault Mutations Pipeline)
    // ==========================================================================

    // B. Registers when the user renames an active file inside the vault
    this.registerEvent(
      this.app.vault.on('rename', async (file: TAbstractFile, oldPath: string) => {
        if (!(file instanceof TFile)) return;
        
        // ==========================================================================
        // FORCE CACHE PURGE (The Ultimate Rename Cache Cure):
        // Before updating memory paths, we must physically wipe the stale node object 
        // from the repository cache mapping array [dan]. This guarantees that the engine 
        // cannot recycle the old title string brent fast in memory [dan]!
        // ==========================================================================
        if (this.networkGraph && this.networkGraph.noteCache) {
          this.networkGraph.noteCache.delete(oldPath);
          this.networkGraph.noteCache.delete(file.path);
        }

        // Execute background database memory path mapping updates safely
        this.networkGraph.handleFileRename(file, oldPath);

        this.app.workspace.getLeavesOfType(RV.MYBRAIN_VIEW_TYPE).forEach(async (leaf) => {
          if (leaf.view instanceof MyBrainView) {
            const myView = leaf.view;

            if (!myView.isFullyStarted) return;

            // Verify if the renamed file matches the currently tracked layout pathway bounds
            const wasCurrentlyVisibleFileRenamed = oldPath === (myView as any).currentFilePath;

            if (wasCurrentlyVisibleFileRenamed) {
              // Commit the brand new absolute pathway down to the view controller slots
              (myView as any).currentFilePath = file.path;
              
              // Force the data core to build a completely fresh node with the new filename [dan]!
              await this.networkGraph.update(file);
              
              if (myView.areaManager) {
                myView.areaManager.renderGraph(); // Smashes the stale text title instantly
              }
            }
          }
        });
      })
    );

    // ==========================================================================
    // METADATA RESOLUTION EVENT ROUTING (Interceptor Pipeline)
    // ==========================================================================

    // C. Intercepts metadata resolution flags when a note finishes background parsing updates
    this.registerEvent(
      this.app.metadataCache.on('resolve', async (file: TFile) => {
        // Asynchronously resolves metadata data models mapping localized token keys
        const dataWasUpdated = await this.networkGraph.handleFileResolve(file);
        
        this.app.workspace.getLeavesOfType(RV.MYBRAIN_VIEW_TYPE).forEach(async (leaf) => {
          if (leaf.view instanceof MyBrainView) {
            const myView = leaf.view;

            // Strictly drop rendering sweeps while the cold-start shield is active
            if (!myView.isFullyStarted) return; 

            // Check if the metadata resolving right now belongs to the active center note
            const isEditingCurrentlyVisibleFile = file.path === (myView as any).currentFilePath;

            if (isEditingCurrentlyVisibleFile) {
              // ==========================================================================
              // METADATA CACHE PURGE (The Ultimate Alias & Frontmatter Cure):
              // Prior to reloading, we physically wipe the active node object from RAM [dan].
              // This forces the core factories to rebuild the node and parse the fresh 
              // frontmatter aliases array directly from Obsidian's database layers [dan]!
              // ==========================================================================
              if (this.networkGraph && this.networkGraph.noteCache) {
                this.networkGraph.noteCache.delete(file.path);
              }

              // Force the data core to build a completely fresh node with the new frontmatter aliases [dan]!
              await this.networkGraph.update(file);
              
              if (myView.areaManager) {
                myView.areaManager.renderGraph(); // Redraws the graph synchronously
              }
              return; 
            }

            // STANDARD RUNTIME COOLDOWN (For background notes changes)
            if (dataWasUpdated) {
              if (myView.resolveDebounceTimer) {
                clearTimeout(myView.resolveDebounceTimer);
              }
              
              myView.resolveDebounceTimer = setTimeout(() => {
                if (myView.areaManager) {
                  myView.areaManager.renderGraph(); 
                }
              }, 250);
            }
          }
        });
      })
    );
   
  }

  /**
   * Activates the custom panel inside the primary viewport framework.
   * Safeguards against initialization race conditions and prevents duplicated leaves.
   */
  async activateGraphView() {
    // 1. TIMING SAFEGUARD: Defers activation if the core cache is still indexing on cold start
		const isCacheReady = (this.app.metadataCache as typeof this.app.metadataCache & { initialized?: boolean }).initialized;
    if (!isCacheReady) {
      if (!this.resolvedEventRef) {
        this.resolvedEventRef = this.app.metadataCache.on('resolved', () => {
          this.activateGraphView();
          this.unregisterResolvedEvent(); 
        });
        this.registerEvent(this.resolvedEventRef);
      }
      return; 
    }

    const { workspace } = this.app;
    
    // 2. DUPLICATE SAFEGUARD: Avoids redundant tabs by checking for existing active leaves
    let leaf = workspace.getLeavesOfType(RV.MYBRAIN_VIEW_TYPE)[0];
    
    if (leaf) {
      workspace.revealLeaf(leaf);
      return;
    }

    // 3. MOUNT NEW PANEL: Instantiates a fresh leaf container inside the left sidebar split
    let newLeaf: WorkspaceLeaf | null | undefined = workspace.getLeftLeaf(false);

    if (newLeaf) {
      await newLeaf.setViewState({
        type: RV.MYBRAIN_VIEW_TYPE,
        active: true,
      });
      
      workspace.revealLeaf(newLeaf);
      workspace.leftSplit?.expand(); // Vertically expands the sidebar partition width

      // INITIAL CONTEXT INJECTION: Feeds the newly instantiated leaf with the current active file
      const activeFile = this.app.workspace.getActiveFile();
      if (activeFile) {
        if (newLeaf.view instanceof MyBrainView) {
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
