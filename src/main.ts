import { Plugin, Notice, WorkspaceLeaf, EventRef, TFile, TAbstractFile } from 'obsidian';
import { SampleSettingTab } from "./SettingTab.js";
import { RelatednotesView } from './view.js';
import { RV_CLASSES } from './constants.js';
import { RelatedData } from './data.js';
import { SettingsManager } from './SettingsManager.js';

export const relatednodesID = 'relatednotesViewType';

export default class RelatednotesPlugin extends Plugin {
	declare settings: SettingsManager;
	public relatedData!: RelatedData;
	
	private resolvedEventRef: EventRef | undefined;
  
	async onload() {
		
		await this.loadSettings();

		this.relatedData = new RelatedData(this, this.settings);

		this.addSettingTab(new SampleSettingTab(this.app, this));
	
		// Registrer visningen din (Gjør det mulig å åpne både i sidebar og som stor tab!) [dan]
    this.registerView(
      RV_CLASSES.RELATED_NOTES_VIEW_TYPE,
      (leaf) => new RelatednotesView(leaf, this) // Vi sender med 'this' (pluginen) [dan]
    );

		// BIND OPP ALLE GLOBALE LYTTERE HER (file-open, rename, resolve)
    this.registerGlobalEvents();

		// Ribbon icon to open your view
		this.addRibbonIcon("apple", "Open Related Notes", () => {
			this.activateRelatedNotesView();
		});

		// Optional: Add a command
		this.addCommand({
			id: 'open-related-notes',
			name: 'Open Related Notes View',
			callback: () => this.activateRelatedNotesView(),
		});		

	};

	private registerGlobalEvents() {
 
		// A. Når brukeren bytter fil i Obsidian, oppdaterer vi minne-cachen centralt [dan]
    this.registerEvent(
      this.app.workspace.on('file-open', async (file: TFile | null) => {
        if (!file) return;
        await this.relatedData.update(file);
        
        // NYTT & MAGISK: Finn ALLE åpne instanser av grafen din (både i sidebar og store vinduer) 
        // og be dem tegne seg på nytt basert på de ferske dataene! [dan]
        this.app.workspace.getLeavesOfType(RV_CLASSES.RELATED_NOTES_VIEW_TYPE).forEach(leaf => {
          if (leaf.view instanceof RelatednotesView) {
            leaf.view.areaManager.renderGraph(); // Trigger 100% minne-utskrift live! [dan]
          }
        });
      })
    );

    // B. register when user renames a file
    this.registerEvent(
      this.app.vault.on('rename', async (file: TAbstractFile, oldPath: string) => {
        if (!(file instanceof TFile)) return;
        this.relatedData.handleFileRename(file, oldPath);
      })
    );

		// C: register when user updates/adds links to a relevant note
    this.registerEvent(
			this.app.metadataCache.on('resolve', async (file: TFile) => {
				// 1. Be databasen fikse minnet asynkront
				const dataBleOppdatert = await this.relatedData.handleFileResolve(file);
				
				// 2. Hvis dørvakten ga grønt lys og dataene ble endret: Oppdater skjermene!
				if (dataBleOppdatert) {
					this.app.workspace.getLeavesOfType(RV_CLASSES.RELATED_NOTES_VIEW_TYPE).forEach(leaf => {
						if (leaf.view instanceof RelatednotesView) {
							// Hvert unike vindu (sidebar/stor tab) tegner seg på nytt i minnet sitt
							leaf.view.areaManager.renderGraph();
						}
					});
				}
			})
		);
  }

	async activateRelatedNotesView() {
		// 1. SIKRING: Hvis Obsidian ikke er ferdig indeksert ennå, vent på 'resolved'
		const isCacheReady = (this.app.metadataCache as any).initialized === true;
		if (!isCacheReady) {
			if (!this.resolvedEventRef) {
				this.resolvedEventRef = this.app.metadataCache.on('resolved', () => {
					this.activateRelatedNotesView();
					this.unregisterResolvedEvent(); // KORRIGERT: Lagt til () så funksjonen faktisk kjører!
				});
				this.registerEvent(this.resolvedEventRef);
			}
			return; // Avbryt og vent på eventet
		}

		const { workspace } = this.app;
		
		// 2. SIKRING: Sjekk om visningen allerede finnes (Unngå duplikate faner)
		let leaf = workspace.getLeavesOfType(RV_CLASSES.RELATED_NOTES_VIEW_TYPE)[0];
		
		if (leaf) {
			// Visningen finnes allerede! Bare flytt fokus dit
			workspace.revealLeaf(leaf);
			return;
		}

		// 3. OPPRETT NYTT PANEL: Siden ingen fane finnes, lager vi en ny i venstre sidefelt
		// Hvis brukeren i stedet høyreklikker på ikonet og velger "Open in new tab", 
		// vil Obsidian overstyre dette og åpne den i midten uansett, noe vår nye arkitektur takler perfekt!
		let newLeaf: WorkspaceLeaf | null | undefined = workspace.getLeftLeaf(false);

		if (newLeaf) {
			await newLeaf.setViewState({
				type: RV_CLASSES.RELATED_NOTES_VIEW_TYPE,
				active: true,
			});
			
			workspace.revealLeaf(newLeaf);
			workspace.leftSplit?.expand(); // Brett ut venstre sidefelt i Obsidian

			// FØRSTE DATA-FÔRING: Siden panelet akkurat ble åpnet ferskt, fôrer vi det 
			// med den aktive filen brukeren står i akkurat nå med en gang!
			const activeFile = this.app.workspace.getActiveFile();
			if (activeFile) {
				await this.relatedData.update(activeFile);
				if (newLeaf.view instanceof RelatednotesView) {
					newLeaf.view.areaManager.renderGraph(); // Tegn det første bildet
				}
			}
		} else {
			new Notice("Could not create view leaf");
		}
	}
	
	onunload() {
		this.unregisterResolvedEvent();
	}

	// Hjelpefunksjon for å vaske og fjerne eventet manuelt
	private unregisterResolvedEvent() {
		if (this.resolvedEventRef) {
			this.app.metadataCache.offref(this.resolvedEventRef);
			this.resolvedEventRef = undefined; // Nullstill slik at den kan registreres igjen ved behov
			console.log("Avregistrerte 'resolved'-lytteren safely.");
		}
	}

	async loadSettings() {
	// Fød en fersk SettingsManager (den setter opp alle standardverdier i constructor) [dan]
    this.settings = new SettingsManager();
    
    // Hent lagrede rådata fra Obsidian-disken
    const loadedData = await this.loadData();
    
    // Flett de lagrede dataene inn over standardverdiene i klassen [dan]
    Object.assign(this.settings, loadedData);
    
    // Siden dataene akkurat ble flettet, ber vi settings om å vaske seg selv!
    // Ingen parametere trengs, fordi den leser sine egne variabler (this.parentProperties osv.) [dan]
    this.settings.prepare();
	}

	async saveSettings() {
		this.settings.prepare();
    await this.saveData(this.settings);
	}
}