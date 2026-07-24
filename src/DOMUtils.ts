import { Workspace } from "obsidian";
import RelatednotesPlugin from "./main.js";
import { NoteClass } from "./NoteClass.js";
import { RV } from "./constants.js";

export class DOMUtils {
  static plusMinusBtnDescr = RV.PLUS_MINUS_BTN;

  constructor(
    public plugin: RelatednotesPlugin,
  ) {}

  static uniqueAnchor(basename: string): string {
    return `--${basename.replace(/[^a-zA-Z0-9]/g, '').trim()}`;
  }
 
  static buildPlusMinusBtn(
    firstNoteDiv: HTMLElement, 
    group: { tag: string, notes: NoteClass[]}, 
    startsClosed: boolean 
  ): HTMLElement {
    const count = group.notes.length.toString();

    // 1. Opprett knappen inni firstNoteDiv nøyaktig slik du pleier, 
    const button = firstNoteDiv.createDiv(`${RV.PLUS_MINUS_BTN} ${RV.SUPERCHARGED_ATTRIB} ${RV.BORDERED} ${RV.ROUNDED}`);
    
    button.textContent = startsClosed 
      ? `${RV.PLUS}${group.tag}(${count})` 
      : `${RV.MINUS}${group.tag}(${count})`; 

    // Let hover-listener fetch data-count
    button.setAttribute("data-count", count);
    button.setAttribute("data-tag", group.tag);
    button.setAttribute('data-link-tags', group.tag);

    return button;
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
        source: RV.RELATED_NOTES_VIEW_TYPE,
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

}