import RelatednodesPlugin from "./main";
import {App, BasesEntry, PluginSettingTab, Point, Setting} from "obsidian";

export interface RelatedNodeGroup {
	key: string;
	isDefined: boolean;
	entries: BasesEntry[];
}

export type Relation = "center" | "parent" | "child" | "friend"| "sibling" | "undefined" | "ignored";
export type Direction = "up" | "down" | "left" | "right";
export type Nodetype = "file" | "other";
type settingsParamsTypes = "text" | "textArea";

export interface LeftTop {
	left: string
	top: string
}

export const relationOrder: Record<Relation, number> = {
  "center": 0,
  "parent": 1,
  "child": 2,
	"friend": 3,
  "sibling": 4,
  "undefined": 5,
	"ignored": 6,
}

export const GATE_LEFT: LeftTop = {
	left: '0%',
	top: '50%'
}

export const GATE_RIGHT: LeftTop = {
	left: '100%',
	top: '50%'
}

export const GATE_UP: LeftTop = {
	left: 'calc(50% - 8px * var(--scaleFactor))',
	top: '0%'
}

export const GATE_DOWN: LeftTop = {
	left: 'calc(50% + 8px * var(--scaleFactor))',
	top: 'calc(100% + 1px)'
}

export const NOTE_PROPERTIES: NoteProperties = {
	filename: "",
	basename: "",
	aliases: "",
	tags: "",
	properties: []
}

export interface Gate {
	direction: Direction | undefined;
	svg: SVGSVGElement | undefined;
	connections: RelatedNode[];
	unspecified: RelatedNode[];
};

export interface KeyPair {
	key: string;
	value: string;
}

export interface NoteProperties {
	filename: string;
	basename: string;
	aliases: string;
	tags: string;
	properties: [string | undefined, string | undefined][];
}

export interface RelatedNode {
	type: Nodetype | undefined;
	key: string | undefined;
	name: string | undefined;
	basename: string | undefined;
	alias: string | undefined;
	path: string | undefined;
	relation: Relation | undefined;
	div: HTMLElement | undefined;
	info: string | undefined;
	ignored: RelatedNode[] | undefined;
	upperGate: Gate;
	lowerGate: Gate;
	friendGate: Gate;
}

export interface MyPluginSettings {
	parentProperties: string;
	parentTags: string;
	childProperties: string;
	childTags: string;
	friendProperties: string;
	friendTags: string;
	ignoreNameFragments: string;
	ignoreTags: string;
	displayBasesToolbar: boolean;
	displayAliases: boolean;
	relatedNotesName: string;
}

export const DEFAULT_SETTINGS: MyPluginSettings = {
	parentProperties: 'tilhører, nasjonalitet',
	parentTags: '#samling, #👥gruppe',
	childProperties: 'barn, medlemmer',
	childTags: '#funn, #symptom, #behandling, #han, #hun, #kalender, #tekst, #clippings, #genetisk',
	friendProperties: 'partner',
	friendTags: '',
	ignoreTags: '#excalidraw',
	ignoreNameFragments:'@',
	displayBasesToolbar: false,
	displayAliases: false,
	relatedNotesName: 'minBrain' // dormant - for future
}

export const getDefaultNode = (): RelatedNode => ({
	type: undefined,
	key: undefined,
	name: undefined,
	basename: undefined,
	alias: undefined,
	path: undefined,
	relation: undefined,
	div: undefined,
	info: undefined,
	ignored: undefined,
	upperGate: {
		direction: 'up',
		svg: undefined,
		connections: [],
		unspecified: []
	},
	lowerGate: {
		direction: 'down',
		svg: undefined,
		connections: [],
		unspecified: []
	},
	friendGate:  {
		direction: 'left',
		svg: undefined,
		connections: [],
		unspecified: []
	},
});

/********* SETTINGS WINDOW */

interface settingsParams {
	name: string,
	desc: string, 
	type: settingsParamsTypes,
	placeHolder: string,
}

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

export class SampleSettingTab extends PluginSettingTab {
	plugin: RelatednodesPlugin;

	constructor(app: App, plugin: RelatednodesPlugin) {
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
			.setName('Show toolbar')
			.setDesc('Toggle this option to yes or no')
			.addToggle(toggle => toggle
					.setValue(this.plugin.settings!.displayBasesToolbar)
					.onChange(async (value) => {
							this.plugin.settings!.displayBasesToolbar = value;
							await this.plugin.saveSettings();
				}));
		new Setting(containerEl)
			.setName('display first alias as name')
			.setDesc('Toggle this option to yes or no')
			.addToggle(toggle => toggle
					.setValue(this.plugin.settings!.displayAliases)
					.onChange(async (value) => {
							this.plugin.settings!.displayAliases = value;
							await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Related notes filename')
			.setDesc('default path and name can be altered')
			.addText(text => text
				.setPlaceholder('minBrain')
				.setValue(this.plugin.settings!.relatedNotesName)
				.onChange(async (value) => {
					this.plugin.settings!.relatedNotesName = value;
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
			el.style.fieldSizing = "content";    // modern auto-grow

			// Auto-resize function
			const autoResize = () => {
				el.style.height = "auto";
				el.style.height = `${el.scrollHeight}px`;
			};

			el.addEventListener("input", autoResize);
			el.addEventListener("focus", autoResize);

			// Initial resize
			setTimeout(autoResize, 10);
    });
	}
}
