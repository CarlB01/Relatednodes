
// #region imports, types, const

// 1. imports
import RelatednotesPlugin from "./main.js";
import {App, PluginSettingTab, Setting} from "obsidian";

// 2. Types /interface
type settingsParamsTypes = "text" | "textArea";

interface settingsParams {
	name: string,
	desc: string, 
	type: settingsParamsTypes,
	placeHolder: string,
}

// 3. Constants

const SETTING_PARAMS_GENERAL: settingsParams = {
	name: "",
	desc: "",
	type: "textArea",
	placeHolder: "Comma separated list"
}


const SETTING_PARENT_PROPS: settingsParams = {... SETTING_PARAMS_GENERAL,
	name: "Parents Properties",
	desc: "links in these properties are placed in parents position",
}

const SETTING_PARENT_TAGS: settingsParams = {... SETTING_PARAMS_GENERAL,
	name: "Parents tags",
	desc: "notes with these #tags are generally placed in parents position",
}

const SETTING_CHILD_PROPS: settingsParams = {... SETTING_PARAMS_GENERAL,
	name: "Children Properties",
	desc: "links in these properties are placed in children position",
}
			
const SETTING_CHILD_TAGS: settingsParams = {... SETTING_PARAMS_GENERAL,
	name: "Children tags",
	desc: "neighbour notes containing these tags are considered \'children\'",
}

const SETTING_FRIEND_PROPS: settingsParams = {... SETTING_PARAMS_GENERAL,
	name: "Friend Properties",
	desc: "links in these properties are placed in friends position",
}
			
const SETTING_FRIEND_TAGS: settingsParams = {... SETTING_PARAMS_GENERAL,
	name: "Friend tags",
	desc: "neighbour notes containing these tags are considered \'friends\'",
}

const SETTING_IGNORE_TAGS: settingsParams = {... SETTING_PARAMS_GENERAL,
	name: "Ignore following tags",
	desc: "notes with these #tags will be ignored",
}

const SETTING_IGNOREFRAGMENTS_TAGS: settingsParams = {... SETTING_PARAMS_GENERAL,
	name: "Ignore following file name fragments",
	desc: "notes with these filename fragments will be ignored",
}

// #endregion

export class SampleSettingTab extends PluginSettingTab {
	plugin: RelatednotesPlugin;

	constructor(app: App, plugin: RelatednotesPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		this.createAutoResizeTextSetting(
    	containerEl,
    	SETTING_PARENT_PROPS,
    	this.plugin.settings!.parentProperties ?? "",
    	async (value) => {
        this.plugin.settings!.parentProperties = value;
        await this.plugin.saveSettings();
		});

		this.createAutoResizeTextSetting(
    	containerEl,
    	SETTING_PARENT_TAGS,
    	this.plugin.settings!.parentTags ?? "",
    	async (value) => {
        this.plugin.settings!.parentTags = value;
        await this.plugin.saveSettings();
		});

		this.createAutoResizeTextSetting(
    	containerEl,
    	SETTING_CHILD_PROPS,
    	this.plugin.settings!.childProperties ?? "",
    	async (value) => {
        this.plugin.settings!.childProperties = value;
        await this.plugin.saveSettings();
		});

		this.createAutoResizeTextSetting(
    	containerEl,
    	SETTING_CHILD_TAGS,
    	this.plugin.settings!.childTags ?? "",
    	async (value) => {
        this.plugin.settings!.childTags = value;
        await this.plugin.saveSettings();
		});

		this.createAutoResizeTextSetting(
    	containerEl,
    	SETTING_FRIEND_PROPS,
    	this.plugin.settings!.friendProperties ?? "",
    	async (value) => {
        this.plugin.settings!.friendProperties = value;
        await this.plugin.saveSettings();
		});

		this.createAutoResizeTextSetting(
    	containerEl,
    	SETTING_FRIEND_TAGS,
    	this.plugin.settings!.friendTags ?? "",
    	async (value) => {
        this.plugin.settings!.friendTags = value;
        await this.plugin.saveSettings();
		});

		this.createAutoResizeTextSetting(
    	containerEl,
    	SETTING_IGNORE_TAGS,
    	this.plugin.settings!.ignoreTags ?? "",
    	async (value) => {
        this.plugin.settings!.ignoreTags = value;
        await this.plugin.saveSettings();
		});

		this.createAutoResizeTextSetting(
    	containerEl,
    	SETTING_IGNOREFRAGMENTS_TAGS,
    	this.plugin.settings!.ignoreNameFragments ?? "",
    	async (value) => {
        this.plugin.settings!.ignoreNameFragments = value;
        await this.plugin.saveSettings();
		});

		new Setting(containerEl)
			.setName('display first alias as name')
			.setDesc('Toggle this option to yes or no')
			.addToggle(toggle => toggle
					.setValue(this.plugin.settings.displayAliases)
					.onChange(async (value) => {
							this.plugin.settings.displayAliases = value;
							await this.plugin.saveSettings();
				}));
	}

	private createAutoResizeTextSetting(
    containerEl: HTMLElement,
		useParams: settingsParams,
    currentValue: string,
    onChange: (value: string) => void | Promise<void>
	): Setting {
		const setting = new Setting(containerEl)
			.setName(useParams.name)
			.setDesc(useParams.desc || "");

    this.addAutoResizeTextArea(setting, this.sortItems(currentValue), onChange);
    return setting;
	}

	private sortItems(items: string): string {
		return items
			.split(',')
    	.map(f => f.trim())
    	.filter(f => f.length > 0)
			.sort((a, b) => 
  		a.localeCompare(b, undefined, {
    		sensitivity: 'base',     // treats é and e as similar (case-insensitive)
    		numeric: true,           // sorts numbers naturally (optional)
    		ignorePunctuation: true  // optional: ignores punctuation
  		})
		).join(', ');
	}

	/**
 	* Creates a styled, auto-growing textarea with vertical scrollbar
 	*/
	private addAutoResizeTextArea(
    setting: Setting,
    value: string,
    onChange: (value: string) => void | Promise<void>
	): void {
    setting.addTextArea((textArea) => {
			textArea
					.setValue(value)
					.onChange(async (newValue) => {
							await onChange(newValue);
					});

			const el = textArea.inputEl;

			// Apply consistent styling
			el.style.width = "100%";
			el.style.minWidth = "150px";
			el.style.minHeight = "50px";
			el.style.maxHeight = "350px";        // ← adjust this value as needed
			el.style.resize = "none";
			el.style.overflowY = "auto";
			// @ts-ignore fieldSizing is not yet in global DOM types
			el.style.fieldSizing = "content";    // modern auto-grow

			// Auto-resize function
			const autoResize = () => {
				el.style.height = "auto";
				el.style.height = `${el.scrollHeight}px`;
			};

			this.plugin.registerDomEvent(el, "input", autoResize);
	    this.plugin.registerDomEvent(el, "focus", autoResize);

			// Initial resize
			setTimeout(autoResize, 10);
    });
	}
	async hide() {
		// 1. Hent verdiene fra input-feltene dine (hvis du ikke gjør det i sanntid)
		// f.eks.: this.plugin.settings.ignoreTags = this.ignoreTagsInputEl.value;

		// 2. Lagre alt til disk og trigg vaskingen av listene (prepareOptimizedFilters kjører inni her!)
		await this.plugin.saveSettings();

		// 3. Gi beskjed til graf-visningen din om å tegne seg på nytt med de nye filtrene
		// (Slik at brukeren ser endringen med en gang de går tilbake til notatene sine)
		const view = this.app.workspace.getLeavesOfType("related-nodes-view")[0]?.view as any;
		if (view && typeof view.update === "function") {
				view.update(this.app.workspace.getActiveFile());
		}

		super.hide();
	}
}
