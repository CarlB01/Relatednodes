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

  static buildPlusMinusBtn(
    firstNoteDiv: HTMLElement, 
    group: { tag: string, notes: NoteClass[]}, 
    startsClosed: boolean 
  ): HTMLElement {
    const count = group.notes.length.toString();

    // 1. Opprett knappen inni firstNoteDiv nøyaktig slik du pleier, 
    // men pass på at den får vår unike klasse '.rv-plusminus' (fra RV_CLASSES.PLUS_MINUS_BTN) [dan]
    const button = firstNoteDiv.createDiv(`${RV_CLASSES.PLUS_MINUS_BTN} ${RV_CLASSES.BORDERED} ${RV_CLASSES.ROUNDED}`);
    
    // 2. ULTRAKOMPAKT TEKST: I stedet for å dytte inn hele tag-navnet, 
    // bruker vi KUN pluss-tegnet for å bevare den lekre 14px sirkelformelen [dan]!
    button.textContent = startsClosed ? `${RV_CLASSES.PLUS}${count}` : RV_CLASSES.MINUS; 

    // 3. METADATA: Vi stempler på data-attributter direkte på HTML-knappen.
    // Dette gjør at hover-lytteren vår i RelatednotesView kan lese taggen og antallet live [dan]!
    button.setAttribute("data-count", count);
    button.setAttribute("data-tag", group.tag);

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