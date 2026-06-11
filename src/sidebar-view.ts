import { App, ItemView, WorkspaceLeaf } from 'obsidian';

export const VIEW_TYPE_RELATED_SIDEBAR_PANEL = 'related-sidebar-view';

export class SidebarView extends ItemView {
    constructor(leaf: WorkspaceLeaf, app: App) {
        super(leaf);
        this.app = app;
    }

    getViewType() {
        return VIEW_TYPE_RELATED_SIDEBAR_PANEL;
    }

    getDisplayText() {
      return "Related nodes panel";
    }

    async onOpen() {
      /*
      const container = this.containerEl.children[1];
        if (container) {
          container.empty();
          const baseFile = this.app.vault.getAbstractFileByPath('bases/minBrain.base');
          if (baseFile instanceof TFile) {
            // Using internal API/Bases view mechanism to render the base
            // Note: Exact instantiation depends on internal API, 
            // usually involves registering a base-view pane.
            const content = await this.app.vault.read(baseFile);
            this.leaf.setViewState({
              type: 'bases',
              state: {
                  file: baseFile,
              },
            });
            container.createEl('h3', { text: 'Relatednodes Loading...' });            
            // Typical approach to embedding in container
            this.leaf.openFile(baseFile);
        
            //this.app.workspace.openLinkText(baseFile.path, "", false);
          } else {
            
            container.createEl('h3', { text: 'bases/minBrain.base not found' });            
          }
        };
        */
    }

    async onClose() {
        // Cleanup when the view is closed
    }
}