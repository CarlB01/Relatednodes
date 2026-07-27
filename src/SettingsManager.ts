/**
 * Configuration and Settings State Manager for minBrain Related Notes Network.
 * Handles migration mapping, runtime parsing, and low-latency array hydration.
 */
export class SettingsManager {
  // ==========================================================================
  // Core Configuration State Fields (Acts as both Types and Runtime Defaults)
  // ==========================================================================
  public parentProperties: string = 'tilhører, nasjonalitet';
  public parentTags: string = '#samling, #👥gruppe';
  public childProperties: string = 'barn, medlemmer';
  public childTags: string = '#funn, #symptom, #behandling, #han, #hun, #kalender, #tekst, #clippings, #genetisk';
  public friendProperties: string = 'partner';
  public friendTags: string = '';
  public ignoreTags: string = '#excalidraw';
  public ignoreNameFragments: string = '@';
  public displayAliases: boolean = false;
  public groupsCollapsed: boolean = false;

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
}
