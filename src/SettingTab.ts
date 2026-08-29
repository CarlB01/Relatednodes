import { App, debounce, PluginSettingTab, SettingDefinitionItem } from "obsidian";
import { RV } from "./constants.js"
import MyBrainPlugin from "./main.js";
import { MyBrainView } from "./view.js";
import { StringUtils } from "./StringUtils.js";

export class SettingTab extends PluginSettingTab {
  plugin: MyBrainPlugin;

  // Obsidian-native debounce wrapper (no manual timers).
  private readonly debouncedRefresh: () => void;

  constructor(app: App, plugin: MyBrainPlugin) {
    super(app, plugin);
    this.plugin = plugin;

    this.debouncedRefresh = debounce(
      () => { void this.refreshAllMyBrainViews(); },
      220,
      true // reset timer on repeated calls
    );
  }

  private async refreshAllMyBrainViews(): Promise<void> {
    if (this.plugin.networkGraph?.noteCache) {
      this.plugin.networkGraph.noteCache.clear();
    }

    const leaves = this.app.workspace.getLeavesOfType(RV.VIEW_TYPE);
    for (const leaf of leaves) {
      if (!(leaf.view instanceof MyBrainView)) continue;
      const myView = leaf.view;
      const activeFile = this.app.workspace.getActiveFile();
      if (!activeFile) continue;

      const historicalGateState = myView.isFullyStarted;
      myView.isFullyStarted = true;
      myView.onFileChange(activeFile);
      myView.isFullyStarted = historicalGateState || true;

      myView.areaManager?.renderGraph();
      myView.areaManager?.requestRedraw();
    }
  }

  /**
   * Declares the full structural configuration scheme for Obsidian's global database indexing framework.
   * Placeholders act as grayed-out hints without pre-populating or overwriting the user space.
   */
  override getSettingDefinitions(): SettingDefinitionItem[] {    
    return [
      {
        type: "group",
        heading: "Semantic hierarchies & metadata links",
        items: [
          {
            name: "Parents properties",
            desc: "Links found inside these frontmatter properties will be treated as parents.",
            control: {
              type: "textarea",
              key: "parentProperties",
              placeholder: "up, parents, nationality", 
              rows: 5,
            },
          },
          {
            name: "Parents tags",
            desc: "Notes containing these #tags will automatically be routed to the upper parent quadrant.",
            control: {
              type: "textarea",
              key: "parentTags",
              placeholder: "#boss, #👥group", 
              rows: 2,
            },
          },
          {
            name: "Children properties",
            desc: "Links found inside these frontmatter properties will be treated as children.",
            control: {
              type: "textarea",
              key: "childProperties",
              placeholder: "down, children, members", 
              rows: 5,
            },
          },
          {
            name: "Children tags",
            desc: "Notes containing these #tags will be routed to the lower child quadrant.",
            control: {
              type: "textarea",
              key: "childTags",
              placeholder: "#text, #coffee", 
              rows: 2,
            },
          },
          {
            name: "Friends properties",
            desc: "Links found inside these frontmatter properties will be treated as lateral friends.",
            control: {
              type: "textarea",
              key: "friendProperties",
              placeholder: "left, partner, friends", 
              rows: 3,
            },
          },
          {
            name: "Friends tags",
            desc: "Notes containing these #tags will be routed to the left quadrant.",
            control: {
              type: "textarea",
              key: "friendTags",
              placeholder: "#friend", 
              rows: 2,
            },
          },
        ],
      },
      {
        type: "group",
        heading: "Blacklist & exclusion filters",
        items: [
          {
            name: "Ignore following tags",
            desc: "Notes matching these specific #tags will be completely suppressed from the graph network.",
            control: {
              type: "text",
              key: "ignoreTags",
              placeholder: "#private", 
            },
          },
          {
            name: "Ignore filename fragments",
            desc: "Notes matching these string file fragments will be completely suppressed from the graph network.",
            control: {
              type: "text",
              key: "ignoreNameFragments",
              placeholder: "@", 
            },
          },
        ],
      },
      {
        type: "group",
        heading: "Display behavior",
        items: [
          {
            name: "Display primary alias as name",
            desc: "Toggle this option to render note aliases instead of raw filenames when present.",
            control: {
              type: "toggle",
              key: "displayAliases",
            },
          },
          {
            name: "Collapse large node groups as default",
            desc: "Automatically toggle larger grouped clusters into compact expanded button layers.",
            control: {
              type: "toggle",
              key: "groupsCollapsed",
            },
          },
          {
            name: "Colorful links",
            desc: "When enabled, line and receiving gate color follow the gate node color.",
            control: {
              type: "toggle",
              key: "colorful",
            },
          }
        ],
      },
    ];
  }


override async setControlValue(key: string, value: unknown): Promise<void> {
    const settings = this.plugin.settings;

    const textKeys = new Set([
      "parentProperties",
      "parentTags",
      "childProperties",
      "childTags",
      "friendProperties",
      "friendTags",
      "ignoreTags",
      "ignoreNameFragments",
    ]);

    const toggleKeys = new Set([
      "displayAliases",
      "groupsCollapsed",
      "colorful",
    ]);

    if (textKeys.has(key)) {
      const str = typeof value === "string" ? value : "";
      (settings as Record<string, unknown>)[key] = StringUtils.sortItems(str);
    } else if (toggleKeys.has(key)) {
      (settings as Record<string, unknown>)[key] = Boolean(value);
    } else {
      (settings as Record<string, unknown>)[key] = value;
    }

    settings.prepare();
    await this.plugin.saveData(settings);

    // Immediate for toggles, debounced for text typing.
    if (toggleKeys.has(key)) {
      await this.refreshAllMyBrainViews();
    } else {
      this.debouncedRefresh();
    }
  }
}