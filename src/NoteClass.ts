import { CachedMetadata, parseFrontMatterAliases, parseFrontMatterStringArray, parseFrontMatterTags, TFile } from "obsidian";
import { GateProperties } from "./GateClass";
import { StringUtils } from "./StringUtils";
import { BaitClass } from "./BaitClass";
import { RV } from "./constants";

/**
 * UNDEFINED: fungerer i praksis som en elastisk "sekkerelasjon" 
 * som oppfører seg ulikt basert på hvilken runde den ble oppdaget i:
 *  - I første runde: Den er en direkte, uklassifisert kobling til senternoten \(\rightarrow \) 
 *     -> Plasseres i bunn (lowerGate) sammen med barn (children). 
 *  - I andre runde: Den er en uklassifisert kobling til en av foreldrene 
 *    (men ikke en venn eller forelder av forelderen). 
 *     -> Plasseres til høyre (siblingGate) sammen med søsken (siblings).
 */
export type Relation = "center" | "parent" | "child" | "friend"| "sibling" | "undefined" | "ignored";

export class NoteClass {  
  connectionCount: number = 0;
  sharedLinksWithStart: number = 0;
	info: string = "";
  path: string;
  basename: string;
  displayText: string;
  readonly aliases: string[];
  readonly tags: string[]; // Ferdig vasket i lowercase for lynrask matching!  
  readonly isInitiallyIgnored: boolean
  readonly rawFrontmatter: any;
  
  isUsed: boolean = false; // flag for re-use
  isIndexedInThisRound: boolean = false; 

  // Stemplene som bestemmer ruting og kolleksjoner
	relation: Relation = "undefined";
  discoverySource: "frontmatter-kriterium" | "frontmatter-udefinert" | "bodytext" = "bodytext";
  assignedArea: "upper" | "lower" | "left" | "right" | "center" | "ignored" = "lower";

  // connections
  public crossingBaits = new Set<BaitClass>();
  
  // De 3 faste portene
  upperGate: GateProperties;
  lowerGate: GateProperties;
  friendGate: GateProperties;
  
  public linkDivRef: HTMLElement | null = null;
  public div: HTMLElement | null = null;
  
  // Relations-sets
  relations = {
    parents: new Set<NoteClass>(),
    children: new Set<NoteClass>(),
    friends: new Set<NoteClass>(),
    siblings: new Set<NoteClass>(),
    ignored: new Set<NoteClass>()
  };

  constructor(
    path: string, 
    basename: string, 
    displayText: string, 
    aliases: string[], 
    tags: string[], 
    isInitiallyIgnored: boolean,
    frontmatter: any | null
  ) {
    this.path = path;
    this.basename = basename;
    this.displayText = displayText;
    this.aliases = aliases;
    this.tags = tags;
    this.isInitiallyIgnored = isInitiallyIgnored;
    this.rawFrontmatter = frontmatter;

    // 'friend' starter som 'left' som standard, men overstyres i render() basert på kvadrant
    this.upperGate  = new GateProperties(this, 'up');
    this.lowerGate  = new GateProperties(this, 'down');
    this.friendGate = new GateProperties(this, 'left');
  }

  public static createFromObsidian(
    file: TFile, 
    cache: CachedMetadata, 
    useAlias: boolean,
    optIgnoreFragments: string[],
    optIgnoreTags: string[]
  ): NoteClass {
    const path = file.path;
    const basename = file.basename;
    const frontmatter = cache.frontmatter || null;

    const nativeAliases = parseFrontMatterAliases(frontmatter) ?? [];
    const nativeTags = parseFrontMatterTags(frontmatter) ?? [];
    const cleanLowercaseTags = nativeTags.map(tag => tag.trim().toLowerCase());

    const displayText = useAlias ? (nativeAliases?.[0] ?? basename) : basename;

    const isIgnored = StringUtils.foundPart(path, optIgnoreFragments) || 
                      StringUtils.hasAnyOf(cleanLowercaseTags, optIgnoreTags);

    return new NoteClass(path, basename, displayText, nativeAliases, cleanLowercaseTags, isIgnored, frontmatter);
  }

  /**
   * Oppretter eller gjenbruker det visuelle note-elementet i DOM-en
   * med friendGate-div plassert i henhold til direction 'left' eller 'right'.
   */
  public render(): HTMLElement {
  
    let itemDiv = this.div;
      
    // 1. REUSE or CREATE
    if (itemDiv) {
      itemDiv.innerHTML = "";
      itemDiv.className = "item"; 
    } else {
      itemDiv = createDiv({ cls: "item"}); 
      this.div = itemDiv;
    }

    const linkWrapper = itemDiv.createDiv({ cls: RV.LINKDIV });

    const linkEl = createEl('a', { 
        cls: `${RV.A} ${RV.SUPERCHARGED_ATTRIB}`,
        attr: {
            'data-href': this.path,
            'draggable': 'true',
            'data-link-tags': this.tags ? this.tags.join(' ') : "",
            'data-link-path': this.path
        }
    });

    linkEl.createSpan( { text: this.displayText, cls: 'rv-text-span'} );

    
    // 3. FRIENDGATE DIRECTION
    if (this.assignedArea === "left") {
      this.friendGate.direction = 'right'; // Vennen peker inn mot høyre (mot center)
    } else {
      this.friendGate.direction = 'left';  // Topp, bunn og senter peker mot venstre flanke standard
    }
    
    // 4. GENERER 3 PORTER
    const topSVG    = this.upperGate.render();
    const bottomSVG = this.lowerGate.render();
    const friendSVG = this.friendGate.render();
    
    this.upperGate.svg  = topSVG;
    this.lowerGate.svg  = bottomSVG;
    this.friendGate.svg = friendSVG;
    
    linkWrapper.appendChild(topSVG);
    linkWrapper.appendChild(bottomSVG);
    
    if (this.friendGate.direction == 'left') {
      linkWrapper.appendChild(friendSVG); 
      linkWrapper.appendChild(linkEl);  
    } else {
      linkWrapper.appendChild(linkEl);  
      linkWrapper.appendChild(friendSVG); 
    }

    this.linkDivRef = linkWrapper; 

    return itemDiv;
  }

}
