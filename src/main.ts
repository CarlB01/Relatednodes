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
  private appPaused = false;
  private resumedAt = 0;
  private resumeInFlight = false;
  private mobileWarmupUntil = 0;

  private crashTrace: {
    bootCount: number;
    lastBootAt: number;
    lastSuspendAt: number;
    lastResumeAt: number;
    lastOnFileChangeAt: number;
    lastCenterPath: string;
    lastEvent: string;
  } = {
    bootCount: 0,
    lastBootAt: 0,
    lastSuspendAt: 0,
    lastResumeAt: 0,
    lastOnFileChangeAt: 0,
    lastCenterPath: "",
    lastEvent: "init"
  };

  private persistTimer: number | null = null;


  public isAppPaused(): boolean {
    return this.appPaused;
  }

  public isInResumeCooldown(ms = 1200): boolean {
    return Date.now() - this.resumedAt < ms;
  }

  public markResumedNow() {
    this.resumedAt = Date.now();
    this.mobileWarmupUntil = this.resumedAt + 2000; // 1.5s warmup gate after resume
  }

  private queueCrashTracePersist() {
    if (this.persistTimer) window.clearTimeout(this.persistTimer);
    this.persistTimer = window.setTimeout(() => {
      void this.saveData({
        ...(this.settings as unknown as Record<string, unknown>),
        __crashTrace: this.crashTrace
      });
    }, 120);
  }

  public markCrashEvent(event: string, centerPath?: string) {
    this.crashTrace.lastEvent = event;
    if (centerPath !== undefined) this.crashTrace.lastCenterPath = centerPath;
    this.queueCrashTracePersist();
  }
  public markOnFileChangeAt(ts: number) {
    this.crashTrace.lastOnFileChangeAt = ts;
    this.queueCrashTracePersist();
  }

  public isInMobileWarmup(): boolean {
    return Date.now() < this.mobileWarmupUntil;
  }

  async onload() {
    await this.loadSettings();
    this.crashTrace.bootCount += 1;
    this.crashTrace.lastBootAt = Date.now();
    this.crashTrace.lastEvent = "onload";
    this.queueCrashTracePersist();

    this.networkGraph = new NetworkGraph(this, this.settings);

    this.addSettingTab(new SettingTab(this.app, this));
  
    // Registers the plugin view architecture allowing it to open as a sidebar or main tab
    this.registerView(
      RV.MYBRAIN_VIEW_TYPE,
      (leaf) => new MyBrainView(leaf, this)
    );

    // Binds all global application listeners natively (file-open, rename, resolve)
    this.registerGlobalEvents();
    this.registerAppLifecycleEvents();

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
        if (this.appPaused) return;
        if (!file) return;

        this.app.workspace.getLeavesOfType(RV.MYBRAIN_VIEW_TYPE).forEach(leaf => {
          if (leaf.view instanceof MyBrainView) {
            const myView = leaf.view;
            if (myView.isRenamingShield) return;
            void myView.onFileChange(file);
          }
        });
      })
    );

    // ------------------------------------------------------------------------
    // B. VAULT RENAME INTERCEPTOR
    // ------------------------------------------------------------------------
    this.registerEvent(
      this.app.vault.on('rename', (file: TAbstractFile, oldPath: string) => {
        if (this.appPaused) return;
        if (!(file instanceof TFile)) return;

        // Immediate database cache purge to kill stale filename text-strings in memory slots
        if (this.networkGraph && this.networkGraph.noteCache) {
          this.networkGraph.noteCache.delete(oldPath);
          this.networkGraph.noteCache.delete(file.path);
        }

        // Execute background database memory path mapping updates safely
        this.networkGraph.handleFileRename(file, oldPath);

        void (async () => {
          const leaves = this.app.workspace.getLeavesOfType(RV.MYBRAIN_VIEW_TYPE);

          for (const leaf of leaves) {
            if (leaf.view instanceof MyBrainView) {
              const myView = leaf.view;
              if (!myView.isFullyStarted) continue;

              const wasCurrentlyVisibleFileRenamed = oldPath === myView.currentFilePath;
              if (wasCurrentlyVisibleFileRenamed) {
                myView.isRenamingShield = true;
                myView.currentFilePath = file.path;

                const internalCacheBus = this.app.metadataCache;

                const onCacheResolvedOnce = () => {
                  if (myView.renameDebounceTimer) window.clearTimeout(myView.renameDebounceTimer);

                  myView.renameDebounceTimer = window.setTimeout(() => {
                    window.requestAnimationFrame(() => {
                      void (async () => {
                        if (this.appPaused) return;

                        if (this.networkGraph?.noteCache) {
                          this.networkGraph.noteCache.delete(file.path);
                        }

                        const freshFileInstance = this.app.vault.getAbstractFileByPath(file.path);
                        const activeNow = this.app.workspace.getActiveFile();
                        if (!activeNow || activeNow.path !== file.path) {
                          myView.isRenamingShield = false;
                          return;
                        }

                        if (freshFileInstance instanceof TFile && this.networkGraph) {
                          await this.networkGraph.update(freshFileInstance);
                        }

                        myView.areaManager?.renderGraph();
                        myView.isRenamingShield = false;
                      })();
                    });
                  }, 0);

                  internalCacheBus.off('resolved', onCacheResolvedOnce);
                };

                internalCacheBus.on('resolved', onCacheResolvedOnce);
              }
            }
          }
        })();
      })
    );

    // ------------------------------------------------------------------------
    // C. METADATA RESOLVE INTERCEPTOR
    // ------------------------------------------------------------------------
    this.registerEvent(
      this.app.metadataCache.on('resolve', (file: TFile) => {
        if (this.appPaused) return;
        if (this.isInResumeCooldown(1200)) return;
        if (this.isInMobileWarmup()) return;


        void this.networkGraph.handleFileResolve(file).then((_dataWasUpdated) => {
          this.app.workspace.getLeavesOfType(RV.MYBRAIN_VIEW_TYPE).forEach((leaf) => {
            if (leaf.view instanceof MyBrainView) {
              const myView = leaf.view;
              if (!myView.isFullyStarted) return;
              if (myView.isRenamingShield) return;

              const isEditingCurrentlyVisibleFile = file.path === myView.currentFilePath;

              if (isEditingCurrentlyVisibleFile) {
                if (myView.resolveDebounceTimer) {
                  window.clearTimeout(myView.resolveDebounceTimer);
                }

                myView.resolveDebounceTimer = window.setTimeout(() => {
                  void (async () => {
                    if (isEditingCurrentlyVisibleFile && this.networkGraph?.noteCache) {
                      this.networkGraph.noteCache.delete(file.path);
                    }

                    const activeNow = this.app.workspace.getActiveFile();
                    if (!activeNow) return;
                    if (activeNow.path !== myView.currentFilePath) return;

                    await this.networkGraph.update(activeNow);
                    myView.areaManager?.renderGraph();
                  })();
                }, 300);
              }
            }
          });
        });
      })
    );
  }

  // Only document visibility + Obsidian views
  private registerAppLifecycleEvents() {
    const suspendAllViews = () => {
      this.crashTrace.lastSuspendAt = Date.now();
      this.markCrashEvent("suspendAllViews", this.networkGraph?.centerNote?.path ?? "");
      this.appPaused = true;
      this.app.workspace.getLeavesOfType(RV.MYBRAIN_VIEW_TYPE).forEach(leaf => {
        if (leaf.view instanceof MyBrainView) {
          leaf.view.suspendForBackground();
        }
      });
    };

    const resumeAllViews = () => {
      if (this.resumeInFlight) return;
      this.resumeInFlight = true;
      this.appPaused = false;
      this.resumedAt = Date.now();
      this.crashTrace.lastResumeAt = this.resumedAt;
      this.markCrashEvent("resumeAllViews", this.networkGraph?.centerNote?.path ?? "");
      this.markResumedNow();

      this.app.workspace.getLeavesOfType(RV.MYBRAIN_VIEW_TYPE).forEach(leaf => {
        if (leaf.view instanceof MyBrainView) {
          leaf.view.resumeFromBackground();
        }
      });
      window.setTimeout(() => { this.resumeInFlight = false; }, 300);
    };

    this.registerDomEvent(document, 'visibilitychange', () => {
      if (document.hidden) suspendAllViews();
      else resumeAllViews();
    });

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
    this.markCrashEvent("onunload", this.networkGraph?.centerNote?.path ?? "");

    this.appPaused = true;
    this.app.workspace.getLeavesOfType(RV.MYBRAIN_VIEW_TYPE).forEach(leaf => {
      if (leaf.view instanceof MyBrainView) {
        leaf.view.suspendForBackground();
      }
    });
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
    
    // ===== FIX #3: Type the loaded data safely =====
    // Cast the loaded data as a partial SettingsManager to ensure type safety
    const loadedData = await this.loadData() as Partial<SettingsManager> | null;
    
    if (loadedData) {
      Object.assign(this.settings, loadedData);
    }
    
    this.settings.prepare();
    type CrashTrace = {
      bootCount: number;
      lastBootAt: number;
      lastSuspendAt: number;
      lastResumeAt: number;
      lastOnFileChangeAt: number;
      lastCenterPath: string;
      lastEvent: string;
    };

    type LoadedWithCrashTrace = Partial<SettingsManager> & {
      __crashTrace?: Partial<CrashTrace>;
    };

    const raw = loadedData as LoadedWithCrashTrace | null;
    if (raw?.__crashTrace) {
      this.crashTrace = {
        ...this.crashTrace,
        ...raw.__crashTrace,
      };
    }
  }

  async saveSettings() {
    this.settings.prepare();
    await this.saveData({
      ...(this.settings as unknown as Record<string, unknown>),
      __crashTrace: this.crashTrace
    });
  }
}
