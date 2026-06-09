import {App, Modal, Plugin, BasesOptions, TFile, Notice, MarkdownView, WorkspaceLeaf} from 'obsidian';
import {DEFAULT_SETTINGS, MyPluginSettings, SampleSettingTab} from "./settings.js";
import { RelatednotesView } from './view.js';
import { BaseSidebarView, VIEW_TYPE_BASE_PANEL } from "./sidebar-view.js";

export const relatednodesID = 'relatednotesViewType';
export const superChargedLinkAttribs = 'internal-link data-link-icon data-link-icon-after data-link-text';


const separatorOptions: BasesOptions = {
		type: 'text', //'text', 'property'
		displayName: 'separate values',
		key: 'separator',
		default: ' - ',
}
// neighbour notes  containing these tags are considered 'parents'
const parentAttributesOptions: BasesOptions = {
		type: 'text', //'text', 'property'
		displayName: 'attributes (comma separated)',
		key: 'attributes',
		default: 'tilhører',
}

export default class RelatednotesPlugin extends Plugin {

	declare settings: MyPluginSettings;
	
	async onload() {
		
		await this.loadSettings();      // ← Main call
		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new SampleSettingTab(this.app, this));
	
		// 1. Register the view creator
		this.registerView(
			VIEW_TYPE_BASE_PANEL,	
			(leaf) => new BaseSidebarView(leaf,this.app)
		);

		// 2. Add a ribbon icon to open the sidebar tab
		this.addRibbonIcon("apple", "Open Relatednotes", () => {
			this.activateViewForBase('bases/minBrain.base');
		});

		// Tell Obsidian about the new view type that this plugin provides.
		
		this.registerBasesView(relatednodesID, {
			name: 'Relatert',
			icon: 'lucide-apple',
			factory: (controller, containerEl) => 
				new RelatednotesView(controller, containerEl, this),
			options: () => ([
				parentAttributesOptions,
				separatorOptions
			]),
		});
	};

	async activateViewForBase(path: string) {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile) || file.extension !== 'base') {
			new Notice("Not a valid .base file");
			return;
		}
		await this.openBaseInLeftSidebar(file);
	}

	async openBaseInLeftSidebar(baseFile: TFile) {
		const { workspace } = this.app;

		let leaf = workspace.getLeavesOfType(VIEW_TYPE_BASE_PANEL)[0];

		if (leaf) {
				this.app.workspace.revealLeaf(leaf);
				return;
		} else {
			let leftLeaf = workspace.getLeftLeaf(false);
			if (leftLeaf) {
				leaf = leftLeaf;
			};
			
		};
		if (!(typeof leaf === 'undefined')) {

			await leaf.openFile(baseFile, { active: true });

			// Optional: reveal/make sure sidebar is visible
			this.app.workspace.revealLeaf(leaf);
			this.app.workspace.leftSplit?.expand();
		}

	};
	
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

class SampleModal extends Modal {
	constructor(app: App) {
		super(app);
	}

	onOpen() {
		let {contentEl} = this;
		contentEl.setText('Woah!');
	}

	onClose() {
		const {contentEl} = this;
		contentEl.empty();
	}
}
