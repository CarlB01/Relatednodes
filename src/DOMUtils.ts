import { Workspace } from "obsidian";
import { GroupedNotes } from "./data.js";
import RelatednotesPlugin, { relatednodesID } from "./main.js";
import { NoteClass } from "./NoteClass.js";

export class DOMUtils {
  static infobuttonDescr = 'related-info-button';
  static INFO_HOVER_DESCR = 'related-info-hover';
  static plusMinusBtnDescr = 'related-plusminus';
  private readonly superChargedLinkSimple = 'internal-link data-link-text';


  constructor(
    public plugin: RelatednotesPlugin,
  ) {}

  // registerDomEvent - the obsidian way - not 'addEventListener'
  // registerDomEvent - it unregisters itself automatically
  // registerHoverLinkSource - the obsidian way.
  static uniqueAnchor(basename: string): string {
    return `--${basename.replace(/[^a-zA-Z0-9]/g, '').trim()}`;
  }

  static buildPlusMinusBtn(firstNoteDiv: HTMLElement, group: GroupedNotes) {
    
    const minus = '−';
    const plus = '+';

    // prepare a unique anchor
    const anchor = this.uniqueAnchor(group.notes.first()!.basename);
    const containerDiv = firstNoteDiv.parentElement?.parentElement?.parentElement;

    // prepare the popup
    const title = 'Hidden';
    const count = group.notes.length;
    const text = `<ul><li>click to show ${count} notes</li></ul>`;
    const popup = createDiv(`${DOMUtils.INFO_HOVER_DESCR}`);
    popup.innerHTML = `<p>${title}</p><p>${text}</p>`;
    popup.style.positionAnchor = anchor;

    // prepare the button
    const button = firstNoteDiv.createDiv(`${this.plusMinusBtnDescr} bordered-div rounded-div`);
    button.textContent = `${group.tag} ${plus}`;
    button.style.anchorName = anchor;
  }

  static makeHoverable(
    linkEl: HTMLElement, 
    workspace: Workspace,
    linktext: string,  // getLinkText: () => string,
    sourcePath?: string
  ) {
    const hoverHandler = (evt: MouseEvent) => {
      workspace.trigger('hover-link', {
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
  }

  private infoBtntext (
    note: NoteClass,
  ){
    const title = 'Info';
    const count = note.ignored?.length;
    return `### ${title} ${'\n'} ignored ${count} notes`;
  }
}