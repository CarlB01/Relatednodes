import RelatednotesPlugin from "./main.js";
import { App, PluginSettingTab, Setting } from "obsidian";
import { RV } from "./constants.js";
import { RelatednotesView } from "./view.js";

type settingsParamsTypes = "text" | "textArea";

interface settingsParams {
  name: string;
  desc: string; 
  type: settingsParamsTypes;
  placeHolder: string;
}

// ==========================================================================
// Centralized Settings Parameter Constants
// ==========================================================================

const SETTING_PARAMS_GENERAL: settingsParams = {
  name: "",
  desc: "",
  type: "textArea",
  placeHolder: "Comma separated list"
};

const SETTING_PARENT_PROPS: settingsParams = {
  ...SETTING_PARAMS_GENERAL,
  name: "Parents Properties",
  desc: "Links found inside these frontmatter properties will be treated as parents.",
};

const SETTING_PARENT_TAGS: settingsParams = {
  ...SETTING_PARAMS_GENERAL,
  name: "Parents Tags",
  desc: "Notes containing these #tags will automatically be routed to the upper parent quadrant.",
};

const SETTING_CHILD_PROPS: settingsParams = {
  ...SETTING_PARAMS_GENERAL,
  name: "Children Properties",
  desc: "Links found inside these frontmatter properties will be treated as children.",
};
      
const SETTING_CHILD_TAGS: settingsParams = {
  ...SETTING_PARAMS_GENERAL,
  name: "Children Tags",
  desc: "Neighbour notes containing these #tags will be routed to the lower child quadrant.",
};

const SETTING_FRIEND_PROPS: settingsParams = {
  ...SETTING_PARAMS_GENERAL,
  name: "Friend Properties",
  desc: "Links found inside these frontmatter properties will be treated as lateral friends.",
};
      
const SETTING_FRIEND_TAGS: settingsParams = {
  ...SETTING_PARAMS_GENERAL,
  name: "Friend Tags",
  desc: "Neighbour notes containing these #tags will be routed to the left flanke quadrant.",
};

const SETTING_IGNORE_TAGS: settingsParams = {
  ...SETTING_PARAMS_GENERAL,
  name: "Ignore Following Tags",
  desc: "Notes matching these specific #tags will be completely suppressed from the graph network.",
};

const SETTING_IGNOREFRAGMENTS_TAGS: settingsParams = {
  ...SETTING_PARAMS_GENERAL,
  name: "Ignore Filename Fragments",
  desc: "Notes matching these string file fragments will be completely suppressed from the graph network.",
};

export class SettingTab extends PluginSettingTab {
  plugin: RelatednotesPlugin;

  constructor(app: App, plugin: RelatednotesPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  /**
   * Renders the settings tab user interface view components.
   */
  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // ------------------------------------------------------------------------
    // SECTION 1: SEMANTIC HIERARCHIES
    // ------------------------------------------------------------------------
    new Setting(containerEl)
      .setName("Semantic Hierarchies & Metadata Links")
      .setHeading();

    this.createAutoResizeTextSetting(
      containerEl,
      SETTING_PARENT_PROPS,
      this.plugin.settings!.parentProperties ?? "",
      async (value) => {
        this.plugin.settings!.parentProperties = value;
        await this.plugin.saveSettings();
      }
    );

    this.createAutoResizeTextSetting(
      containerEl,
      SETTING_PARENT_TAGS,
      this.plugin.settings!.parentTags ?? "",
      async (value) => {
        this.plugin.settings!.parentTags = value;
        await this.plugin.saveSettings();
      }
    );

    this.createAutoResizeTextSetting(
      containerEl,
      SETTING_CHILD_PROPS,
      this.plugin.settings!.childProperties ?? "",
      async (value) => {
        this.plugin.settings!.childProperties = value;
        await this.plugin.saveSettings();
      }
    );

    this.createAutoResizeTextSetting(
      containerEl,
      SETTING_CHILD_TAGS,
      this.plugin.settings!.childTags ?? "",
      async (value) => {
        this.plugin.settings!.childTags = value;
        await this.plugin.saveSettings();
      }
    );

    this.createAutoResizeTextSetting(
      containerEl,
      SETTING_FRIEND_PROPS,
      this.plugin.settings!.friendProperties ?? "",
      async (value) => {
        this.plugin.settings!.friendProperties = value;
        await this.plugin.saveSettings();
      }
    );

    this.createAutoResizeTextSetting(
      containerEl,
      SETTING_FRIEND_TAGS,
      this.plugin.settings!.friendTags ?? "",
      async (value) => {
        this.plugin.settings!.friendTags = value;
        await this.plugin.saveSettings();
      }
    );

    // ------------------------------------------------------------------------
    // SECTION 2: EXCLUSION FILTERS
    // ------------------------------------------------------------------------
    new Setting(containerEl)
      .setName("Blacklist & Exclusion Filters")
      .setHeading();

    this.createAutoResizeTextSetting(
      containerEl,
      SETTING_IGNORE_TAGS,
      this.plugin.settings!.ignoreTags ?? "",
      async (value) => {
        this.plugin.settings!.ignoreTags = value;
        await this.plugin.saveSettings();
      }
    );

    this.createAutoResizeTextSetting(
      containerEl,
      SETTING_IGNOREFRAGMENTS_TAGS,
      this.plugin.settings!.ignoreNameFragments ?? "",
      async (value) => {
        this.plugin.settings!.ignoreNameFragments = value;
        await this.plugin.saveSettings();
      }
    );

    // ------------------------------------------------------------------------
    // SECTION 3: DISPLAY BEHAVIOR
    // ------------------------------------------------------------------------
    new Setting(containerEl)
			.setName('Display Primary Alias as Name')
			.setDesc('Toggle this option to render note aliases instead of raw filenames when present.')
			.addToggle(toggle => toggle
					.setValue(this.plugin.settings.displayAliases)
					.onChange(async (value) => {
							this.plugin.settings.displayAliases = value;
							await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Collapse Large Node Groups as Default')
			.setDesc('Automatically toggle larger grouped clusters into compact expanded button layers.')
			.addToggle(toggle => toggle
					.setValue(this.plugin.settings.groupsCollapsed)
					.onChange(async (value) => {
							this.plugin.settings.groupsCollapsed = value;
							await this.plugin.saveSettings();
					})
    	);
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

  /**
   * Sorts item tokens alphabetically using localized string comparison logic.
   */
  private sortItems(items: string): string {
    return items
      .split(',')
      .map(f => f.trim())
      .filter(f => f.length > 0)
      .sort((a, b) => 
        a.localeCompare(b, undefined, {
          sensitivity: 'base',     // Treats casing and minor character accents symmetrically
          numeric: true,           // Sorts dynamic numeric strings naturally
          ignorePunctuation: true  
        })
      ).join(', ');
  }

  /**
   * Generates a stylized, hardware-responsive auto-growing TextArea node component.
   */
  private addAutoResizeTextArea(
    setting: Setting,
    value: string,
    onChange: (value: string) => void | Promise<void>
  ): void {
    setting.addTextArea((textArea) => {
      textArea
          .setValue(value)
          .setPlaceholder(SETTING_PARAMS_GENERAL.placeHolder)
          .onChange(async (newValue) => {
              await onChange(newValue);
          });

      const el = textArea.inputEl;

      el.style.width = "100%";
      el.style.minWidth = "150px";
      el.style.minHeight = "50px";
      el.style.maxHeight = "350px";        
      el.style.resize = "none";
      el.style.overflowY = "auto";
      // @ts-ignore fieldSizing is not yet in global DOM types
      el.style.fieldSizing = "content";    

      const autoResize = () => {
        el.style.height = "auto";
        el.style.height = `${el.scrollHeight}px`;
      };

      this.plugin.registerDomEvent(el, "input", autoResize);
      this.plugin.registerDomEvent(el, "focus", autoResize);

      setTimeout(autoResize, 10);
    });
  }

  /**
   * Triggers automatically when the user exits the settings control tab pane panel.
   * Forces data hydration cycles and pushes hot-reloading updates onto open views.
   */
  async hide() {
    await this.plugin.saveSettings();

    // Hot-reloads all active leaves using our official application views identifiers
    this.app.workspace.getLeavesOfType(RV.RELATED_NOTES_VIEW_TYPE).forEach(leaf => {
      if (leaf.view instanceof RelatednotesView) {
        // Triggers database cache update passes and forces a clean redrawing cycle
        const activeFile = this.app.workspace.getActiveFile();
        if (activeFile) {
          leaf.view.onFileChange(activeFile);
        }
      }
    });

    super.hide();
  }
}
