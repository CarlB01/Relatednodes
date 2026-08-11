import { StringUtils } from "./StringUtils";

/**
 * Configuration and Settings State Manager for myBrain Graph Notes Network.
 * Handles migration mapping, runtime parsing, and low-latency array hydration.
 */
export class SettingsManager {
  [key: string]: any; 
  // ==========================================================================
  // Core Configuration State Fields (Acts as both Types and Runtime Defaults)
  // ==========================================================================
  public parentProperties: string = 'up, parents, nationality';
  public parentTags: string = '#boss, #👥group';
  public childProperties: string = 'down, children, members';
  public childTags: string = '#text, #coffee';
  public friendProperties: string = 'partner, friend';
  public friendTags: string = '';
  public ignoreTags: string = '#excalidraw';
  public ignoreNameFragments: string = '@';
  public displayAliases: boolean = false;
  public groupsCollapsed: boolean = false;
  public colorful: boolean = true; // line color follows destination node color

  // ==========================================================================
  // Pre-Compiled Hydrated Arrays (Low-latency cache targets for the graph loop)
  // ==========================================================================
  public optParentProperties: string[] = [];
  public optChildProperties: string[] = [];
  public optFriendProperties: string[] = [];
  
  public optParentTags: string[] = [];
  public optChildTags: string[] = [];
  public optFriendTags: string[] = [];
  public optIgnoreFragments: string[] = [];
  public optIgnoreTags: string[] = [];

  constructor() {
    this.prepare();
  }

  /**
   * Hydrates pre-compiled tracking caches synchronously from serialized data fields.
   * Strips out carriage returns and enforces lowercase normalization where applicable.
   */
  public prepare() {
    // Utility pipeline parsing string configurations into optimized structural array arrays
    const parseStr = (str: string) => {
      if (!str) return [];
      const cleanStr = str.replace(/[\r\n]+/g, ""); // Purges structural newline characters entirely
      return cleanStr.split(",").map(s => s.trim()).filter(Boolean);
    };

    // 1. Structural Field Properties (Preserved case-sensitive for YAML mapping precision)
    this.optParentProperties = parseStr(this.parentProperties);
    this.optChildProperties  = parseStr(this.childProperties);
    this.optFriendProperties = parseStr(this.friendProperties);

    // 2. Tag Blocks and Fragments (Lowercased to achieve high-velocity case-insensitive matching)
    this.optParentTags      = parseStr(this.parentTags).map(t => t.toLowerCase());
    this.optChildTags       = parseStr(this.childTags).map(t => t.toLowerCase());
    this.optFriendTags      = parseStr(this.friendTags).map(t => t.toLowerCase());
    this.optIgnoreFragments = parseStr(this.ignoreNameFragments).map(f => f.toLowerCase());
    this.optIgnoreTags      = parseStr(this.ignoreTags).map(t => t.toLowerCase());
  }

  public prepareForSave() {
    const s = this;

    // Her vasker og sorterer vi alle strengene alfabetisk
    s.parentProperties     = StringUtils.sortItems(s.parentProperties);
    s.parentTags           = StringUtils.sortItems(s.parentTags);
    s.childProperties      = StringUtils.sortItems(s.childProperties);
    s.childTags            = StringUtils.sortItems(s.childTags);
    s.friendProperties     = StringUtils.sortItems(s.friendProperties);
    s.friendTags           = StringUtils.sortItems(s.friendTags);
    s.ignoreTags           = StringUtils.sortItems(s.ignoreTags);
    s.ignoreNameFragments = StringUtils.sortItems(s.ignoreNameFragments);

    // Bygg cachen på nytt basert på de nysorterte strengene
    s.prepare();
  }
}
