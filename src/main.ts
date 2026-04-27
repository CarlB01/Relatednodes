import {App, Modal, Plugin, BasesViewConfig, BasesAllOptions, BasesOptions, TFile, Notice, WorkspaceLeaf} from 'obsidian';
import {DEFAULT_SETTINGS, MyPluginSettings, SampleSettingTab} from "./settings";
import { RelatedNodesView } from './view';
import { BaseSidebarView, VIEW_TYPE_BASE_PANEL } from "./sidebar-view";

export const relatedNodesViewType = 'relatedNodesViewType';

/*
const defaultCollapseOptions: BasesOptions = {
		type: 'text', //'text', 'property'
		displayName: 'All collapsed (yes/no)',
		key: 'collapsed',
		default: 'yes',
}
const defaultPropertyOptions: BasesOptions = {
		type: 'property', //'text', 'property'
		displayName: 'default group By property',
		key: 'tags',
		default: 'file.tags',
}
const ignorePropertyOptions: BasesOptions = {
		type: 'property', //'text', 'property'
		displayName: 'ignore following properties',
		key: 'ignore',
		default: '#excalidraw',
}
// neighbour notes  containing these tags are considered 'parents'
const parentTagsOptions: BasesOptions = {
		type: 'text', //'text', 'property'
		displayName: 'parent tags (comma separated, include \'#\')',
		key: 'parentTags',
		default: parentDefaults.join(", ")
}
*/
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

export default class RelatednodesPlugin extends Plugin {
	
	settings: MyPluginSettings | undefined;

	async onload() {
		await this.loadSettings();
		
		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new SampleSettingTab(this.app, this));
	
		// 1. Register the view creator
		this.registerView(
			VIEW_TYPE_BASE_PANEL,	
			(leaf) => new BaseSidebarView(leaf,this.app)
		);

		// 2. Add a ribbon icon to open the sidebar tab
		this.addRibbonIcon("apple", "Open Relatednodes", () => {
			this.activateViewForBase('bases/minBrain.base');
		});

		// Tell Obsidian about the new view type that this plugin provides.
		/*
		this.registerBasesView(relatedNodesViewType, {
			name: 'Relatert',
			icon: 'lucide-apple',
			factory: (controller, containerEl) => 
				new RelatedNodesView(controller, containerEl),
			options: () => ([
				defaultCollapseOptions, 
				defaultPropertyOptions,
				ignorePropertyOptions,
				parentTagsOptions, 
				childTagsOptions, 
				parentAttributesOptions,
				separatorOptions
			]),
		});
		*/
		this.registerBasesView(relatedNodesViewType, {
			name: 'Relatert',
			icon: 'lucide-apple',
			factory: (controller, containerEl) => 
				new RelatedNodesView(controller, containerEl, this),
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
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<MyPluginSettings>);
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
