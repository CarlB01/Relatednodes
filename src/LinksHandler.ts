import { GroupedNotes, NoteProperties } from "./data.js";
import RelatednotesPlugin, { relatednodesID, superChargedLinkAttribs } from "./main.js";


export class LinksHandler {
  private readonly infobuttonDescr = 'related-info-button';
  private readonly infoHoverDescr = 'related-info-hover';
  private readonly plusMinusBtnDescr = 'related-plusminus';
  private readonly superChargedLinkSimple = 'internal-link data-link-text';

  private readonly minus = '−';
  private readonly plus = '+';


  /**
   * constructor: initiation of Linkshandler.
   * @param callback returns link path clicked. expects the "onInternalLinkClicked()" function.
   */

  constructor(
    public plugin: RelatednotesPlugin,
    private callback: (internalLink: string) => void
  ) {}

  // registerDomEvent - the obsidian way - not 'addEventListener'
  // registerDomEvent - it unregisters itself automatically
  // registerHoverLinkSource - the obsidian way.

  
  /**
   * 
   * @param parent 
   * @param note 
   * @param format 
   * @returns HTMLAnchorElement with onClickEvent and hoverHandler. 
   */
  buildFileLink (
    parent: HTMLElement, 
    note: NoteProperties, 
    format: string
  ): HTMLAnchorElement 
  {
    const linktext = this.plugin.settings?.displayAliases
      ? note.aliases?.[0] ?? note.basename
      : note.basename

    const cls = `${this.infoHoverDescr} ${format} ${superChargedLinkAttribs}`;

    const linkEl = parent.createEl('a', { 
      text: linktext,
      cls: cls,
      attr: {
        'z-index': 5,
        'data-href': note.filename,
        'draggable': 'true',
        'data-link-tags': note.tags ? note.tags.join(' '): "",
        'data-link-path': note.filename
      }
    });
    linkEl.classList.add('internal-link');
    
    linkEl.onClickEvent(this.handleLinkClick.bind(this));

    this.makeHoverable(linkEl, note.basename, note.filename);
    
    return linkEl;
  }

  buildInfoBtn(note: NoteProperties) {
    const ignored = note.ignored?.length ?? 0;
    if (ignored == 0) { return};
  
    const anchor = this.uniqueAnchor(note.basename);
    const button = note.div!.createDiv(`${this.infobuttonDescr} bordered-div rounded-div`);
    button.textContent = '𝚒';
    button.style.anchorName = anchor;

    this.makeHoverable(button, this.infoBtntext(note));
  }

  buildPlusMinusBtn(firstNoteDiv: HTMLElement, group: GroupedNotes) {
    
    // prepare a unique anchor
    const anchor = this.uniqueAnchor(group.notes.first()!.basename);
    const containerDiv = firstNoteDiv.parentElement?.parentElement?.parentElement;

    // prepare the popup
    const title = 'Hidden';
    const count = group.notes.length;
    const text = `<ul><li>click to show ${count} notes</li></ul>`;
    const popup = createDiv(`${this.infoHoverDescr}`);
    popup.innerHTML = `<p>${title}</p><p>${text}</p>`;
    popup.style.positionAnchor = anchor;

    // prepare the button
    const button = firstNoteDiv.createDiv(`${this.plusMinusBtnDescr} bordered-div rounded-div`);
    button.textContent = `${group.tag} ${this.plus}`;
    button.style.anchorName = anchor;
    
    //events
    this.plugin.registerDomEvent(button, 'mouseover', (evt: MouseEvent) => {
      containerDiv?.appendChild(popup);
    });
    this.plugin.registerDomEvent(button, 'mouseout', (evt: MouseEvent) => {
      containerDiv?.removeChild(popup);
    });

    button.onClickEvent(this.handlePlusMinusBtnClick.bind(this));
  }
  
  /**
   * Private support function that uses 'callback' function to send upstream the internalLink clicked.
   * @param evt MouseEvent
   * @returns none
   */
  private handleLinkClick = (evt: MouseEvent): void => {

    const target = evt.target as HTMLElement;
    if (!target || !(target instanceof HTMLAnchorElement)) {
        return;
    }
    const internalLink = target.getAttribute('data-href');
    
    if (!internalLink) {
        return;
    }
    
    // Optional: Trigger only when modifier key is pressed
    // if (!(evt.ctrlKey || evt.metaKey || evt.shiftKey)) return;

    this.callback(internalLink);
  };

  private handlePlusMinusBtnClick = (evt: MouseEvent): void => {

    const { target } = evt;
    if (!target || !(target instanceof HTMLElement)) return;
    const containerDiv = target.parentElement?.parentElement?.parentElement;
    const divs = containerDiv?.findAll('.related-linkDiv');
    const textParts = target.textContent.split(" ");
    if (textParts[1] == this.plus) {
      containerDiv!.classList.add('expanded');
      divs!.slice(1).forEach(d => d.classList.remove('hidden'));
      target.textContent = `${textParts[0]} ${this.minus}`;
    } else {
      containerDiv!.classList.remove('expanded');
      divs!.slice(1).forEach(d => d.classList.add('hidden'));
      target.textContent = `${textParts[0]} ${this.plus}`;
    };
  }

  private makeHoverable(
    linkEl: HTMLElement, 
    linktext: string,  // getLinkText: () => string,
    sourcePath?: string
  ) {
    const hoverHandler = (evt: MouseEvent) => {
      this.plugin.app.workspace.trigger('hover-link', {
        event: evt,
        source: relatednodesID,
        targetEl: linkEl,
        linktext: linktext,
        sourcePath: sourcePath || linktext,
        hoverParent: { hoverPopover: null },
        // Optional but helpful for positioning/stacking
        // hoverParent: this.containerEl ? { hoverPopover: null, containerEl: this.containerEl }
      });
      linkEl.addClass('is-hovered');
    };
    this.plugin.registerDomEvent(linkEl, 'mouseover', hoverHandler);

    this.plugin.registerDomEvent(linkEl, 'mouseout', (evt: MouseEvent) => {
      linkEl.removeClass('is-hovered');
    });
  }

  private infoBtntext (
    note: NoteProperties,
  ){
    const title = 'Info';
    const count = note.ignored?.length;
    return `### ${title} ${'\n'} ignored ${count} notes`;
  }

  private uniqueAnchor(basename: string): string {
    return `--${basename.replace(/[^a-zA-Z0-9]/g, '').trim()}`;
  }

}