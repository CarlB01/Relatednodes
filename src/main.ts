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
      id: 'open-view',
      name: 'Open view',
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
        window.setTimeout(() => {
          this.app.workspace.getLeavesOfType(RV.MYBRAIN_VIEW_TYPE).forEach(leaf => {
            if (leaf.view instanceof MyBrainView) {
              const myView = leaf.view;
              
              // ==========================================================================
              // 🛡️ THE RENAME FILE-OPEN SHIELD (Kveler gjenferds-blinket på sekund 0!):
              // If our secure renaming shield is currently deployed on the active view layout,
              // we forcefully abort this thread to block unstable layout pops during names mutating [dan]!
              // ==========================================================================
              if (myView.isRenamingShield) return;
              
              void myView.onFileChange(file);
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

        // ==========================================================================
        // COMPLIANT RENAME EXECUTION CONVOLUT:
        // Prefixed with the explicit 'void' operator to satisfy Obsidian's floating promises guard.
        // Converted the loop to a strict 'for...of' structure to properly wait for inner update calls.
        // ==========================================================================
        void (async () => {
          const leaves = this.app.workspace.getLeavesOfType(RV.MYBRAIN_VIEW_TYPE);

          for (const leaf of leaves) {
            if (leaf.view instanceof MyBrainView) {
              const myView = leaf.view;
              if (!myView.isFullyStarted) continue;

              // ===== FIX #1: Safe property access instead of unsafe casting =====
              // Directly access the public property without type casting
              const wasCurrentlyVisibleFileRenamed = oldPath === myView.currentFilePath;
              if (wasCurrentlyVisibleFileRenamed) {
                // ==========================================================================
                // 🛡️ THE RENAME SHIELD ACTIVATION (Låser dørvakta på sekund 0):
                // We arm the renaming shield parameter right here to force the global file-open
                // interceptor (Section A) to stand down and ignore core layout vibrations [dan]!
                // ==========================================================================
                myView.isRenamingShield = true;
                
                // ===== FIX #1: Safe property assignment instead of unsafe casting =====
                // Directly assign to the public property
                myView.currentFilePath = file.path;
                
                const internalCacheBus = this.app.metadataCache;
                
                const onCacheResolvedOnce = () => {
                  
                  // ==========================================================================
                  // ⏳ THE RE-INDEXING CUSHION (Gir Obsidian tid til å oppdatere lenkene!):
                  // Obsidian needs a few milliseconds to update the text inside the other files 
                  // and push them into resolvedLinks. A 400ms timeout provides the exact breathing 
                  // room needed for the global links database to fully mature prior to drawing [dan]!
                  // ==========================================================================
                  if (myView.renameDebounceTimer) {
                    window.clearTimeout(myView.renameDebounceTimer);
                  }

                  myView.renameDebounceTimer = window.setTimeout(() => {
                    void (async () => {
                      
                      // Flush old internal caches so the core reads the brand new backlinks layout
                      if (this.networkGraph && this.networkGraph.noteCache) {
                        this.networkGraph.noteCache.delete(file.path);
                      }
                      
                      const freshFileInstance = this.app.vault.getAbstractFileByPath(file.path);
                      
                      if (freshFileInstance instanceof TFile && this.networkGraph) {
                        await this.networkGraph.update(freshFileInstance); 
                      }
                      
                      if (myView.areaManager) {
                        myView.areaManager.renderGraph(); // Spretter opp rent, uovervinnelig og vakkert! [dan]
                      }
                      
                      // Drop the execution shield precisely after the true updated graph matrix has mounted [dan]
                      myView.isRenamingShield = false;
                    })();
                  }, 400); // 400ms is imperceptible but completely eliminates index race conditions [dan]
                  
                  internalCacheBus.off('resolved', onCacheResolvedOnce);
                };

                internalCacheBus.on('resolved', onCacheResolvedOnce);
              }
            }
          }
        })(); 
      })
    );

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

              // If the layout shield is active during a rename pass, drop background resolution cycles cleanly [dan]
              if (myView.isRenamingShield) return;

              // ===== FIX #1: Safe property access instead of unsafe casting =====
              // Directly access the public property without type casting
              const isEditingCurrentlyVisibleFile = file.path === myView.currentFilePath;

              if (isEditingCurrentlyVisibleFile || dataWasUpdated) {
                
                if (myView.resolveDebounceTimer) {
                  window.clearTimeout(myView.resolveDebounceTimer);
                }
                
                myView.resolveDebounceTimer = window.setTimeout(() => {
                  void (async () => {
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
   * COMPLIANT REFACTOR: Prefixes unawaited workspace activation promises with the native void operator [dan].
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
      // ==========================================================================
      // COMPLIANT REFACTOR: Prefixed with 'void' to satisfy the strict floating promises
      // linting criteria since revealLeaf return signatures operate asynchronously [dan]!
      // ==========================================================================
      void workspace.revealLeaf(leaf);
      return;
    }

    // 3. MOUNT NEW PANEL: Instantiates a fresh leaf container inside the left sidebar split
    let newLeaf: WorkspaceLeaf | null | undefined = workspace.getLeftLeaf(false);

    if (newLeaf) {
      await newLeaf.setViewState({
        type: RV.MYBRAIN_VIEW_TYPE,
        active: true, 
      });
      
      // Symmetrical void-guard prefix deployed on the newly generated leaf element [dan]
      void workspace.revealLeaf(newLeaf);
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
