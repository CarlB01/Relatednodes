import {App, Editor, MarkdownView, Modal, Notice, Plugin, 
	BasesViewRegistration} from 'obsidian';
import {DEFAULT_SETTINGS, MyPluginSettings, SampleSettingTab} from "./settings";
import { RelatedNodesView } from 'view';

export const ExampleViewType = 'example-view';

export default class RelatednodesPlugin extends Plugin {
	
	settings: MyPluginSettings;

	async onload() {
	    await this.loadSettings();

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new SampleSettingTab(this.app, this));
	
		// Tell Obsidian about the new view type that this plugin provides.
    	this.registerBasesView(ExampleViewType, {
      		name: 'Example',
      		icon: 'lucide-apple',
      		factory: (controller, containerEl) => {
        		return new RelatedNodesView(controller, containerEl)
      		},
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
