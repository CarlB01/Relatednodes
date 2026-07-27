import { Node } from "./Node";

/**
 * Represents an active metadata anchor (bait) within the vault framework.
 * Maps exact string links from frontmatter context back to their originating source nodes.
 */
export class Anchor {
  /** The exact normalized string identity of the targeted link (NFC format) */
  public targetName: string;

  /** Operational lifecycle flag indicating if this anchor is rendered or actively processed */
  public isUsed: boolean = false;

  /** Highly optimized localized map linking source nodes directly to the specific attribute field string */
  public sources = new Map<Node, string>(); 
  
  constructor(targetName: string) {
    this.targetName = targetName;
  }
}
