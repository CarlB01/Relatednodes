import { TFile, CachedMetadata, parseFrontMatterAliases, parseFrontMatterTags } from "obsidian";
import { RV } from "./constants.js";
import { StringUtils } from "./StringUtils.js";
import { Anchor } from "./Anchor.js";
import { Gate } from "./Gate.js";

export type Relation = "center" | "parent" | "child" | "friend"| "sibling" | "undefined" | "undefined-sibling" | "ignored";

export class Node {  
  connectionCount: number = 0;
  sharedLinksWithStart: number = 0;
  info: string = "";
  path: string;
  basename: string;
  displayText: string;
  readonly aliases: string[];
  readonly tags: string[]; // Sanitized in lowercase keys for high-velocity O(1) matching passes  
  readonly isInitiallyIgnored: boolean;

  // ==========================================================================
  // PRODUCTION REFACTOR: Replaces unsafe 'any' signatures with Obsidian's core
  // FrontMatterCache interface definition to pass gallery validations cleanly [dan].
  // ==========================================================================
  readonly rawFrontmatter: import("obsidian").FrontMatterCache | null;
  
  isUsed: boolean = false; // Lifecycle flag managing item element instance recycling
  public isIndexedInThisRound: boolean = false; // Typesafe JIT pass flag tracking JIT passes safely
  
  // Evaluation stamps instructing rendering quadrants and structural collection buckets
  relation: Relation = "undefined";
  discoverySource: "frontmatter-kriterium" | "frontmatter-udefinert" | "bodytext" = "bodytext";
  assignedArea: "upper" | "lower" | "left" | "right" | "center" | "ignored" = "lower";

  // Connections memory arrays
  public crossingBaits = new Set<Anchor>();
  
  // Anchor port definitions
  upperGate: Gate;
  lowerGate: Gate;
  friendGate: Gate;
  
  public linkDivRef: HTMLElement | null = null;
  public div: HTMLElement | null = null;
  
  // Specialized structural memory sets
  relations = {
    parents: new Set<Node>(),
    children: new Set<Node>(),
    friends: new Set<Node>(),
    ignored: new Set<Node>()
  };

  constructor(
    path: string, 
    basename: string, 
    displayText: string, 
    aliases: string[], 
    tags: string[], 
    isInitiallyIgnored: boolean,
    frontmatter: import("obsidian").FrontMatterCache | null
  ) {
    this.path = path;
    this.basename = basename;
    this.displayText = displayText;
    this.aliases = aliases;
    this.tags = tags;
    this.isInitiallyIgnored = isInitiallyIgnored;
    this.rawFrontmatter = frontmatter;

    // Lateral GATE starts defaulted to the 'left' vector, but can be updated via render calculations
    this.upperGate  = new Gate(this, 'up');
    this.lowerGate  = new Gate(this, 'down');
    this.friendGate = new Gate(this, 'left');
  }

  /**
   * Static factory builder parsing core Obsidian structures to compile concrete Node models.
   */
  public static createFromObsidian(
    file: TFile, 
    cache: CachedMetadata, 
    useAlias: boolean,
    optIgnoreFragments: string[],
    optIgnoreTags: string[]
  ): Node {
    const path = file.path;
    const basename = file.basename;
    const frontmatter = cache.frontmatter || null;

    const nativeAliases = parseFrontMatterAliases(frontmatter) ?? [];
    const nativeTags = parseFrontMatterTags(frontmatter) ?? [];
    const cleanLowercaseTags = nativeTags.map(tag => tag.trim().toLowerCase());

    const displayText = useAlias ? (nativeAliases?.[0] ?? basename) : basename;

    const isIgnored = StringUtils.foundPart(path, optIgnoreFragments) || 
                      StringUtils.hasAnyOf(cleanLowercaseTags, optIgnoreTags);

    return new Node(path, basename, displayText, nativeAliases, cleanLowercaseTags, isIgnored, frontmatter);
  }

  /**
   * Generates or safely recycles individual target node elements inside the physical DOM window.
   * Handles relative direction adjustments dynamically preceding element appending.
   */
  public render(): HTMLElement {
    let itemDiv = this.div;
      
    // 1. REUSE OR CREATE STATE
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

    // 3. EVALUATE GEOMETRICAL GATE ORIENTATION
    if (this.assignedArea === "left") {
      this.friendGate.direction = 'right'; // Routes friend links inward toward the center layout axis
    } else {
      this.friendGate.direction = 'left';  // Standard default for upper, lower, and core nodes
    }
    
    // 4. INJECT THREE INDIVIDUAL PORT VECTOR ELEMENTS
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
