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
      void this.activateGraphView();
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
   * COMPLIANT REFACTOR: Removes 'async' from core event signatures to fulfill strict void criteria.
   * Leverages immediately invoked asynchronous execution envelopes to isolate data mutations safely [dan].
   */
  private registerGlobalEvents() {
    // ------------------------------------------------------------------------
    // A. FILE OPEN INTERCEPTOR
    // ------------------------------------------------------------------------
    this.registerEvent(
      this.app.workspace.on('file-open', (file: TFile | null) => {
        if (!file) return;
        
        // Micro-timeout accommodating mobile touch-screen navigation animation sequences safely
        setTimeout(() => {
          this.app.workspace.getLeavesOfType(RV.MYBRAIN_VIEW_TYPE).forEach(leaf => {
            if (leaf.view instanceof MyBrainView) {
              void leaf.view.onFileChange(file);
            }
          });
        }, 70); 
      })
    );

    // ------------------------------------------------------------------------
    // B. VAULT RENAME INTERCEPTOR
    // ------------------------------------------------------------------------
    this.registerEvent(
      this.app.vault.on('rename', (file: TAbstractFile, oldPath: string) => {
        if (!(file instanceof TFile)) return;
        
        // Immediate database cache purge to kill stale filename text-strings in memory slots
        if (this.networkGraph && this.networkGraph.noteCache) {
          this.networkGraph.noteCache.delete(oldPath);
          this.networkGraph.noteCache.delete(file.path);
        }

        // Execute background database memory path mapping updates safely
        this.networkGraph.handleFileRename(file, oldPath);

        this.app.workspace.getLeavesOfType(RV.MYBRAIN_VIEW_TYPE).forEach((leaf) => {
          if (leaf.view instanceof MyBrainView) {
            const myView = leaf.view;
            if (!myView.isFullyStarted) return;

            const wasCurrentlyVisibleFileRenamed = oldPath === (myView as any).currentFilePath;

            if (wasCurrentlyVisibleFileRenamed) {
              // ==========================================================================
              // COMPLIANT ENVELOPE INJECTION: Dispatches the asynchronous data reload pass
              // inside a safe, decoupled thread execution block to pass core linter audits [dan].
              // ==========================================================================
              (async () => {
                (myView as any).currentFilePath = file.path;
                await this.networkGraph.update(file);
                
                if (myView.areaManager) {
                  myView.areaManager.renderGraph(); 
                }
              })();
            }
          }
        });
      })
    );

    // ==========================================================================
    // METADATA RESOLUTION EVENT ROUTING (Interceptor Pipeline)
    // ==========================================================================

        // ==========================================================================
    // METADATA RESOLUTION EVENT ROUTING (Interceptor Pipeline)
    // ==========================================================================

    // C. Intercepts metadata resolution flags when a note finishes background parsing updates
    this.registerEvent(
      this.app.metadataCache.on('resolve', (file: TFile) => {
        // Asynchronously resolves metadata data models mapping localized token keys
        void this.networkGraph.handleFileResolve(file).then((dataWasUpdated) => {
          
          this.app.workspace.getLeavesOfType(RV.MYBRAIN_VIEW_TYPE).forEach((leaf) => {
            if (leaf.view instanceof MyBrainView) {
              const myView = leaf.view;
              if (!myView.isFullyStarted) return; 

              const isEditingCurrentlyVisibleFile = file.path === (myView as any).currentFilePath;

              if (isEditingCurrentlyVisibleFile || dataWasUpdated) {
                
                if (myView.resolveDebounceTimer) {
                  window.clearTimeout(myView.resolveDebounceTimer);
                }
                
                myView.resolveDebounceTimer = setTimeout(() => {
                  (async () => {
                    // Kirurgisk re-indeksering av den aktive filen for å hente ut det nye aliaset
                    if (isEditingCurrentlyVisibleFile && this.networkGraph && this.networkGraph.noteCache) {
                      this.networkGraph.noteCache.delete(file.path);
                    }
                    
                    await this.networkGraph.update(file);
                    
                    if (myView.areaManager) {
                      myView.areaManager.renderGraph(); // Tegner grafen med det flunkende nye aliaset! [dan]
                    }
                  })();
                }, 300); // 300ms buffer keeps the interface 100% stable while you type [dan]
              }

            }
          });
        });
      })
    );

  }


  /**
   * Activates the custom panel inside the primary viewport framework.
   * Safeguards against initialization race conditions and prevents duplicated leaves.
   * COMPLIANT REFACTOR: Prefixes unawaited promises with the native void operator [dan].
   */
  async activateGraphView() {
    // 1. TIMING SAFEGUARD: Defers activation if the core cache is still indexing on cold start
    const isCacheReady = (this.app.metadataCache as typeof this.app.metadataCache & { initialized?: boolean }).initialized;
    if (!isCacheReady) {
      if (!this.resolvedEventRef) {
        this.resolvedEventRef = this.app.metadataCache.on('resolved', () => {
          void this.activateGraphView();
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
          void newLeaf.view.onFileChange(activeFile);
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
