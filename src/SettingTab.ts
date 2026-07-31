import MyBrainPlugin from "./main.js";
import { App, PluginSettingTab, SettingDefinitionItem } from "obsidian";
import { RV } from "./constants.js";
import { MyBrainView } from "./view.js";

export class SettingTab extends PluginSettingTab {
  plugin: MyBrainPlugin;

  constructor(app: App, plugin: MyBrainPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  /**
   * Declares the full structural configuration scheme for Obsidian's global database indexing framework.
   * Natively registers each parameter with the application core to ensure reliable settings search indexing.
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
              placeholder: "Comma separated list",
              rows: 5,
            },
          },
          {
            name: "Parents tags",
            desc: "Notes containing these #tags will automatically be routed to the upper parent quadrant.",
            control: {
              type: "textarea",
              key: "parentTags",
              placeholder: "Comma separated list",
              rows: 2,
            },
          },
          {
            name: "Children properties",
            desc: "Links found inside these frontmatter properties will be treated as children.",
            control: {
              type: "textarea",
              key: "childProperties",
              placeholder: "Comma separated list",
              rows: 5,
            },
          },
          {
            name: "Children tags",
            desc: "Notes containing these #tags will be routed to the lower child quadrant.",
            control: {
              type: "textarea",
              key: "childTags",
              placeholder: "Comma separated list",
              rows: 2,
            },
          },
          {
            name: "Friends properties",
            desc: "Links found inside these frontmatter properties will be treated as lateral friends.",
            control: {
              type: "textarea",
              key: "friendProperties",
              placeholder: "Comma separated list",
              rows: 3,
            },
          },
          {
            name: "Friends tags",
            desc: "Notes containing these #tags will be routed to the left quadrant.",
            control: {
              type: "textarea",
              key: "friendTags",
              placeholder: "Comma separated list",
              rows: 2
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
              placeholder: "Comma separated list",
            },
          },
          {
            name: "Ignore filename fragments",
            desc: "Notes matching these string file fragments will be completely suppressed from the graph network.",
            control: {
              type: "text",
              key: "ignoreNameFragments",
              placeholder: "Comma separated list",
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
        ],
      },
    ];
  }

  /**
   * Triggers automatically when the user exits the settings control tab pane panel.
   * Normalizes list inputs alphabetically, wipes the stale memory graphs cache, and triggers live view redraws.
   * COMPLIANT REFACTOR: Replaces deep .then() nesting and illegal unsafe async forEach loops 
   * with a flat, isolated async execution envelope guarded by the strict void operator [dan]!
   */
  hide(): void {
    const settings = this.plugin.settings;

    // Alphabetically compile and wash raw configuration sequences prior to disk writes
    settings.parentProperties = this.sortItems(settings.parentProperties);
    settings.parentTags = this.sortItems(settings.parentTags);
    settings.childProperties = this.sortItems(settings.childProperties);
    settings.childTags = this.sortItems(settings.childTags);
    settings.friendProperties = this.sortItems(settings.friendProperties);
    settings.friendTags = this.sortItems(settings.friendTags);
    settings.ignoreTags = this.sortItems(settings.ignoreTags);
    settings.ignoreNameFragments = this.sortItems(settings.ignoreNameFragments);

    // ==========================================================================
    // COMPLIANT ASYNCHRONOUS STORAGE CONVOLUT OVERRIDE:
    // Prefixed with the explicit 'void' operator to satisfy Obsidian's floating promises guard.
    // Converted the loops to standard 'for...of' structures to properly handle inner await calls [dan]!
    // ==========================================================================
    void (async () => {
      
      // Commit the sorted layout mutations down to the device configuration database layers cleanly
      await this.plugin.saveSettings();

      // Clear the network cache completely since filter structures mutated
      if (this.plugin.networkGraph && this.plugin.networkGraph.noteCache) {
        this.plugin.networkGraph.noteCache.clear();
      }

      // Hot-reloads all active leaves using our official application views identifiers
      const leaves = this.app.workspace.getLeavesOfType(RV.MYBRAIN_VIEW_TYPE);
      
      for (const leaf of leaves) {
        if (leaf.view instanceof MyBrainView) {
          const myView = leaf.view;
          const activeFile = this.app.workspace.getActiveFile();
          
          if (activeFile) {
            // Temporarily lift execution slots to bypass the initial onFileChange shield cleanly
            const historicalGateState = myView.isFullyStarted;
            myView.isFullyStarted = true; 

            // Standardized await call safely enclosed inside compliant for...of iteration tracks [dan]
            await myView.onFileChange(activeFile);
            
            // Restore the authentic runtime gate perimeter safely
            myView.isFullyStarted = historicalGateState || true;

            if (myView.areaManager) {
              myView.areaManager.renderGraph(); // Redraws the view with your brand new filters instantly!
            }
          }
        }
      }

    })(); // The trailing double parenthesis invokes the async settings write block instantly [dan]

    // Execute the super boundary cleanup synchronously to satisfy the strict signature return criteria
    super.hide();
  }

  /**
   * Separates comma-delimited strings, normalizes items alphabetically, 
   * and compiles them back into a clean, standardized string format.
   * COMPLIANT ENCAPSULATION: Centralizes string mutations to clean up the hide pipeline [dan].
   */
  private sortItems(rawString: string): string {
    if (!rawString || typeof rawString !== "string") return "";
    
    return rawString
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
      .sort((a, b) => a.localeCompare(b))
      .join(", ");
  }

}
