import { ExampleViewType } from 'main';
import {App, 
    PluginSettingTab, 
    Setting, 
    Editor, 
    MarkdownView, 
    Modal, 
    Notice, 
    Plugin,     
    BasesView,
    BasesViewRegistration,
    QueryController,
} from 'obsidian';

export class RelatedNodesView extends BasesView {
  readonly type = ExampleViewType;
  private containerEl: HTMLElement;

  constructor(controller: QueryController, parentEl: HTMLElement) {
    super(controller);
    this.containerEl = parentEl.createDiv('bases-example-view-container');
  }

  // onDataUpdated is called by Obsidian whenever there is a configuration
  // or data change in the vault which may affect your view. For now,
  // simply draw "Hello World" to screen.
  public onDataUpdated(): void {
    this.containerEl.empty();
    this.containerEl.createDiv({ text: 'Hello World' });
  }
}