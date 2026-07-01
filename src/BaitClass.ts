import { NoteClass } from "./NoteClass";

export class BaitClass {
  readonly path: string;
  readonly basename: string;
  isUsed: boolean = false;

  // Hvilken note la ut dette agnet?
  sourceNote: NoteClass | null = null;
  
  // Hvilken brukerdefinert egenskap (f.eks. "oppfølger", "venn") ble brukt?
  foundInProperty: string = "";

  // Reelle, synlige noder som har "bitt" på dette agnet i denne runden  activeConnections = new Set<NoteClass>();
  activeConnections = new Set<NoteClass>();

  constructor(path: string) {
    this.path = path;
    // Trekker ut filnavnet fra stien (siste del før .md)
    const match = path.match(/([^/]+)\.md$/);
    
    if (match && match[1]) {
      this.basename = match[1]; // match[1] er selve navnet uten .md
    } else {
      // Fallback: Hvis stien av en eller annen grunn ikke har .md til slutt, 
      // fjerner vi alt frem til siste skråstrek manuelt.
      const lastSlash = path.lastIndexOf('/');
      this.basename = lastSlash !== -1 ? path.substring(lastSlash + 1) : path;
    }  
  }
}