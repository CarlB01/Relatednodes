import { StringUtils } from "./StringUtils";

/**
 * Configuration and Settings State Manager for myBrain Graph Notes Network.
 * Handles migration mapping, runtime parsing, and ultra-low-latency Set dehydration.
 */
export class SettingsManager {
  [key: string]: unknown;
   
  // ==========================================================================
  // Core Configuration State Fields (Acts as both Types and Runtime Defaults)
  // ==========================================================================
  public parentProperties: string = 'up, parents, nationality';
  public parentTags: string = '#boss, #👥group';
  public childProperties: string = 'down, children, members';
  public childTags: string = '#text, #coffee';
  public friendProperties: string = 'left, partner, friends';
  public friendTags: string = '#friend';
  public ignoreTags: string = '#private';
  public ignoreNameFragments: string = '@';
  public displayAliases: boolean = false;
  public groupsCollapsed: boolean = false;
  public colorful: boolean = true; // line color follows destination node color

  // ==========================================================================
  // Pre-Compiled Hydrated Sets (O(1) lookups target for high-velocity graph loops)
  // ==========================================================================
  public optParentProperties: Set<string> = new Set();
  public optChildProperties: Set<string> = new Set();
  public optFriendProperties: Set<string> = new Set();
  
  public optParentTags: Set<string> = new Set();
  public optChildTags: Set<string> = new Set();
  public optFriendTags: Set<string> = new Set();
  public optIgnoreFragments: Set<string> = new Set();
  public optIgnoreTags: Set<string> = new Set();

  constructor() {
    this.prepare();
  }

  /**
   * Hydrates pre-compiled tracking caches synchronously into native JavaScript Sets.
   * Strips out carriage returns and enforces lowercase normalization where applicable.
   */
  public prepare() {
    // Utility pipeline parsing string configurations into optimized structural arrays
    const parseStr = (str: string): string[] => {
      if (!str) return [];
      const cleanStr = str.replace(/[\r\n]+/g, ""); // Purges structural newline characters entirely
      return cleanStr.split(",").map(s => s.trim()).filter(Boolean);
    };

    // 1. Structural Field Properties (Preserved case-sensitive for YAML mapping precision)
    this.optParentProperties = new Set(parseStr(this.parentProperties));
    this.optChildProperties  = new Set(parseStr(this.childProperties));
    this.optFriendProperties = new Set(parseStr(this.friendProperties));

    // 2. Tag Blocks and Fragments (ULTRA-OPTIMIZATION: Injecting lowercase + NFC normalization at birth)
    this.optParentTags      = new Set(parseStr(this.parentTags).map(t => t.toLowerCase().normalize('NFC')));
    this.optChildTags       = new Set(parseStr(this.childTags).map(t => t.toLowerCase().normalize('NFC')));
    this.optFriendTags      = new Set(parseStr(this.friendTags).map(t => t.toLowerCase().normalize('NFC')));
    this.optIgnoreFragments = new Set(parseStr(this.ignoreNameFragments).map(f => f.toLowerCase().normalize('NFC')));
    this.optIgnoreTags      = new Set(parseStr(this.ignoreTags).map(t => t.toLowerCase().normalize('NFC')));
  }

  public prepareForSave() {
    // strings are washed and sorted alphabetically
    this.parentProperties     = StringUtils.sortItems(this.parentProperties);
    this.parentTags           = StringUtils.sortItems(this.parentTags);
    this.childProperties      = StringUtils.sortItems(this.childProperties);
    this.childTags            = StringUtils.sortItems(this.childTags);
    this.friendProperties     = StringUtils.sortItems(this.friendProperties);
    this.friendTags           = StringUtils.sortItems(this.friendTags);
    this.ignoreTags           = StringUtils.sortItems(this.ignoreTags);
    this.ignoreNameFragments = StringUtils.sortItems(this.ignoreNameFragments);

    // rebuild cache based on sorted values
    this.prepare();
  }
}
