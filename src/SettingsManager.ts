export class SettingsManager {
  // === DINE EKSTE STANDARDVERDIER FLYTTET HIT! ===
  // Klassens variabler fungerer nå BÅDE som grensesnitt (types) og som fallback (defaults)
  public parentProperties: string = 'tilhører, nasjonalitet';
  public parentTags: string = '#samling, #👥gruppe';
  public childProperties: string = 'barn, medlemmer';
  public childTags: string = '#funn, #symptom, #behandling, #han, #hun, #kalender, #tekst, #clippings, #genetisk';
  public friendProperties: string = 'partner';
  public friendTags: string = '';
  public ignoreTags: string = '#excalidraw';
  public ignoreNameFragments: string = '@';
  public displayAliases: boolean = false;

  // === B. DE OPTIMALISERTE LISTENE (Ferdigtygde arrays for grafloopen) ===
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
   * Denne bodde før i main.ts. Nå lever den her og har direkte tilgang til dataene!
   */
  public prepare() {
    // Oppdatert hjelpefunksjon: Fjerner usynlige linjeskift (\n, \r) og trimmer elementene safely!
    const parseStr = (str: string) => {
      if (!str) return [];
      const cleanStr = str.replace(/[\r\n]+/g, ""); // Stripper bort absolutt alle linjeskift!
      return cleanStr.split(",").map(s => s.trim()).filter(Boolean);
    };

    // 1. Properties (Case-sensitive)
    this.optParentProperties = parseStr(this.parentProperties);
    this.optChildProperties  = parseStr(this.childProperties);
    this.optFriendProperties = parseStr(this.friendProperties);

    // 2. Tags og Fragmenter (Alltid lowercase for rask, case-insensitiv matching)
    this.optParentTags      = parseStr(this.parentTags).map(t => t.toLowerCase());
    this.optChildTags       = parseStr(this.childTags).map(t => t.toLowerCase());
    this.optFriendTags      = parseStr(this.friendTags).map(t => t.toLowerCase());
    this.optIgnoreFragments = parseStr(this.ignoreNameFragments).map(f => f.toLowerCase());
    this.optIgnoreTags      = parseStr(this.ignoreTags).map(t => t.toLowerCase());
  }
}