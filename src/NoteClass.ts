import { CachedMetadata, parseFrontMatterAliases, parseFrontMatterStringArray, parseFrontMatterTags, TFile } from "obsidian";
import { GateProperties } from "./GateClass";
import { StringUtils } from "./StringUtils";
import { DOMUtils } from "./DOMUtils";
import { superChargedLinkAttribs } from "./main";

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
type Notetype = "file" | "other";

export class NoteClass {
  private readonly linkDivDescr = 'rv-linkDiv';
  
  // characteristics

  used: boolean = false; // flag for re-use

  connectionCount: number = 0;
  sharedLinksWithStart: number = 0;
  degree: 'zero' | 'first' | 'second' = 'zero';
  type: Notetype = 'file';
	relation: Relation = 'undefined';
  displayText: string;
	info: string = "";
  
  // link to created element
  div?: HTMLElement;
  
  // file properties
  file: TFile;
  filename: string;
  basename: string;
  aliases: string[];
  tags: string[];
  properties: Record<string, any> = {};
	
  // connections
	ignored: NoteClass[] = [];
  siblings: NoteClass[] = []; // En ren liste for ruting til høyre kvadrant
	upperGate: GateProperties = new GateProperties(this, 'up');
	lowerGate: GateProperties = new GateProperties(this, 'down');
	friendGate: GateProperties = new GateProperties(this,'left');
  
  constructor(useAlias: boolean, file: TFile, cached: CachedMetadata) {

    const frontmatter = cached.frontmatter ?? {};

    this.file = file;
    this.filename = file.name;
    this.basename = file.basename;
    this.properties = frontmatter,
    this.aliases = parseFrontMatterAliases(frontmatter) ?? [],
    this.tags = parseFrontMatterTags(frontmatter) ?? [],
    this.displayText = useAlias
      ? this.aliases?.[0] ?? this.basename
      : this.basename
  }

  /** Determine if a link to another note exists in its frontmatter.
   * @param otherNote 
   * @param propertiesToLookFor The user defined properties of interest.
   * @returns true if a link to otherNote is found in own properties.
   */
  linksTo(otherNote: NoteClass, propertiesToLookFor: string[]): boolean {  
    if (!propertiesToLookFor?.length || !otherNote) return false;

    const targetName = otherNote.basename;

    for (const attrib of propertiesToLookFor) {
        if (!attrib) continue; 

        // Hent arrayen (returnerer [] hvis egenskapen ikke finnes)
        const values = parseFrontMatterStringArray(this.properties, attrib) ?? [];
        
        // Hvis vi finner en kobling, avbryter vi løkken umiddelbart
        if (values.length > 0 && this.foundInProperty(targetName, values)) {
            return true; 
        }
    }
    return false;
  }

  /** Checks if a file link exists in this property
   * (handles wikilinks, pipes, commas, etc.)
   * @param itemToFind 
   * @param propertyToSearch 
   * @returns true if the given property contains an itemString
   */
  private foundInProperty(itemToFind: string, propertyToSearch: unknown[] | unknown): boolean {
    if (propertyToSearch == null) return false;

    const normalizedStringArray = StringUtils.normalizeToStringArray(propertyToSearch);
    
    // Fast early exit - cheap string check
    if (!normalizedStringArray.some(v => v.includes(itemToFind))) {
        return false;
    }

    // More precise check after cleaning wikilinks
    return normalizedStringArray
        .map(StringUtils.cleanLink)
        .includes(itemToFind);
  }

  private uniqueAnchor(basename: string): string {
    return `--${basename.replace(/[^a-zA-Z0-9]/g, '').trim()}`;
  }

  /**
   * Oppretter eller gjenbruker det visuelle note-elementet i DOM-en
   * med friendGate-div plassert i henhold til direction 'left' eller 'right'.
   */
  public render(): HTMLElement {
  
    let div = this.div;
      
    // 1. REUSE or CREATE?
    if (div) {
      // REUSE: Tøm den for gamle knapper/tekst slik at vi kan bygge innholdet friskt
      div.innerHTML = "";
      div.className = this.linkDivDescr;
    } else {
      // CREATE: Hvis den ikke finnes i cachen i det hele tatt, oppretter vi den
      div = createDiv({ cls: this.linkDivDescr});
      this.div = div;
    }

    // 2. Bygg a.link
    const el = createEl('a', { 
        text: this.displayText,
        cls: `focusable-note-link internal-link relatednotes-text ${superChargedLinkAttribs}`,
        attr: {
            'data-href': this.filename,
            'draggable': 'true',
            'data-link-tags': this.tags ? this.tags.join(' ') : "",
            'data-link-path': this.filename
        }
    });
    
    // 3. Info-knapp logikk
    /*const ignored = this.ignored?.length ?? 0;
    if (ignored > 0) {
        const anchor = this.uniqueAnchor(this.basename);
        const button = div.createDiv(`${DOMUtils.infobuttonDescr} bordered-div rounded-div`);
        button.textContent = '𝚒';
        button.style.anchorName = anchor;
    }
    
    */

    // 3. GENERER ALLE PORTER (Alltid klar for fremtidige koblinger!)
    this.upperGate.svg = this.upperGate.render();
    this.lowerGate.svg = this.lowerGate.render();
    this.friendGate.svg = this.friendGate.render();

    // 4. STRUKTURER INNSIDEN AV FLEXBOXEN
    // Øvre og nedre port har position: absolute, så rekkefølgen deres i appendChild 
    // betyr ingenting for layouten. Vi legger dem inn først som et bunnlag.
    div.appendChild(this.upperGate.svg);
    div.appendChild(this.lowerGate.svg);

    const friendSVG = this.friendGate.svg;
    const isLeftFriend = this.friendGate.direction === 'left'
    
    if (isLeftFriend) {
      // Venstre side: [ FriendGate ] [ Tekst-lenke ]
      div.appendChild(friendSVG); 
      div.appendChild(el);
    } else {
      // Høyre side (og topp/bunn): [ Tekst-lenke ] [ FriendGate ]
      div.appendChild(el);
      div.appendChild(friendSVG);
    }

    return div;
  }
}
