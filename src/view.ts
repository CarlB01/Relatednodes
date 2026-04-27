import RelatednodesPlugin, {relatedNodesViewType} from './main';
import { 
    PluginSettingTab, 
    BasesView,
    QueryController,
    HoverPopover,
    parsePropertyId,
    BasesQueryResult,
    BasesPropertyId,
    BasesEntry,
    TFile,
    WorkspaceLeaf,
    Point,
    FrontMatterCache,
    parseFrontMatterTags,
    HoverParent,
} from 'obsidian';
import { Direction, Gate, GATE_DOWN, GATE_LEFT, GATE_RIGHT, GATE_UP, getDefaultNode, LeftTop, Nodetype, NOTE_PROPERTIES, NoteProperties, RelatedNode, Relation, relationOrder } from './settings';

export class RelatedNodesView extends BasesView implements HoverParent {
  
  readonly type = relatedNodesViewType;
  readonly gateColor: string = 'var(--bases-table-header-color)';
  readonly containerDescr = "bases-relatednodes-view-container";
  readonly upperDescr = "bases-relatednodes-upper-region";
  readonly mainLowerDescr = 'bases-relatednodes-lower-main-region';
  readonly lowerDescr = 'bases-relatednodes-lower-region';
  readonly siblingDescr = "bases-relatednodes-sibling-region";
  readonly friendDescr = "bases-relatednodes-friend-region";
  readonly GATE_RADIUS = 2.5;
  private superContainerEl: HTMLElement;
  private containerEl: HTMLElement;
  private backContainerSVG: SVGSVGElement;
  private definedUpper: HTMLElement;
  private friendsContainer: HTMLElement;
  private siblingsContainer: HTMLElement;
  private center: HTMLElement;
  private mainLower: HTMLElement;
  private definedLower: HTMLElement;
  private undefinedLower: HTMLElement;
  private lastFactor = 1;
  private mostRecentActiveFile: TFile | null | undefined;
  private centerNode: RelatedNode | undefined;
  private siblings: RelatedNode[] = [];
  private allNodes: RelatedNode[] = [];
  private offBy: Point | undefined;
  private mousedown: boolean = false;
  hoverPopover: HoverPopover | null = null;
  private displayAliases = this.plugin.settings!.displayAliases;
  private parentProperties = this.itemsOf(this.plugin.settings!.parentProperties);
  private parentTags = this.itemsOf(this.plugin.settings!.parentTags);
  private childProperties = this.itemsOf(this.plugin.settings!.childProperties);
  private childTags = this.itemsOf(this.plugin.settings!.childTags);
  private friendProperties = this.itemsOf(this.plugin.settings!.friendProperties);
  private friendTags = this.itemsOf(this.plugin.settings!.friendTags);
  private ignoreFragments = this.itemsOf(this.plugin.settings!.ignoreNameFragments);    
  private ignoreTags = this.itemsOf(this.plugin.settings!.ignoreTags);

  
  constructor(
    controller: QueryController, 
    parentEl: HTMLElement,
    public plugin: RelatednodesPlugin
  ) {
    super(controller);
    //hide bases toolbar for relatednotes in particular
    this.displayBasesToolbar(parentEl, plugin.settings!.displayBasesToolbar);
    //create a supercontainer
    this.superContainerEl = parentEl.createDiv('bases-relatednodes-super-container');
    
    this.containerEl = this.superContainerEl.createDiv(this.containerDescr);
    
    this.center = this.containerEl.createDiv('bases-relatednodes-center-region');
    
    this.definedUpper = this.containerEl.createDiv(this.upperDescr);
    
    this.friendsContainer = this.containerEl.createDiv(this.friendDescr);
      this.friendsContainer.style.maxHeight = this.plugin.settings?.displayBasesToolbar
      ? 'calc(40% - 60px)'
      : '40%';
        
    this.siblingsContainer = this.containerEl.createDiv(this.siblingDescr);
      this.siblingsContainer.style.maxHeight = this.plugin.settings?.displayBasesToolbar
      ? 'calc(40% - 60px)'
      : '40%';

    this.mainLower = this.containerEl.createDiv(this.mainLowerDescr);
    this.mainLower.style.position = 'absolute';
    this.mainLower.style.width = '100%';
    this.mainLower.style.positionAnchor = '--centerContainer';
    this.mainLower.style.top = "anchor(bottom)";
    this.mainLower.style.overflow = 'auto';

      
    this.definedLower = this.mainLower.createDiv(this.lowerDescr);
    
    this.undefinedLower = this.mainLower.createDiv(this.lowerDescr);
    this.backContainerSVG = this.containerEl.createSvg("svg", {
      attr: {
        width: "100%",
        height: "100%",
        style: `position: absolute; z-index: 0; left: ${window.pageXOffset}; top: ${window.pageYOffset}; `
      }
    });
  }
  
  public onload(): void {


    this.app.workspace.onLayoutReady(() => {

      if (this.containerEl) {
        
        // is mouse pressed/released over a resize handle?
        this.registerDomEvent(document, 'mousedown', (evt:MouseEvent) => {
          const target = evt.target as HTMLElement;
          if (target.matches('.workspace-leaf-resize-handle')) {
            this.mousedown = true;
            this.backContainerSVG.style.visibility = 'hidden';
          } else { // if (target.matches('.bases-view')) {
            //evt.stopPropagation();
            //evt.preventDefault();
            //this.app.workspace.setActiveLeaf(view as any);            
          }
        });
        this.registerDomEvent(document, 'mouseup', (evt:MouseEvent) => {
          const target = evt.target as HTMLElement;
          if (target.matches('.workspace-leaf-resize-handle')) {
            this.handleResize();
            this.backContainerSVG.style.visibility = 'visible';
          }  
        });
        this.registerDomEvent(document, 'resize', this.handleResize);

        // set initial info text
        const popup = createDiv();
        popup.innerHTML = `<p>notes RELATED</p><p>to view related notes, please open one of your notes first</p>`;
        popup.style.position = 'absolute';
        popup.style.textAlign = 'right';
        popup.style.alignSelf = 'right';
        this.center.appendChild(popup);
        this.containerEl.addClass("active");
      }
    });
  }

  // onDataUpdated is called by Obsidian whenever there is a configuration
  // or data change in the vault which may affect your view.
  public onDataUpdated(): void {
    const { app } = this;
    this.mostRecentActiveFile = app.workspace.getActiveFile();

    if (this.mostRecentActiveFile) {
      if (this.mostRecentActiveFile.extension === 'base') {    
        const lastMDLeaf = this.app.workspace.getLeavesOfType('markdown')[0];
        if (lastMDLeaf) {
          this.app.workspace.setActiveLeaf(lastMDLeaf, { focus: false });    
        }
        return;
      }
    };

    this.buildRelatedNotesView()

    //this.diagonalLine(this.app.workspace.containerEl.parentElement,"yellow",12);
    
    //this.diagonalLine(this.superContainerEl.parentElement?.parentElement?.parentElement, "red", 7);
    //this.diagonalLine(this.superContainerEl.parentElement?.parentElement, "blue", 5);
    //this.diagonalLine(this.superContainerEl.parentElement, "green", 3);
    //this.diagonalLine(this.containerEl, "red", 1);

    // all plotted - update scale
    //this.updateScale(this.definedUpper, this.center, this.mainLower);
  }

  async onExternalSettingsChange() {
		this.buildRelatedNotesView()
	};

  private buildRelatedNotesView() {
    const order = this.config.getOrder()
    const propertySeparator = String(this.config.get('separator')) || ' - ';
    const defaultCollapsed = (String(this.config.get('collapsed')) || 'yes' == 'yes') ? true : false;

    this.siblings.length = 0;
    this.allNodes.length = 0;
    this.filteredBasesEntries(this.data, order);
    
    // Clear entries created by previous iterations. Remember, you should
    // instead attempt element reuse when possible.
    this.siblingsContainer.empty();
    this.friendsContainer.empty();
    this.center.empty();
    this.definedUpper.empty();
    this.definedLower.empty();
    this.undefinedLower.empty()
    this.offBy = this.measureOffDim();
    
    //update center file properties
    this.containerEl.toggleVisibility(false);
    this.containerEl.style.setProperty('--scaleFactor', '1');

    //upper region
    this.plotRegion(this.definedUpper,this.centerNode!.upperGate.connections);
    this.plotRegion(this.siblingsContainer,this.siblings
      .sort((a, b) => {
        const orderA = relationOrder[a.relation as Relation] ?? 999;
        const orderB = relationOrder[b.relation as Relation] ?? 999;
        return orderA - orderB;
      })
    );
    this.plotRegion(this.friendsContainer, this.centerNode!.friendGate.connections);

    // middle region
    this.plotCenterRegion(this.center, this.centerNode!);

    //lower region 
    this.plotRegion(this.definedLower, this.centerNode!.lowerGate.connections);
    this.plotRegion(this.undefinedLower, this.centerNode!.lowerGate.unspecified);

    // resize check
    this.lastFactor = this.scaleFactor(this.definedUpper, this.center, this.mainLower);
    if (this.lastFactor < 1) {
      //will trigger resize
      this.containerEl.style.setProperty('--scaleFactor', this.lastFactor.toFixed(2));
    }
    
    // completed drawing - make visible changes
    this.containerEl.toggleVisibility(true);
    this.connectionsDrawGates([this.centerNode!]);
    this.connectionsDrawGates(this.centerNode!.upperGate?.connections);
    this.connectionsDrawGates(this.centerNode!.lowerGate?.connections);
    this.connectionsDrawGates(this.centerNode!.lowerGate?.unspecified);
    this.connectionsDrawGates(this.siblings);
    this.connectionsDrawGates(this.centerNode!.friendGate?.connections);

    this.backContainerSVG.empty()
    this.connectNodes(this.centerNode!);
    this.connectSiblingNodes(this.siblings);
  }

  // traverse baseQueryResult and build display data arrays
  // GroupKeyArray is discarded, only first item is kept
  // regroup nodes based on first tag of tags in a node
  private filteredBasesEntries(queryResult: BasesQueryResult, order: BasesPropertyId[] )
  {
    let af = this.mostRecentActiveFile;
    const centerNotefrontmatter = af ? this.app.metadataCache.getFileCache(af)?.frontmatter : null;
 
    this.centerNode = {
      ... getDefaultNode(),
      type: "other",
      relation: "center",
      name: af?.basename ?? this.app.workspace.getMostRecentLeaf()?.view?.getDisplayText() ?? "(??)",
      key: this.mostRecentActiveFile ? parseFrontMatterTags(centerNotefrontmatter)?.join(','): "",
      basename: af?.basename ?? "",
      path: af?.path ?? "", 
    };
    this.allNodes.push(this.centerNode);

    this.centerNode.ignored = [];
    var potentialSiblingChildren: [BasesEntry, RelatedNode][] = [];

    // parse groups of BaseEntry items into RelatedNode items
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
        const relation = (): Relation => {
          // ignore these
          return this.foundPart(element.file.path,this.ignoreFragments)
          || (this.checkTags(groupKeys, this.ignoreTags))
            ? "ignored"
            // parent points to child?
            : this.checkFrontmatterCache(centerNotefrontmatter, element.file.basename, this.parentProperties) 
              //child points to parent?   
              || this.checkFrontmatterElements(element, this.centerNode?.basename!, this.childProperties) 
              ? "parent"
              : this.checkFrontmatterCache(centerNotefrontmatter, element.file.basename, this.childProperties) 
                || this.checkFrontmatterElements(element, this.centerNode?.basename!, this.parentProperties) 
                ? "child" 
                : this.checkFrontmatterCache(centerNotefrontmatter, element.file.basename, this.friendProperties) 
                  || this.checkFrontmatterElements(element, this.centerNode?.basename!, this.friendProperties) 
                  ? "friend" 
                  : this.checkTags(groupKeys, this.parentTags) 
                    ? "parent"
                    : this.checkTags(groupKeys, this.childTags)
                      ? "child"
                      : this.checkTags(groupKeys, this.friendTags)
                        ? "friend"
                        : "undefined"
        }

        //prepare parent/child
        const newNode: RelatedNode = {...getDefaultNode(),
          type: "file",
          key: groupKeys.join(','),
          relation: relation(),
          name: element.file.name, 
          basename: element.file.basename,
          alias: this.displayAliases
            ? Array(element.getValue('formula.alias'))[0]?.toString() ?? undefined 
            : undefined,
          path: element.file.path
        }
            
        switch (newNode.relation) {
          case "ignored":
            this.centerNode.ignored.push(newNode) ;
            break;
          case "parent": 
            newNode.lowerGate.connections = [this.centerNode];
            this.centerNode.upperGate.connections.push(newNode); 
            potentialSiblingChildren.push([element, newNode]);
            break;
          case "child": 
            newNode.upperGate.connections = [this.centerNode];
            this.centerNode.lowerGate.connections.push(newNode); 
            break;
          case "friend": 
            newNode.friendGate.connections = [this.centerNode];
            newNode.friendGate.direction = 'right';
            this.centerNode.friendGate.connections.push(newNode); 
            break;
          default: 
            newNode.upperGate.connections = [this.centerNode];
            this.centerNode.lowerGate.unspecified.push(newNode); break;
        }
        this.allNodes.push(newNode);
      }
    }

    potentialSiblingChildren.forEach(element => {
      element[1].lowerGate.connections = this.findRelatedNodes2(element[0], element[1], "sibling");
    });
    //return this.mergeByKey(nodeGroups).sort((a, b) => (b.entries.length - a.entries.length)>0?-1:1);
  }

  private findRelatedNodes2(primaryElement: BasesEntry, primaryElementNode: RelatedNode, relation: Relation):RelatedNode[] {
    var relatedNodes: RelatedNode[] = [];

    primaryElementNode.ignored = [];

    const secondaries = this.getSecondariesFromElement(primaryElement);

    for (const noteProperty of secondaries) {
      
      const foundSibling = this.existingNode(this.siblings, noteProperty.basename);
      if (foundSibling) {
        continue;
      };
      const foundOther = this.existingNode(this.allNodes, noteProperty.basename);
      if (foundOther) {
        continue;
      };
      
      // of these secondaries we want only siblings
      
      // parent points to child?
      const secondary = this.checkFrontmatterElements(primaryElement, noteProperty.basename, this.parentProperties)
            || this.checkNoteProperties(noteProperty, primaryElement.file.basename, this.childProperties)
        ? "parent"
        : this.checkFrontmatterElements(primaryElement, noteProperty.basename, this.childProperties)
          || this.checkNoteProperties(noteProperty, primaryElement.file.basename, this.parentProperties)
          ? "child"
          : this.checkTags(this.itemsOf(noteProperty.tags), this.parentTags) 
            ? "parent"
            : this.checkTags(this.itemsOf(noteProperty.tags), this.childTags)
              ? "child"
                // ignore these
              : this.checkFrontmatterElements(primaryElement, primaryElement.file.basename, this.ignoreFragments)
                || (this.checkTags(this.itemsOf(noteProperty.tags), this.ignoreTags))
                ? "ignored"
                :"undefined";
                
      if ((secondary != 'ignored') && (secondary != 'child') && (secondary != 'undefined')) {
        continue;
      }

      const sibling: RelatedNode = {...getDefaultNode(),
        type: "file",
        key: noteProperty.tags,
        relation: relation,
        name: noteProperty.filename, 
        basename: noteProperty.basename,
        alias: Array(noteProperty.aliases)[0] ?? undefined
      }
      if (secondary == 'ignored') {
        primaryElementNode.ignored.push(sibling);
      } else {
        sibling.upperGate.connections = [primaryElementNode];
        relatedNodes.push(sibling);
        this.siblings.push(sibling);
      }
    }
    return relatedNodes;
  }

  private existingNode(nodes: RelatedNode[], basename:string): RelatedNode | null {
    const candidate = nodes.find(s => s.basename === basename);
    return (candidate === undefined)
      ? null
      : candidate 
  };

  private getSecondariesFromElement(element: BasesEntry): NoteProperties[]  {
        
    const preSecondaries = element.getValue('formula.secondaries')?.toString().split('||');
    const values: NoteProperties[] = [];

    preSecondaries?.forEach(block => {
      const [filename, propsString] = block.split('$$');
      if (filename == "") {return};
      
      const newSecondary: NoteProperties = {...NOTE_PROPERTIES,
        filename: filename!,
        basename: filename!.replace(/\.[^/.]+$/, "")
      };
      newSecondary.properties = (propsString ?? "")
        .replace(/^\{\}|^\{/, '')
        .replace(/\}, $|\},$|\}$/, '') 
        .split('","')
        .map(pair => {
          const [prekey, prevalue] = pair.split('":"');
          const key = prekey?.replace(/\"/g, '').trim();
          const value = prevalue?.replace(/\"/g, '').trim();
          if (key == 'tags') {
            newSecondary.tags = value!
            return ["",""]
          } else if (key == 'aliases') {
            newSecondary.aliases = value!
            return ["",""]
          } else {
            return [key, value];
          }
        });
      values.push(newSecondary);
    });
    return values;
  }

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

  private foundInlinks(values: string | null, basename: string): boolean {
    if (values == null) return false;

    const strValue = String(values).trim();

    if (!strValue) return false;

    // Fast preliminary check (cheap)
    if (!strValue.includes(basename)) {
      return false;
    }

    // Exact check with proper wikilink + pipe handling
    return this.processStringOrArray(strValue).includes(basename);
    }

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

  // Helper function to trim [[ and ]]
  private trimWikilinks(str: string): string {
  if (typeof str !== 'string' || !str) return '';
      return str
      .trim()
      .replace(/^\[\[+/ , '')   // remove [[ at start
      .replace(/\]\]+$/ , '')   // remove ]] at end
      .trim();
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

  // Plot center region
  private plotCenterRegion (centerRegion: HTMLElement, node: RelatedNode) {
    const middleDiv = centerRegion.createDiv('bases-relatednodes-center-content');
    const textFormat = 'relatednotes-text';

      node.div = this.buildFileLink(middleDiv, node, textFormat);
      const ignored = node.ignored?.length ?? 0;
      if (ignored > 0) {
        this.buildInfoHover(node.div,
          "𝚒",
          "Info", 
          `<ul><li>ignored ${ignored} notes</li></ul>`,
          `--${node.basename!.replace(/[^a-zA-Z0-9]/g, '').trim()}`
        );
    ;
        //const myButton = node.div.createEl('button', { text: 'Hover me' });
        //setTooltip(myButton, `ignored ${ignored} notes`);
      } 
  }

  // Plot Region
  private plotRegion (thisRegion: HTMLElement,
                    filteredData: RelatedNode[]) {
    // collective collapse all button
    //this.plotCollapseAllBtn(defaultCollapsed, thisRegion);
    const groupDivInfo = 'bases-relatednodes-group bordered-div rounded-div';
    const itemInfo = 'bases-list-entry bordered-div rounded-div';
    const textFormat = thisRegion.hasClass(this.siblingDescr)
      ? 'relatednotes-compact'
      : 'relatednotes-text';
    // Single entries
    for (const node of filteredData) {
      thisRegion.createDiv(itemInfo, (el) => {
        if (node.type == "file") {
          node.div = this.buildFileLink(el, node, textFormat);
          const ignored = node.ignored?.length ?? 0;
          if (ignored > 0) {
            this.buildInfoHover(node.div,
              "𝚒",
              "Info", 
              `<ul><li>ignored ${ignored} notes</li></ul>`,
              `--${node.basename!.replace(/[^a-zA-Z0-9]/g, '').trim()}`
            );
          } 
        } else {
          node.div = el.createSpan({
            cls: 'bases-list-entry-property',
            text: node.name
          });
        }
      });
    }
    // decide maxColumns
    const columns = () => {
      return filteredData.length == 1
        ? 1
        : filteredData.length < 6
          ? 2
          : thisRegion.hasClass(this.upperDescr)
          ? 2
          : filteredData.length < 13
            ? 3
            : filteredData.length < 17
              ? 4
              : 5;
    }
    thisRegion.style.setProperty('--columns', columns().toString());

  }

  //build file link with onclick event etc.
  private buildFileLink (parent: HTMLElement, node: RelatedNode, format: string): HTMLElement {
    const linkEl = parent.createEl('a', { 
      text: node.alias ? node.alias : node.basename,
      cls: `internal-link data-link-icon data-link-icon-after data-link-text ${format}`,
      attr: {
        'z-index': 5,
        'data-href': node.name!,
        'draggable': 'true',
        'data-link-tags': node.key!, // '#han #lege #psykiater #phD',
        'data-link-data-href': node.basename!,
        'data-link-path': node.path!
      }
    });
    linkEl.onClickEvent((evt) => {
      const { target } = evt;
      if (!target || !(target instanceof HTMLAnchorElement)) {
        return;
      }

      // Check if it's an internal link
      const internalLink = target.getAttribute('data-href');
      if (!internalLink) {
        return;
      }

      // Optional: use a modifier key (e.g., Ctrl/Cmd + Shift + Click) to trigger this logic
      // if (!evt.ctrlKey && !evt.metaKey && !evt.shiftKey) return; 

      //evt.preventDefault(); // Prevent default link opening behavior

      this.openLinkInAdjacentPane(internalLink);
      //this.forceRefreshByLeafSwitch();
    });
    linkEl.addEventListener('mouseover', (evt) => {
      this.app.workspace.trigger('hover-link', {
        event: evt,
        source: 'bases',
        targetEl: linkEl,
        linktext: node.path,
      });
    });

    return linkEl;
  }

  private buildInfoHover (parent: HTMLElement, 
            buttonText: string,
            title: string, 
            text: string, 
            infoAnker: string)
  {
    const padding = 'calc(4px * var(--scaleFactor))';
    const button = parent.createDiv();
    button.style.anchorName = infoAnker;
    button.textContent = buttonText;
    button.style.position = 'absolute';
    //button.addClass('relatednotes-text');
    button.style.backgroundColor = 'rgb(from var(--background-primary) r g b)';
	  button.style.boxShadow = '0 1px calc(4px * var(--scaleFactor)) #0008';
	  button.style.padding = `0 ${padding} 0 ${padding}`; /* top right bottom left */
    button.style.border = '1px solid gray';
    button.style.borderRadius = 'calc(8px * var(--scaleFactor))';
    button.style.fontSize = 'calc(10px * var(--scaleFactor))';
    //button.style.borderColor = '#068ef6'
    button.style.left = `calc(100% - 5px)`;
    button.style.top = `calc(100% - 5px)`;
    button.style.zIndex = '101';
/*
    infoEl.onClickEvent((evt) => {
      const { target } = evt;
      if (!target || !(target instanceof HTMLAnchorElement)) {
        return;
      }

      // Check if it's an internal link
      const internalLink = target.getAttribute('data-href');
      if (!internalLink) {
        return;
      }

      // Optional: use a modifier key (e.g., Ctrl/Cmd + Shift + Click) to trigger this logic
      // if (!evt.ctrlKey && !evt.metaKey && !evt.shiftKey) return; 

      evt.preventDefault(); // Prevent default link opening behavior

      this.openLinkInAdjacentPane(internalLink);
    });
*/
    const dialogboxWidth = 150;
    const popup = createDiv({ cls: 'relatednotes-text' });
    button.addEventListener('mouseover', (e) => {
      popup.innerHTML = `<p>${title}</p><p>${text}</p>`;
      popup.style.width = `${dialogboxWidth}px`;
      popup.style.position = 'absolute';
      popup.style.positionAnchor = infoAnker;
      popup.style.top = "anchor(top)";
      popup.style.right = "anchor(left)";
      popup.style.backgroundColor = 'rgb(from var(--background-primary) r g b)';
      this.containerEl.appendChild(popup);
    });
    button.addEventListener('mouseout', () => {
        // Remove the popup
        this.containerEl.removeChild(popup);
    });
  }

  async openLinkInAdjacentPane(linkTarget: string) {
    const activeLeaf = this.app.workspace.activeLeaf;
    if (!activeLeaf) {
        return;
    }

    // 1. Check for an existing adjacent pane (e.g., to the right)
    const adjacentLeaf = this.findAdjacentLeaf(activeLeaf, 'split-right'); // 'split-right' or 'split-offright' depending on layout structure

    let targetLeaf: WorkspaceLeaf;

    if (adjacentLeaf) {
        targetLeaf = adjacentLeaf;
    } else {
        // 2. If no adjacent pane exists, create one
        targetLeaf = this.app.workspace.createLeafBySplit(activeLeaf, 'horizontal', false);
        // this.app.workspace.openLinkText(linkText, '', 'split');
    }

    // 3. Open the file in the target pane
    const file = this.app.metadataCache.getFirstLinkpathDest(linkTarget, '');
    if (file instanceof TFile) {
        await targetLeaf.openFile(file);
        this.app.workspace.setActiveLeaf(targetLeaf); // Optional: focus the pane after opening
    }
  }

  private findAdjacentLeaf(activeLeaf: WorkspaceLeaf, direction: 'split-right' | 'split-left'): WorkspaceLeaf | null {
    // This part is complex because the workspace structure is a tree of splits.
    // A direct API method for "get adjacent leaf" does not exist. 
    // A reliable way is to iterate through all leaves and check their container/position.
    
    // A simpler, more general approach is to find the first *other* leaf that is not the active one
    // or one that matches a specific criteria (e.g., is pinned, or has a specific view type).

    // For a true "adjacent pane" detection in a split layout, you would traverse 
    // the app.workspace.rootSplit and its children, but that is advanced and layout-dependent.
    
    // A common workaround is to check if a *specific* target note is already open
    // and focus that pane instead of creating a new one every time.

    // Example to find any other open markdown leaf:
    const allLeaves = this.app.workspace.getLeavesOfType('markdown');
    const foundLeaf = allLeaves.find(leaf => leaf !== activeLeaf);

    if (foundLeaf) {
        return foundLeaf;
    }
    
    return null;
  }
  
  //calculate scale
  private scaleFactor (area1:HTMLElement, 
                       area2:HTMLElement, 
                       area3:HTMLElement) : number {
    if (area1 && area2 && area3) {
      const totalHeight = 
            area1.getBoundingClientRect().height
          + area2.getBoundingClientRect().height
          + area3.getBoundingClientRect().height;          
      const windowHeight = window.innerHeight-30;
      //return Math.min(windowHeight/totalHeight, 1);
      const fract = windowHeight/totalHeight;
      const smallpart = (1-fract-0.01)/4;
      const minimalval = fract > 1 ? 1 : 0.9
      return Math.min(fract + smallpart, minimalval);
    }
    return 1;
  }

  private measureOffDim() {
    const corner = this.containerEl.getBoundingClientRect()
    const svg = this.containerEl.createSvg("svg", {
      attr: {
        width: "1px",
        height: "1px",
        style: `position: absolute; z-index: -10; top: 0; left: 0; `
      }
    });
    const rect = svg.getBoundingClientRect();
    return {x: rect.x, y: rect.y}

  }

  private displayBasesToolbar(parentEl: HTMLElement, displayHeader: boolean) {
    
    const basesHeader = parentEl.parentElement?.parentElement
      ?.getElementsByClassName("bases-header")[0]
    if (displayHeader) {
      basesHeader?.removeAttribute('bases-header-collapsible')
      basesHeader?.setAttribute("class", 'bases-header');
    } else {
      basesHeader?.setAttribute("class", 'bases-header-collapsible')
    }
      
  }

  private handleResize() {

    this.containerEl.toggleVisibility(false);
    this.containerEl.style.setProperty('--scaleFactor', "1");
    if (this.mousedown) {
      console.log('🐁 handleresize: resett mens mousedown')
    }
    this.mousedown = false;

    this.lastFactor = this.scaleFactor(this.definedUpper, this.center, this.mainLower);
    this.containerEl.style.setProperty('--scaleFactor', this.lastFactor.toFixed(2));
    this.connectNodes(this.centerNode!);
    this.containerEl.toggleVisibility(true);
  }

  public itemsOf(s:string): string[] {
    return s.split(',')
    .map(f => f.trim())
    .filter(f => f.length > 0); 
  }
    

  /** DRAWINGS **************/ 

  private connectNodes(centralNode: RelatedNode) {
     const offset: Point = {
      x: window.pageXOffset-this.offBy!.x, 
      y: window.pageYOffset-this.offBy!.y
    }
    const verticalConnections = [
      ...centralNode.upperGate.connections,
      ...centralNode.lowerGate.connections,
      ...centralNode.lowerGate.unspecified,
    ];

    verticalConnections.forEach(relatedNode => {
      this.connectRects([centralNode, relatedNode], offset, this.backContainerSVG);
    });
    centralNode.friendGate.connections.forEach(relatedNode => {
      this.horisontalConnectRects([centralNode, relatedNode], offset, this.backContainerSVG);
    });
      
  };

  private connectSiblingNodes(siblings: RelatedNode[], ) {
    const offset: Point = {
      x: window.pageXOffset-this.offBy!.x, 
      y: window.pageYOffset-this.offBy!.y
    }

    const c = this.siblingsContainer.getBoundingClientRect();

    siblings.forEach(sibling => {

      const s = sibling.div!.getBoundingClientRect();
      if (s.top > c.bottom || s.top < c.top || s.left > c.right ) {return};

      sibling.upperGate.connections.forEach(conn => {
        this.connectRects([conn!, sibling], offset, this.backContainerSVG);  
      })
    });
  }

  private connectRects(node: [RelatedNode, RelatedNode], offset: Point, svg: SVGSVGElement) {
    
    var upper: number;
    var lower: number;
    
    // determine what gates are to be connected
    if ((node[0].relation == 'center' && node[1].relation == 'child')
      || (node[0].relation == 'center' && node[1].relation == 'undefined')
      || (node[0].relation == 'parent' && node[1].relation == 'sibling')) {
      upper = 0;
      lower = 1;
    } else { // if (node[0].relation == 'center' && node[1].relation == 'parent') {
      upper = 1;
      lower = 0;
    };

    const rect = [
      node[upper]!.lowerGate.svg?.getBoundingClientRect(),
      node[lower]!.upperGate.svg?.getBoundingClientRect()
    ] 
    
    this.drawBezier(
      {
        x: rect[0]!.x + offset.x,
        y: rect[0]!.y + offset.y
      },
      "down",
      {
        x: rect[1]!.x + offset.x,
        y: rect[1]!.y + offset.y
      }, 
      "up",
      svg
    );
  }

  private horisontalConnectRects(node: [RelatedNode, RelatedNode], offset: Point, svg: SVGSVGElement) {
    
    var left: number;
    var right: number;
    
    // determine what gates are to be connected
    if (node[0].relation == 'center' && node[1].relation == 'friend'){
      left = 1;
      right = 0;
    } else { 
      left = 0;
      right = 1;
    };

    const rect = [
      node[left]!.friendGate.svg?.getBoundingClientRect(),
      node[right]!.friendGate.svg?.getBoundingClientRect()
    ] 
    
    this.drawHoriontalBezier(
      {
        x: rect[0]!.x + offset.x,
        y: rect[0]!.y + offset.y
      },
      "left",
      {
        x: rect[1]!.x + offset.x,
        y: rect[1]!.y + offset.y
      }, 
      "right",
      svg
    );
  }

  private drawBezier(p1: Point, dir1: Direction, p2:Point, dir2: Direction, svg: SVGSVGElement) {

    var c1: Point = {x: p1.x, y: 0};
    var c2: Point = {x: p2.x, y: 0};
    
    const ydiff = p2.y-p1.y;

    if ((ydiff >= -10) && (dir1 == 'down')) {
      c1.y = (p1.y + Math.max(ydiff, 60)*0.75);
      c2.y = (p2.y - Math.max(ydiff, 60)*0.75);
    } else if ((ydiff < -10) && (dir1 == 'down')) {
      c1.y = (p1.y - Math.min(ydiff, -60)*0.75); 
      c2.y = (p2.y + Math.min(ydiff, -60)*0.75); 
    } else if ((ydiff < 0) && (dir1 == 'up')) {
      console.log('not in use')
    } else { // ((ydiff >= 0) && (dir1 == 'up')) { - not likely
      console.log('not in use2')
    }
    
    this.plotPath(p1, c1, c2, p2, svg);
  }

  private drawHoriontalBezier(p1: Point, dir1: Direction, p2:Point, dir2: Direction, svg: SVGSVGElement) {

    var c1: Point = {x: 0, y: p1.y};
    var c2: Point = {x: 0, y: p2.y}; 
    
    const xdiff = p2.x-p1.x;

    if (xdiff >= 0) {
      c1.x = (p1.x + xdiff*0.75);
      c2.x = (p2.x - xdiff*0.75);
    } else {
      c1.x = (p1.x - xdiff*0.75);
      c2.x = (p2.x + xdiff*0.75);
    }

    this.plotPath(p1, c1, c2, p2, svg);
  }

  
  private plotPath(p1:Point, c1: Point, c2: Point, p2:Point, svg: SVGSVGElement) {
    
    const formatCoord = (p: Point): string => {
      return `${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
    };
  
    const path = `M ${formatCoord(p1)} C ${formatCoord(c1)}, ${formatCoord(c2)}, ${formatCoord(p2)}`;
    
    svg.createSvg("path", {
      attr: {
        d: path,
        stroke: this.gateColor, //this.gateColor, // Bruker Obsidians fargetema
          "stroke-width": (0.5 * this.lastFactor).toFixed(1),
        fill: "transparent"
      },
    });

  }

  private drawCircle(left: string, top: string, r: number, fill: string, el: HTMLElement): SVGSVGElement {
    const svg = el.createSvg("svg", {
      attr: {
        width: r*2,
        height: r*2,
        style: `position: absolute; z-index: 5; left: ${left}; top: ${top}; `
      }
    });
    svg.createSvg("circle", {
      attr: {
        r: r * this.lastFactor,
        fill: fill,
        stroke: fill == 'transparent'
          ? this.gateColor
          : fill, // Bruker Obsidians fargetema
          "stroke-width": this.lastFactor.toFixed(1),
      },
    });
    svg.setAttribute("overflow", "visible");
    
    return svg
  }

  private drawGate2(pos: LeftTop, gate: Gate, el: HTMLElement): SVGSVGElement {

    const radius = this.GATE_RADIUS;
    const contentsCount = gate.connections.length + gate.unspecified.length;
    return this.drawCircle(
      pos.left,
      pos.top,
      radius, 
      (contentsCount == 0)
        ? "transparent"
        : this.gateColor, 
      el
    );

  } 

  private connectionsDrawGates (connections: RelatedNode[]) {
    connections.forEach(cn => {
      cn.upperGate.svg = this.drawGate2(GATE_UP, cn.upperGate, cn!.div!);
      cn.lowerGate.svg = this.drawGate2(GATE_DOWN, cn.lowerGate, cn!.div!);
      cn.friendGate.svg = this.drawGate2(
        cn.friendGate.direction == 'right'
          ? GATE_RIGHT
          : GATE_LEFT,
          cn.friendGate, 
          cn!.div!
      );
    });
  }

  private forceRefreshByLeafSwitch() {
    const workspace = this.app.workspace;
    const currentLeaf = workspace.activeLeaf;

    if (!currentLeaf) return;

    // 1. Find another leaf to temporarily activate
    // Prefer another markdown leaf in the main area
    let tempLeaf: WorkspaceLeaf | null = null;

    // Option A: Use another existing markdown leaf
    const markdownLeaves = workspace.getLeavesOfType("markdown");
    tempLeaf = markdownLeaves.find(leaf => leaf !== currentLeaf) || null;

    // Option B: If no other markdown leaf, create a temporary empty leaf (safer fallback)
    if (!tempLeaf) {
        tempLeaf = workspace.getLeaf(false);  // false = reuse if possible, don't split
    }

    if (tempLeaf && tempLeaf !== currentLeaf) {
        // Switch away
        workspace.setActiveLeaf(tempLeaf, { focus: true });

        // Immediately switch back (use small timeout to let Obsidian process the change)
        setTimeout(() => {
            if (currentLeaf) {
                workspace.setActiveLeaf(currentLeaf, { focus: true });
            }
            // Optional: call your onDataUpdated after returning
            setTimeout(() => this.onDataUpdated(), 10);
        }, 10);   // 10-30ms is usually enough
    } else {
        // Fallback if we can't find/switch leaves
        this.onDataUpdated();
    }
}
  
}
