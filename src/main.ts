import { Plugin, Notice, WorkspaceLeaf } from 'obsidian';
import { DEFAULT_SETTINGS, MyPluginSettings, SampleSettingTab } from "./settings.js";
import { RelatednotesView } from './view.js';
import { SidebarView, VIEW_TYPE_RELATED_SIDEBAR_PANEL } from "./sidebar-view.js";

export const RELATED_NOTES_VIEW_TYPE = 'relatednotes-view';

export const relatednodesID = 'relatednotesViewType';
export const superChargedLinkAttribs = 'internal-link data-link-icon data-link-icon-after data-link-text';

export default class RelatednotesPlugin extends Plugin {

	declare settings: MyPluginSettings;
	
	async onload() {
		
		await this.loadSettings();
		this.addSettingTab(new SampleSettingTab(this.app, this));
	
		// Register the sidebar/container view
		this.registerView(
			VIEW_TYPE_RELATED_SIDEBAR_PANEL,
			(leaf) => new SidebarView(leaf, this.app)
		);

		// Register your main related notes view (the one that receives parentEl)
		this.registerView(
			RELATED_NOTES_VIEW_TYPE,
			(leaf) => new RelatednotesView(leaf, this)   // ← pass plugin if needed
		);

		// Ribbon icon to open your view
		this.addRibbonIcon("apple", "Open Related Notes", () => {
			this.activateRelatedNotesView();
		});

		// Optional: Add a command
		this.addCommand({
			id: 'open-related-notes',
			name: 'Open Related Notes View',
			callback: () => this.activateRelatedNotesView(),
		});		
	};

	async activateRelatedNotesView() {
    const { workspace } = this.app;
    
    // Check if the view already exists
    let leaf = workspace.getLeavesOfType(RELATED_NOTES_VIEW_TYPE)[0];
    
    if (leaf) {
        workspace.revealLeaf(leaf);
        return;
    }

    let newLeaf: WorkspaceLeaf | null | undefined = workspace.getLeftLeaf(false);

    if (newLeaf) {
        await newLeaf.setViewState({
            type: RELATED_NOTES_VIEW_TYPE,
            active: true,
        });
        
        workspace.revealLeaf(newLeaf);
        workspace.leftSplit?.expand();
    } else {
        new Notice("Could not create view leaf");
    }
}
	
	onunload() {
	}

	async loadSettings() {
		const loadedData = await this.loadData();
		this.settings = Object.assign({}, DEFAULT_SETTINGS, loadedData);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}