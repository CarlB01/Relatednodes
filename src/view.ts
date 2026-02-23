import { relatedNodesViewType } from 'main';
import {App, 
    PluginSettingTab, 
    Setting, 
    Editor, 
    MarkdownView, 
    Modal, 
    Notice, 
    Plugin,     
    BasesView,
    setIcon,
    ViewState,
    BasesViewRegistration,
    QueryController,
    HoverParent,
    HoverPopover,
    parsePropertyId,
    Keymap,
} from 'obsidian';


export class RelatedNodesView extends BasesView implements HoverParent {
  hoverPopover: HoverPopover | null;

  readonly type = relatedNodesViewType;
  private containerEl: HTMLElement;

  constructor(controller: QueryController, parentEl: HTMLElement) {
    super(controller);
    this.containerEl = parentEl.createDiv('bases-relatednotes-view-container');
  }

  // onDataUpdated is called by Obsidian whenever there is a configuration
  // or data change in the vault which may affect your view.
  public onDataUpdated(): void {
    const { app } = this;
    const order = this.config.getOrder()
    const defaultCollapsed = (String(this.config.get('collapsed')) || 'yes' == 'yes') ? true : false;
    const propertySeparator = String(this.config.get('separator')) || ' - ';
    
    // Clear entries created by previous iterations. Remember, you should
    // instead attempt element reuse when possible.
    this.containerEl.empty();

    const btnCollapseAll = this.containerEl.createDiv(defaultCollapsed
      ? 'bases-relatednodes-btn-collapse-all collapsed'
      : 'bases-relatednodes-btn-collapse-all');
    setIcon(btnCollapseAll, defaultCollapsed ? 'chevrons-right': 'chevrons-down'); 
    
    btnCollapseAll.addEventListener('click', () => {
      const collapsed = btnCollapseAll.hasClass('collapsed');
      btnCollapseAll.toggleClass('collapsed', !collapsed);
      setIcon(btnCollapseAll, collapsed ? 'chevrons-down' : 'chevrons-right')
      this.containerEl.querySelectorAll(':scope > div').forEach(
        (x) => { 
          x.toggleClass('collapsed', !collapsed);
          console.log("x ", x.className);
          x.querySelectorAll(':scope > ul').forEach(
            (y) => { 
              y.toggleClass('collapsed', !collapsed);
              //const myElement = y.querySelector('.bases-relatednodes-group-heading-icon') as HTMLElement; 
              //setIcon(myElement, collapsed ? 'chevron-down' : 'chevron-right')
              console.log("y ", y.className);
            }
          )
        }
      )
    });
      

    // this.data contains both grouped and ungrouped versions of the data.      
    for (const group of this.data.groupedData) {
      const groupEl = this.containerEl.createDiv('bases-relatednodes-group');
      const groupHeading = groupEl.createDiv('bases-relatednodes-group-heading');
      const iconEl = groupHeading.createSpan('bases-relatednodes-group-heading-icon');
      setIcon(iconEl, defaultCollapsed ? 'chevron-right': 'chevron-down'); 
      const groupKey = (group.key?.toString() ?? "").replace(',', '');
      groupHeading.createSpan({ 
        text: (groupKey || "(ingen #)") 
              + " (" + group.entries.length + ")"
      });
      const groupUl = groupEl.createEl('ul', { 
        cls: defaultCollapsed 
          ? "bases-relatednodes-group-ul collapsed"
          : "bases-relatednodes-group-ul"});
      
      groupHeading.addEventListener('click', () => {
        const collapsed = groupUl.hasClass('collapsed');
        groupUl.toggleClass('collapsed', !collapsed);
        setIcon(iconEl, collapsed ? 'chevron-down' : 'chevron-right')
        groupHeading.parentElement?.querySelectorAll(':scope > ul').forEach(
            (x) => { x.toggleClass('collapsed', !collapsed) }
        )
      });
        
      for (const entry of group.entries) {
        groupUl.createEl('li', 'bases-list-entry', (el) => {
          let firstProp = true;
          for (const propertyName of order) {
            const { type, name } = parsePropertyId(propertyName);
            const value = entry.getValue(propertyName);

            if (value == null || value == undefined)  continue;
  
            if (!firstProp) {
              el.createSpan({
                cls: 'bases-list-separator',
                text: propertySeparator
              });
            }
            firstProp = false;
            // If the `file.name` property is included in the order, render
            // it specially so that it links to that file.
            if (name === 'name' && type === 'file') {
              const fileName = String(entry.file.name);
              const baseName = String(entry.file.basename);
              const filePath = String(entry.file.path);
              console.log(groupKey);
              const linkEl = el.createEl('a', { 
                text: fileName,
                cls: "internal-link data-link-icon data-link-icon-after data-link-text",
                attr: {
                  'data-href': fileName,
                  'draggable': 'true',
                  'data-link-tags': groupKey, // '#han #lege #psykiater #phD',
                  'data-link-data-href': baseName,
                  'data-link-path': filePath
                }
              });
              linkEl.onClickEvent((evt) => {
                if (evt.button !== 0 && evt.button !== 1) return;
                evt.preventDefault();
                const modEvent = Keymap.isModEvent(evt);
                void app.workspace.openLinkText(filePath, '', modEvent);
              });
  
              linkEl.addEventListener('mouseover', (evt) => {
                app.workspace.trigger('hover-link', {
                  event: evt,
                  source: 'bases',
                  hoverParent: this,
                  targetEl: linkEl,
                  linktext: filePath,
                });
              });
            }
            // For all other properties, just display the value as text.
            // In your view you may also choose to use the `Value.renderTo`
            // API to better support photos, links, icons, etc.
            else {
              el.createSpan({
                cls: 'bases-list-entry-property',
                text: value!.toString()
              });
            }
          }
        });
      }
    }
  }
}