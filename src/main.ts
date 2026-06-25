import { Plugin, Notice, WorkspaceLeaf } from 'obsidian';
import { DEFAULT_SETTINGS, MyPluginSettings, SampleSettingTab } from "./settings.js";
import { RelatednotesView } from './view.js';
import { SidebarView, VIEW_TYPE_RELATED_SIDEBAR_PANEL } from "./sidebar-view.js";

export const RELATED_NOTES_VIEW_TYPE = 'relatednotes-view';

export const relatednodesID = 'relatednotesViewType';
export const superChargedLinkAttribs = 'internal-link data-link-icon data-link-icon-after data-link-text';

export default class RelatednotesPlugin extends Plugin {

	declare settings: MyPluginSettings;

	// Ferdig-optimaliserte lister for lynraskt oppslag i grafloopen
	public optParentProperties: string[] = [];
	public optChildProperties: string[] = [];
	public optFriendProperties: string[] = [];
	
	public optParentTags: string[] = [];
	public optChildTags: string[] = [];
	public optFriendTags: string[] = [];
	public optIgnoreFragments: string[] = [];
	public optIgnoreTags: string[] = [];
	
	async onload() {
		
		await this.loadSettings();
		this.prepareOptimizedFilters();

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

	/**
	 * Knytt denne til onload() og i innstillingsfanen din når brukeren lagrer.
	 * Splitter kommaseparerte strenger til rene, trimmede arrays.
	 */
	public prepareOptimizedFilters() {
		// Hjelpefunksjon for å splitte komma-strenger trygt
		const parseStr = (str: string) => str ? str.split(",").map(s => s.trim()).filter(Boolean) : [];

		// 1. Properties (Beholder store/små bokstaver fordi Frontmatter-nøkler er sensitive for dette)
		this.optParentProperties = parseStr(this.settings.parentProperties);
		this.optChildProperties  = parseStr(this.settings.childProperties);
		this.optFriendProperties = parseStr(this.settings.friendProperties);

		// 2. Tags og Fragmenter (Gjøres ALLTID om til lowercase for case-insensitiv matching)
		this.optParentTags      = parseStr(this.settings.parentTags).map(t => t.toLowerCase());
		this.optChildTags       = parseStr(this.settings.childTags).map(t => t.toLowerCase());
		this.optFriendTags      = parseStr(this.settings.friendTags).map(t => t.toLowerCase());
		this.optIgnoreFragments = parseStr(this.settings.ignoreNameFragments).map(f => f.toLowerCase());
		this.optIgnoreTags      = parseStr(this.settings.ignoreTags).map(t => t.toLowerCase());
	}

	async loadSettings() {
		const loadedData = await this.loadData();
		this.settings = Object.assign({}, DEFAULT_SETTINGS, loadedData);
	}

	async saveSettings() {
		this.prepareOptimizedFilters();
		await this.saveData(this.settings);
	}
}