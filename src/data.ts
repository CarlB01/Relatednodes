import { BasesEntry, BasesPropertyId, BasesQueryResult, FrontMatterCache, MetadataCache, parseFrontMatterTags, parsePropertyId, TFile, Vault } from "obsidian";
import RelatednodesPlugin from "./main";
import { NoteProperties2 } from "./noteProperties";

type Nodetype = "file" | "other";
export type Relation = "center" | "parent" | "child" | "friend"| "sibling" | "undefined" | "ignored";
export type Direction = "up" | "down" | "left" | "right";

const relationOrder: Record<Relation, number> = {
  "center": 0,
  "parent": 1,
  "child": 2,
  "friend": 3,
  "sibling": 4,
  "undefined": 5,
  "ignored": 6,
}
export interface RelatedNodeGroup {
	key: string;
	isDefined: boolean;
	entries: BasesEntry[];
}

export interface Gate {
	direction: Direction | undefined;
	svg: SVGSVGElement | undefined;
	connections: RelatedNode[];
	unspecified: RelatedNode[];
};

export interface RelatedNode {
	type: Nodetype | undefined;
	tags: string | undefined;
	name: string | undefined;
	basename: string | undefined;
	alias: string | undefined;
	path: string | undefined;
	properties: any[][] | undefined;
	relation: Relation | undefined;
	div: HTMLElement | undefined;
	info: string | undefined;
	ignored: RelatedNode[] | undefined;
	upperGate: Gate;
	lowerGate: Gate;
	friendGate: Gate;
}

const getDefaultNode = (): RelatedNode => ({
	type: undefined,
	tags: undefined,
	name: undefined,
	basename: undefined,
	alias: undefined,
	path: undefined,
	relation: undefined,
	div: undefined,
	info: undefined,
	ignored: undefined,
	upperGate: {
		direction: 'up',
		svg: undefined,
		connections: [],
		unspecified: []
	},
	lowerGate: {
		direction: 'down',
		svg: undefined,
		connections: [],
		unspecified: []
	},
	friendGate: {
		direction: 'left',
		svg: undefined,
		connections: [],
		unspecified: []
	},
	properties: undefined
});

interface NoteProperties {
  relation: string;
  path: string;
  upperGate: any;
	filename: string;
	basename: string;
	aliases: string;
	tags: string;
	properties: [string | undefined, string | undefined][];
}


export class RelatedData {
  private displayAliases = this.plugin.settings!.displayAliases;
  private parentProperties = this.itemsOf(this.plugin.settings!.parentProperties);
  private parentTags = this.itemsOf(this.plugin.settings!.parentTags);
  private childProperties = this.itemsOf(this.plugin.settings!.childProperties);
  private childTags = this.itemsOf(this.plugin.settings!.childTags);
  private friendProperties = this.itemsOf(this.plugin.settings!.friendProperties);
  private friendTags = this.itemsOf(this.plugin.settings!.friendTags);
  private ignoreFragments = this.itemsOf(this.plugin.settings!.ignoreNameFragments);    
  private ignoreTags = this.itemsOf(this.plugin.settings!.ignoreTags);

  centerNode: RelatedNode | undefined;
  siblings: RelatedNode[] = [];
  private allNodes: RelatedNode[] = [];
  private potentialSiblingChildren: [BasesEntry, RelatedNode][] = [];

  private mostRecentActiveFile: TFile | null | undefined;

  constructor(
    private app: {
      workspace: any; metadataCache: MetadataCache; vault: Vault},
      public plugin: RelatednodesPlugin  
  ) {

  }

  update(
    activeFile: TFile | null,
    queryResult: BasesQueryResult, 
    order: BasesPropertyId[] 
  ){
    this.mostRecentActiveFile = activeFile
    this.siblings.length = 0;
    this.allNodes.length = 0;
    this.potentialSiblingChildren.length = 0;
    
    const centernodeFrontmatter = activeFile 
      ? this.app.metadataCache.getFileCache(activeFile)?.frontmatter 
      : null;
 
    this.centerNode = this.buildCenterNode(activeFile!, centernodeFrontmatter!);
    this.allNodes.push(this.centerNode!);

    this.buildFirstDegreeNodes(this.centerNode, centernodeFrontmatter!, queryResult, order)
    
    this.buildSiblingNodes();
  }

  sortedSiblings (): RelatedNode[] {
    return this.siblings
      .sort((a: { relation: string | undefined; }, b: { relation: string | undefined; }) => {
        const orderA = relationOrder[a.relation as Relation] ?? 999;
        const orderB = relationOrder[b.relation as Relation] ?? 999;
        return orderA - orderB;
      })
  };



  // ===================== Update nodestree data =====================

  private buildCenterNode(
    activeFile: TFile, 
    activeFrontMatter: FrontMatterCache
  ): RelatedNode 
  {  
    return this.centerNode = {
      ... getDefaultNode(),
      type: "other",
      relation: "center",
      name: activeFile?.basename 
        ?? this.app.workspace.getMostRecentLeaf()?.view?.getDisplayText() 
        ?? "(??)",
      tags: this.mostRecentActiveFile 
        ? parseFrontMatterTags(activeFrontMatter)?.join(',')
        : "",
      basename: activeFile?.basename ?? "",
      path: activeFile?.path ?? "", 
      ignored: [],
    };
  }

  private buildFirstDegreeNodes(
    centerNode: RelatedNode,
    centerNodefrontmatter: FrontMatterCache,
    queryResult: BasesQueryResult, 
    order: BasesPropertyId[] 
  ){

    for (const group of queryResult.groupedData) {
      const groupKeys = this.itemsOf(group.key?.toString() ?? "");
      
      var nodetype: Nodetype;
      for (const element of group.entries) {
        // avoid additional appearance of same node as center node
        if (element.file.path == this.mostRecentActiveFile?.path) {continue};
  
        // some bases stuff
        for (const propertyName of order) {
          const { type, name } = parsePropertyId(propertyName);
          const value = element.getValue(propertyName);
          if (value == null)  continue;
          (name === 'name' && type === 'file')
            ? nodetype = "file"
            : nodetype = "other";
        }
        
        // What is this note/element's relation to center note?
        const relation = this.findRelation(
          centerNodefrontmatter, 
          null,
          this.centerNode?.basename!,
          element,
          null,
          element.file.basename,
          element.file.path,
          groupKeys
        );

        // What is this note/element's relation to center note?
        

        //prepare parent/child
        const newNode: RelatedNode = {...getDefaultNode(),
          type: "file",
          tags: groupKeys.join(','),
          relation: relation,
          name: element.file.name, 
          basename: element.file.basename,
          alias: this.displayAliases
            ? Array(element.getValue('formula.alias'))[0]?.toString() ?? undefined 
            : undefined,
          path: element.file.path
        }
            
        switch (newNode.relation) {
          case "ignored":
            centerNode.ignored!.push(newNode) ;
            break;
          case "parent": 
            newNode.lowerGate.connections = [centerNode];
            centerNode.upperGate.connections.push(newNode); 
            this.potentialSiblingChildren.push([element, newNode]);
            break;
          case "child": 
            newNode.upperGate.connections = [centerNode];
            centerNode.lowerGate.connections.push(newNode); 
            break;
            case "friend": 
            newNode.friendGate.connections = [centerNode];
            newNode.friendGate.direction = 'right';
            centerNode.friendGate.connections.push(newNode); 
            break;
          default: 
            newNode.upperGate.connections = [centerNode];
            centerNode.lowerGate.unspecified.push(newNode); break;
        }
        this.allNodes.push(newNode);
      }
    }
  }

  private buildSiblingNodes() {

    this.potentialSiblingChildren.forEach(element => {
      element[1].lowerGate.connections = this.nodesRelatedTo(element[0], element[1], "sibling");
    });
  }

  private nodesRelatedTo(primaryElement: BasesEntry, primaryElementNode: RelatedNode, relation: Relation):RelatedNode[] {
    var relatedNodes: RelatedNode[] = [];

    primaryElementNode.ignored = [];

    const secondaries = this.getSecondariesFromElement(primaryElement);
    for (const secondaryNode of secondaries) {
      
      if (this.siblingExists(secondaryNode.basename!)) {continue};
      if (this.otherExists(secondaryNode.basename!)) {continue};

      // of these secondaries we want only siblings
      secondaryNode.relation = this.findRelation(
        null,
        primaryElement, 
        primaryElement.file.basename,
        secondaryNode, 
        null,
        secondaryNode.basename!, 
        secondaryNode.path!,
        this.itemsOf(secondaryNode.tags ?? "")
      );
      
      if (!['ignored', 'child', 'undefined'].includes(secondaryNode.relation)) {
        continue;
      }
      
      if (relation == 'ignored') {
        primaryElementNode.ignored.push(secondaryNode);
      } else {
        secondaryNode.upperGate!.connections = [primaryElementNode];
        relatedNodes.push(secondaryNode);
        this.siblings.push(secondaryNode);
      }
    }
    return relatedNodes;
  }

  private getSecondariesFromElement(element: BasesEntry): RelatedNode[] {
    const value = element.getValue('formula.secondaries')?.toString() ?? "";
    if (!value) return [];

    const filenames = value
      .split(/\r?\n/)
      .map(name => name.trim())
      .filter(name => name.length > 0);
      
    const secondaries: RelatedNode[] = [];

    for (const name of filenames) {
      // Resolve the file
      let file = this.app.vault.getFileByPath(name);
      if (!file) {
        // Fallback if you only have basename
        file = this.app.vault.getFiles().find(f => f.basename === name || f.name === name) ?? null;
      }
      if (!file) continue;

      const cache = this.app.metadataCache.getFileCache(file);
      if (!cache) continue;

      const frontmatter = cache.frontmatter || {};

      let newSecondary: RelatedNode = {...getDefaultNode(),
        type: "file",
        tags: this.itemsOf(frontmatter.tags)[0] ?? "", // or use cache.tags if you want all tags
        name: file.name,
        basename: file.basename,
        alias: this.itemsOf(frontmatter.aliases)[0] ?? "",
        path: frontmatter.path,
        properties: Object.entries(frontmatter)
          .filter(([key]) => !['aliases', 'tags'].includes(key)) // handle specially if needed
          .map(([key, value]) => [key, value]),
        relation: undefined,
        div: undefined,
        info: undefined,
        ignored: undefined,
      };

      secondaries.push(newSecondary);
    }
    return secondaries;
  }


  // ===================== helper functions =====================

  private findRelation(
    a1: FrontMatterCache | null | undefined,
    a2: BasesEntry | null,
    aName: string,
    b1: FrontMatterCache | null | undefined,
    b2: BasesEntry | null,
    bName: string,
    bPath: string,
    bTags: string[]
  ): Relation {

    const noteA = new NoteProperties2(a1, a2);
    const noteB = new NoteProperties2(b1, b2);

    // Early ignore check
    if (this.foundPart(bPath, this.ignoreFragments) || 
        this.checkTags(bTags, this.ignoreTags)) {
        return "ignored";
    }

    // Parent relationship (A links to B as parent OR B links to A as child)
    if (this.checkProperties(noteA, noteB, bName, this.parentProperties) ||
        this.checkProperties(noteB, noteA, aName, this.childProperties)) {
        return "parent";
    }

    // Child relationship
    if (this.checkProperties(noteA, noteB, bName, this.childProperties) ||
        this.checkProperties(noteB, noteA, aName, this.parentProperties)) {
        return "child";
    }

    // Friend relationship
    if (this.checkProperties(noteA, noteB, bName, this.friendProperties) ||
        this.checkProperties(noteB, noteA, aName, this.friendProperties)) {
        return "friend";
    }

    // Tag-based fallbacks
    if (this.checkTags(bTags, this.parentTags)) return "parent";
    if (this.checkTags(bTags, this.childTags)) return "child";
    if (this.checkTags(bTags, this.friendTags)) return "friend";

    return "undefined";
  }

  private checkProperties(
    noteA: NoteProperties2,
    noteB: NoteProperties2,
    basename: string,
    propertiesToLookFor: string[]
  ): boolean {

    if (!propertiesToLookFor?.length) return false;

    return propertiesToLookFor.some(attrib => {
        if (!attrib) return false;

        const values = noteA.getAsArray(attrib);
        return this.foundInlinks(values, basename);
    });
  }

  private siblingExists(basename: string): RelatedNode | null {
    return this.existingNode(this.siblings, basename);
  }

  private otherExists(basename: string): RelatedNode | null {
    return this.existingNode(this.allNodes, basename);
  }

  private existingNode(nodes: RelatedNode[], basename:string): RelatedNode | null {
    const candidate = nodes.find(s => s.basename === basename);
    return (candidate === undefined)
      ? null
      : candidate 
  };

    /**
   * Checks if the given values contain a link to the target basename
   * (handles wikilinks, pipes, commas, etc.)
   */
    private foundInlinks(values: unknown[] | unknown, basename: string): boolean {
      if (values == null) return false;
  
      const normalized = this.normalizeToStringArray(values);
      
      // Fast early exit - cheap string check
      if (!normalized.some(v => v.includes(basename))) {
          return false;
      }
  
      // More precise check after cleaning wikilinks
      return normalized
          .map(this.cleanLink)
          .includes(basename);
    }
  
    /**
     * Normalizes any input (string, array, null, etc.) into a clean string array
     */
    private normalizeToStringArray(input: unknown): string[] {
        if (input == null) return [];
  
        // If it's already an array, process each item
        if (Array.isArray(input)) {
            return input
                .flatMap(item => this.splitAndClean(item))
                .filter(Boolean);
        }
  
        // Single value (string, number, etc.)
        return this.splitAndClean(input);
    }
  
    /**
     * Splits by comma and cleans each part (handles wikilinks with | )
     */
    private splitAndClean(value: unknown): string[] {
      if (value == null) return [];
  
      const str = String(value).trim();
      if (!str) return [];
  
      return str.split(',')
          .flatMap(part => this.extractLinkTargets(part))
          .filter(Boolean);
    }
  
    /**
     * Handles both [[Link]] and [[Link|Display Text]] → returns clean link targets
     */
    private extractLinkTargets(text: string): string[] {
        const trimmed = text.trim();
        if (!trimmed) return [];
  
        // Split on pipe (|) and take the first part (the actual link target)
        const segments = trimmed.split('|').map(s => s.trim());
  
        return segments.map(segment => this.trimWikilinks(segment));
    }
  
    /**
     * Removes [[ and ]] from both sides
     */
    private trimWikilinks(str: string): string {
        if (typeof str !== 'string' || !str) return '';
  
        return str
            .trim()
            .replace(/^\[+/, '')   // remove one or more [ at start
            .replace(/\]+$/, '')   // remove one or more ] at end
            .trim();
    }
  
    /**
     * Optional: Cleaner alias for trimWikilinks if you prefer the name
     */
    private cleanLink = (str: string): string => this.trimWikilinks(str);
  
  
    private processStringOrArray(input: string | string[] | null | undefined): string[] {
      if (input == null) return [];
  
      // Convert input to array if it's a single string
      const items = Array.isArray(input) && input.every(item => typeof item === 'string') 
        ? input.map(s => s.trim())
        : typeof input === 'string' 
          ? input.split(',').map(s => s.trim())
          : []
  
      return items
        .flatMap(part => {
          // Split by '|' if present
          const segments = part.includes('|') 
            ? part.split('|').map(s => s.trim())
            : [part];
  
        // Trim wikilinks [[ ]] from each segment
        return segments.map(this.trimWikilinks);
      })
      .filter(Boolean);   // remove empty strings
  }
  
    private checkTags(taggedWith: string[],
                  wantedTags: string[]): boolean {
      //tagged with any of the wanted tags
      const taggedWithSet = new Set(taggedWith ?? []);
      if (wantedTags.some(tag => taggedWithSet.has(tag))) {
        return true;
      }
      return false;
    };


      private checkNoteProperties(noteProperties: NoteProperties,
                    linktoName: string, 
                    propertiesToLookFor: string[]): boolean {
        
        //const getValue = (probe: string) => propertiesToCheck.find(p => p[0] === probe)?.[1]; 
    
        return propertiesToLookFor.some(attrib => {
          if (!attrib) return false;
    
          //has any of the wanted properties?
          const values = noteProperties.properties;
          if (values == null) return false;
    
          //the property points to linktoName?
          if (Array.isArray(values)) {
            return values.some(v => String(v).includes(linktoName));
          }
          return false;
        });    
      };
    
      private checkFrontmatterCache(frontmatter: FrontMatterCache | null | undefined,
                    baseName: string, 
                    propertiesToLookFor: string[]): boolean {
        
        return propertiesToLookFor.some(attrib => {
          if (!attrib) return false;
    
          //has any of the wanted properties?
          const values = frontmatter?.[attrib];
          return this.foundInlinks(values, baseName);
        });    
      };
    
      private checkFrontmatterElements(element: BasesEntry,
                    baseName: string, 
                    propertiesToLookFor: string[]): boolean {
        
        return propertiesToLookFor.some(attrib => {
          if (!attrib) return false;
    
          //has any of the wanted properties?
          const values = element.getValue(`note.${attrib}`) as string | null;
          return this.foundInlinks(values, baseName);
        });    
    
      };
    
      private foundPart(text: string, wantedParts: string | string[]): boolean {
        if (!text) return false;
        const lowerText = text.toLowerCase();
    
        const parts = Array.isArray(wantedParts) ? wantedParts : [wantedParts];
    
        return parts.some(part => 
            part && lowerText.includes(part.toLowerCase())
        );
      }
    
      public itemsOf(value: unknown): string[] {
        if (value == null) return [];
    
        const str = String(value).trim();
        if (!str) return [];
    
        return str.split(',')
          .flatMap(part => part.trim())
          .filter(Boolean);
      }
}