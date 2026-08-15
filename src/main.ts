import { Plugin, Notice, WorkspaceLeaf, EventRef, TFile, TAbstractFile } from 'obsidian';
import { SettingTab } from "./SettingTab.js";
import { MyBrainView } from './view.js';
import { RV } from './constants.js';
import { NetworkGraph } from './NetworkGraph.js';
import { SettingsManager } from './SettingsManager.js';

export default class MyBrainPlugin extends Plugin {
  declare settings: SettingsManager;
  public networkGraph!: NetworkGraph;
  
  private appPaused = false;
  private resumedAt = 0;
  private mobileWarmupUntil = 0;

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

  public isInMobileWarmup(): boolean {
    return Date.now() < this.mobileWarmupUntil;
  }

  /**
   * APPLIED LISTENERS: 
   * - registerGlobalEvents  ('file-open',  'rename', 'resolve')
   * - registerAppLifecycleEvents (const suspendAllViews, const resumeAllViews, 'visibilitychange'
   */
  async onload() {
    await this.loadSettings();
    this.networkGraph = new NetworkGraph(this, this.settings);

    this.addSettingTab(new SettingTab(this.app, this));
  
    // Registers the plugin view architecture allowing it to open as a sidebar or main tab
    this.registerView(
      RV.VIEW_TYPE,
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
   * Leverages the centralized, debounced NetworkGraph architecture to avoid complex view-state pooling.
   */
  private registerGlobalEvents() {
    // A. FILE OPEN INTERCEPTOR
    this.registerEvent(
      this.app.workspace.on('file-open', (file: TFile | null) => {
        if (this.appPaused || !file) return;

        this.app.workspace.getLeavesOfType(RV.VIEW_TYPE).forEach(leaf => {
          if (leaf.view instanceof MyBrainView) {
            // Direct synchronous trigger: networkGraph handles its own internal timing.
            leaf.view.onFileChange(file);
          }
        });
      })
    );

    // B. VAULT RENAME INTERCEPTOR
    this.registerEvent(
      this.app.vault.on('rename', (file: TAbstractFile, oldPath: string) => {
        if (this.appPaused || !(file instanceof TFile)) return;

        // 1. Immediate data layer cache purge to clear stale path strings
        if (this.networkGraph?.noteCache) {
          this.networkGraph.noteCache.delete(oldPath);
          this.networkGraph.noteCache.delete(file.path);
        }

        // 2. Execute background database memory path mapping updates.
        this.networkGraph.handleFileRename(file, oldPath);

        // 3. Update view tracking states and request a background graph recalculation
        const leaves = this.app.workspace.getLeavesOfType(RV.VIEW_TYPE);
        for (const leaf of leaves) {
          if (leaf.view instanceof MyBrainView) {
            const myView = leaf.view;
            if (!myView.isFullyStarted) continue;

            const wasCurrentlyVisibleFileRenamed = oldPath === myView.currentFilePath;
            if (wasCurrentlyVisibleFileRenamed) {
              myView.currentFilePath = file.path;
              this.networkGraph.update(file);
            }
          }
        }
      })
    );

    // C. METADATA RESOLVE INTERCEPTOR
    this.registerEvent(
      this.app.metadataCache.on('resolve', (file: TFile) => {
        if (this.appPaused || this.isInResumeCooldown(1200) || this.isInMobileWarmup()) return;

        void this.networkGraph.handleFileResolve(file).then((_dataWasUpdated) => {
          this.app.workspace.getLeavesOfType(RV.VIEW_TYPE).forEach((leaf) => {
            if (leaf.view instanceof MyBrainView) {
              const myView = leaf.view;
              if (!myView.isFullyStarted) return;
              
              const isEditingCurrentlyVisibleFile = file.path === myView.currentFilePath;
              if (isEditingCurrentlyVisibleFile) {

                /** Clear out memory cache mapping for the modified file instance */
                if (this.networkGraph?.noteCache) {
                  this.networkGraph.noteCache.delete(file.path);
                }

                const activeNow = this.app.workspace.getActiveFile();
                if (!activeNow || activeNow.path !== myView.currentFilePath) return;

                this.networkGraph.update(activeNow);
              }
            }
          });
        });
      })
    );
  }

  /**
   * Encapsulates application hardware suspend and visibility state transitions.
   */  
  private registerAppLifecycleEvents() {
    const suspendAllViews = () => {
      this.appPaused = true;
      this.app.workspace.getLeavesOfType(RV.VIEW_TYPE).forEach(leaf => {
        if (leaf.view instanceof MyBrainView) {
          leaf.view.suspendForBackground();
        }
      });
    };

    const resumeAllViews = () => {
      // 1. Sjekk om det er mindre enn 300ms siden forrige resume ved å bruke tidsstempel
      if (Date.now() - this.resumedAt < 300) return;
      
      this.appPaused = false;
      this.markResumedNow(); // Dette oppdaterer this.resumedAt til Date.now() med en gang!

      this.app.workspace.getLeavesOfType(RV.VIEW_TYPE).forEach(leaf => {
        if (leaf.view instanceof MyBrainView) {
          leaf.view.resumeFromBackground();
        }
      });
    };

    this.registerDomEvent(document, 'visibilitychange', () => {
      if (document.hidden) suspendAllViews();
      else resumeAllViews();
    });

  }

  /**
   * Activates the custom panel inside the primary viewport framework.
   * View lifecycle hooks will handle internal data ignition gracefully [dan].
   */
  async activateGraphView() {
    const { workspace } = this.app;
    
    // 1. DUPLICATE SAFEGUARD: Avoids redundant tabs
    let leaf = workspace.getLeavesOfType(RV.VIEW_TYPE)[0];
    if (leaf) {
      void workspace.revealLeaf(leaf);
      return;
    }

    // 2. MOUNT NEW PANEL: Instantiates a fresh leaf container inside the left sidebar split
    let newLeaf: WorkspaceLeaf | null | undefined = workspace.getLeftLeaf(false);

    if (newLeaf) {
      await newLeaf.setViewState({
        type: RV.VIEW_TYPE,
        active: true, 
      });
      
      // Symmetrical void-guard prefix deployed on the newly generated leaf element [dan]
      void workspace.revealLeaf(newLeaf);
      workspace.leftSplit?.expand(); // Vertically expands the sidebar partition width

      // Send files directly to the view. If cache is not ready, the view's own debouncedResolve handles it!
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
    this.appPaused = true;
    this.app.workspace.getLeavesOfType(RV.VIEW_TYPE).forEach(leaf => {
      if (leaf.view instanceof MyBrainView) {
        leaf.view.suspendForBackground();
      }
    });
    this.networkGraph.cancel(); 
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
  }
  
  async saveSettings() {
    this.settings.prepareForSave();
    await this.saveData(this.settings);
  }

}
