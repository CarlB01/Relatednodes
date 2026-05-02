import RelatednodesPlugin, {relatedNodesViewType} from './main';
import { 
    BasesView,
    QueryController,
    HoverPopover,
    TFile,
    WorkspaceLeaf,
    Point,
    HoverParent,
} from 'obsidian';

import { RelatedData, RelatedNode } from './data';
import { Draw } from './draw';

export class RelatedNodesView extends BasesView implements HoverParent {
  
  readonly type = relatedNodesViewType;
  readonly WORKSPACE_LEAF_RESIZE_HANDLE = '.workspace-leaf-resize-handle';
  readonly SUPER_CONTAINER_DESCR = 'bases-relatednodes-super-container';
  readonly containerDescr = "bases-relatednodes-view-container";
  readonly upperDescr = "bases-relatednodes-upper-region";
  readonly centerDescr = "bases-relatednodes-center-region";
  readonly centerContent = 'bases-relatednodes-center-content'
  readonly mainLowerDescr = 'bases-relatednodes-lower-main-region';
  readonly lowerDescr = 'bases-relatednodes-lower-region';
  readonly siblingDescr = "bases-relatednodes-sibling-region";
  readonly friendDescr = "bases-relatednodes-friend-region";
  readonly displayWelcomeText = 'to view related notes, please open one of your notes first';
  readonly groupDivInfo = 'bases-relatednodes-group bordered-div rounded-div';
  readonly itemInfo = 'bases-list-entry bordered-div rounded-div';
    
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
  private related = new RelatedData(this.app, this.plugin);
  private draw: Draw;
  private mousedown: boolean = false; 
  hoverPopover: HoverPopover | null = null;
  
  constructor(
    controller: QueryController, 
    parentEl: HTMLElement,
    public plugin: RelatednodesPlugin,
  ) {
    super(controller);

    //hide bases toolbar for relatednotes in particular
    this.displayBasesToolbar(parentEl, plugin.settings!.displayBasesToolbar);

    this.superContainerEl = parentEl.createDiv(this.SUPER_CONTAINER_DESCR);
    this.containerEl = this.superContainerEl.createDiv(this.containerDescr);
    this.center = this.containerEl.createDiv(this.centerDescr);
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
    this.definedLower = this.mainLower.createDiv(this.lowerDescr);
    this.undefinedLower = this.mainLower.createDiv(this.lowerDescr);
    this.backContainerSVG = this.containerEl.createSvg("svg", {
      attr: {
        width: "100%",
        height: "100%",
        style: `position: absolute; z-index: 0; left: ${window.pageXOffset}; top: ${window.pageYOffset}; `
      }
    });
    this.draw = new Draw(this.containerEl,this.backContainerSVG);
  }
  
  public onload(): void {

    this.app.workspace.onLayoutReady(() => {
      if (this.containerEl) {
        this.registerMouseDownOnResize();
        this.registerMouseUpOnResize();
        this.registerDomEvent(document, 'resize', this.handleResize);
        this.displayWelcome();
      }
    });
  }

  // onDataUpdated is called by Obsidian whenever there is a configuration
  // or data change in the vault which may affect your view.
  public onDataUpdated(): void {
    const { app } = this;
    let activeFile = app.workspace.getActiveFile();
    
    if (activeFile) {
      if (activeFile.extension === 'base') {    
        const lastMDLeaf = this.app.workspace.getLeavesOfType('markdown')[0];
        if (lastMDLeaf) {
          this.app.workspace.setActiveLeaf(lastMDLeaf, { focus: false });    
          activeFile = app.workspace.getActiveFile();
        }
        return;
      }
    };
    
    this.related.update(activeFile, this.data, this.config.getOrder());
    this.buildRelatedNotesView();

    // all plotted - update scale
    //this.updateScale(this.definedUpper, this.center, this.mainLower)
  }

  async onExternalSettingsChange() {
		this.buildRelatedNotesView()
	};


  // ===================== build tree view =====================

  private buildRelatedNotesView() {
    this.siblingsContainer.empty();
    this.friendsContainer.empty();
    this.center.empty();
    this.definedUpper.empty();
    this.definedLower.empty();
    this.undefinedLower.empty()
    
    //update center file properties
    this.containerEl.toggleVisibility(false);
    this.scaleCSS(this.draw.factor);

    let centerNode = this.related.centerNode!;

    //upper region
    this.plotRegion(this.definedUpper,centerNode.upperGate.connections);
    this.plotRegion(this.siblingsContainer,this.related.sortedSiblings());
    this.plotRegion(this.friendsContainer, centerNode.friendGate.connections);

    // middle region
    this.plotCenterRegion(this.center, centerNode);

    //lower region 
    this.plotRegion(this.definedLower, centerNode.lowerGate.connections);
    this.plotRegion(this.undefinedLower, centerNode.lowerGate.unspecified);

    // resize check
    this.draw.factor = this.calcScaleFactor(this.definedUpper, this.center, this.mainLower);
    if (this.draw.factor < 1) {
      //will trigger resize
      this.scaleCSS(this.draw.factor);
    }
    
    // completed drawing - make visible changes
    this.draw.updateOffBy();
    this.containerEl.toggleVisibility(true);
    this.draw.allGates(this.related);
    this.draw.allConnects(this.related);
  }




  // ===================== plot regions =====================

  private plotCenterRegion (centerRegion: HTMLElement, node: RelatedNode) {
    const middleDiv = centerRegion.createDiv(this.centerContent);
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

  private plotRegion (region: HTMLElement,
                    nodes: RelatedNode[]) {
    // collective collapse all button
    //this.plotCollapseAllBtn(defaultCollapsed, thisRegion);
    const textFormat = region.hasClass(this.siblingDescr)
      ? 'relatednotes-compact'
      : 'relatednotes-text';
    // Single entries
    for (const node of nodes) {
      region.createDiv(this.itemInfo, el => {
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
    const columns = this.calcColumns(nodes.length, region);
    region.style.setProperty('--columns', columns.toString());
  }

  private calcColumns(nodeCount: number, region: HTMLElement) {
    return nodeCount == 1
      ? 1
      : nodeCount < 6
        ? 2
        : region.hasClass(this.upperDescr)
        ? 2
        : nodeCount < 13
          ? 3
          : nodeCount < 17
            ? 4
            : 5;
  }




  // ===================== link handling =====================

  //build file link with onclick event etc.
  private buildFileLink (parent: HTMLElement, node: RelatedNode, format: string): HTMLElement {
    const linkEl = parent.createEl('a', { 
      text: node.alias ? node.alias : node.basename,
      cls: `internal-link data-link-icon data-link-icon-after data-link-text ${format}`,
      attr: {
        'z-index': 5,
        'data-href': node.name!,
        'draggable': 'true',
        'data-link-tags': node.tags!, // '#han #lege #psykiater #phD',
        'data-link-data-href': node.basename!,
        'data-link-path': node.path!
      }
    });
    linkEl.onClickEvent((evt: { target: any; }) => {
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
    linkEl.addEventListener('mouseover', (evt: any) => {
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
    button.addEventListener('mouseover', (e: any) => {
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
    const foundLeaf = allLeaves.find((leaf: any) => leaf !== activeLeaf);

    if (foundLeaf) {
        return foundLeaf;
    }
    
    return null;
  }
  



  // ===================== window handling =====================

  private displayWelcome() {
    const popup = createDiv();
      popup.innerHTML = `<p>notes RELATED</p><p>${this.displayWelcomeText}</p>`;
      popup.style.position = 'absolute';
      popup.style.textAlign = 'right';
      popup.style.alignSelf = 'right';
      this.center.appendChild(popup);
      this.containerEl.addClass("active");
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

  private calcScaleFactor (
    upper:HTMLElement, 
    center:HTMLElement, 
    lower:HTMLElement
  ): number {
    if (!upper || !center || !lower) { return 1};

    const totalHeight = 
          upper.getBoundingClientRect().height
        + center.getBoundingClientRect().height
        + lower.getBoundingClientRect().height;       

    const windowHeight = window.innerHeight-30;
    //return Math.min(windowHeight/totalHeight, 1);
    const fract = windowHeight/totalHeight;
    const smallpart = (1-fract-0.01)/4;
    const minimalval = fract > 1 ? 1 : 0.9
    return Math.min(fract + smallpart, minimalval);
  }

  private scaleCSS(value: number) {
    this.containerEl.style.setProperty('--scaleFactor', value.toFixed(2));
  }

  private handleResize() {

    this.containerEl.toggleVisibility(false);

    this.scaleCSS(1); // set size to 'normal' 

    // recalculate "overflow"
    this.draw.factor = this.calcScaleFactor(this.definedUpper, this.center, this.mainLower);
    
    this.scaleCSS(this.draw.factor); 
    
    // all gates are now repositioned - need to redraw connections
    this.draw.allConnects(this.related);
    this.containerEl.toggleVisibility(true);
    this.backContainerSVG.style.visibility = 'visible';
  }    

  private registerMouseDownOnResize() {
    this.registerDomEvent(document, 'mousedown', (evt:MouseEvent) => {
      const target = evt.target as HTMLElement;
      if (target.matches(this.WORKSPACE_LEAF_RESIZE_HANDLE)) {
        this.mousedown = true;
        this.backContainerSVG.style.visibility = 'hidden';
      } else { // if (target.matches('.bases-view')) {
        //evt.stopPropagation();
        //evt.preventDefault();
        //this.app.workspace.setActiveLeaf(view as any);            
      }
    });
  }

  private registerMouseUpOnResize() {
    this.registerDomEvent(document, 'mouseup', (evt:MouseEvent) => {
      const target = evt.target as HTMLElement;
      if (target.matches(this.WORKSPACE_LEAF_RESIZE_HANDLE)) {
        this.handleResize();
      }  
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
    tempLeaf = markdownLeaves.find((leaf: any) => leaf !== currentLeaf) || null;

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
