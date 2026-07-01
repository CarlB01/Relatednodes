import { Workspace } from "obsidian";
import RelatednotesPlugin, { relatednodesID } from "./main.js";
import { NoteClass } from "./NoteClass.js";
import { RV_CLASSES } from "./constants.js";

export class DOMUtils {
  static plusMinusBtnDescr = 'rv-plusminus';
  private readonly superChargedLinkSimple = 'internal-link data-link-text';


  constructor(
    public plugin: RelatednotesPlugin,
  ) {}

  static uniqueAnchor(basename: string): string {
    return `--${basename.replace(/[^a-zA-Z0-9]/g, '').trim()}`;
  }

  static buildPlusMinusBtn(firstNoteDiv: HTMLElement, group: { tag: string, notes: NoteClass[] }) {
    
    // prepare a unique anchor
    const anchor = this.uniqueAnchor(group.notes.first()!.basename);
    const containerDiv = firstNoteDiv.parentElement?.parentElement?.parentElement;

    // prepare the popup
    const title = 'Hidden';
    const count = group.notes.length;
    const text = `<ul><li>click to show ${count} notes</li></ul>`;
    const popup = createDiv(RV_CLASSES.INFO_HOVER);
    popup.innerHTML = `<p>${title}</p><p>${text}</p>`;
    popup.style.positionAnchor = anchor;

    // prepare the button
    const button = firstNoteDiv.createDiv(`${RV_CLASSES.PLUS_MINUS_BTN} ${RV_CLASSES.BORDERED} ${RV_CLASSES.ROUNDED}`);
    button.textContent = `${group.tag} ${RV_CLASSES.PLUS}`;
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
    const count = note.relations.ignored.size;
    return `### ${title} ${'\n'} ignored ${count} notes`;
  }
}