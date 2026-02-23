import {App, Modal, Plugin, BasesViewConfig, BasesAllOptions, BasesOptions} from 'obsidian';
import {DEFAULT_SETTINGS, MyPluginSettings, SampleSettingTab} from "./settings";
import { RelatedNodesView } from 'view';

export const relatedNodesViewType = 'relatedNodesViewType';

//var haha: (config: BasesViewConfig) => BasesAllOptions[]; 
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

const separatorOptions: BasesOptions = {
		type: 'text', //'text', 'property'
		displayName: 'separate values',
		key: 'separator',
		default: ' - ',
}

export default class RelatednodesPlugin extends Plugin {
	
	settings: MyPluginSettings;

	async onload() {
		await this.loadSettings();
		
		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new SampleSettingTab(this.app, this));
	
		// Tell Obsidian about the new view type that this plugin provides.
		this.registerBasesView(relatedNodesViewType, {
			name: 'Relatert',
			icon: 'lucide-apple',
			factory: (controller, containerEl) => 
				new RelatedNodesView(controller, containerEl),
			options: () => ([
				defaultCollapseOptions, 
				defaultPropertyOptions,
				ignorePropertyOptions,
				separatorOptions
			]),
		});
	}
	
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
