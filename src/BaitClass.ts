import { NoteClass } from "./NoteClass";

export class BaitClass {
  public targetName: string;
  isUsed: boolean = false;

  public sources = new Map<NoteClass, string>(); 
  
  constructor(targetName: string) {
    this.targetName = targetName;
  }
}