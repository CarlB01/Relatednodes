import { FrontMatterCache } from "obsidian";
import { SettingsManager } from "./SettingsManager";
import { Node } from "./Node";
import { StringUtils } from "./StringUtils";
import { Anchor } from "./Anchor";

export type Relation = "center" | "parent" | "child" | "friend"| "sibling" | "undefined" | "undefined-sibling" | "ignored";

/**
 * Low-overhead execution utility traversing a FrontMatterCache without heap allocations.
 */
function checkFrontmatterValue(fm: FrontMatterCache | null | undefined, searchValue: string): boolean {
  if (!fm) return false;

  // Obsidian foretrekker Object.prototype.hasOwnProperty sjekket via Object.entries()
  // for å unngå "prototype pollution"-sårbarheter og usikre 'any'-oppslag.
  for (const rawVal of Object.values(fm)) {
    const val = rawVal as unknown;
    if (val === null || val === undefined) continue;
    
    if (Array.isArray(val)) {
      // Bruk en vanlig for-løkke for maksimal V8-stabilitet i arrayer
      const len = val.length;
      for (let i = 0; i < len; i++) {
        const arrayVal = val[i] as unknown;
        if (typeof arrayVal === 'string') {
          if (arrayVal.includes(searchValue)) return true;
        } else if (String(arrayVal).includes(searchValue)) {
          return true;
        }
      }
    } else {
      if (typeof val === 'string') {
        if (val.includes(searchValue)) return true;
      } else if (String(val).includes(searchValue)) {
        return true;
      }
    }
  }
  return false;
}

/**
* Core classification utility evaluating the precise logical intersection between two nodes.
* Reuses high-velocity settings Sets and pre-fetched memory anchors from NetworkGraph.
*/
export function createRelationFinder(settings: SettingsManager, anchorCache: Map<string, Anchor>) {

  // Direct O(1)-access to settings and anchorCache via "closure".
  return function findRelation(centerNote: Node, otherNote: Node): Relation {
    if (otherNote.isInitiallyIgnored) return "ignored";

    const lowercaseOtherName = otherNote.normalizedBasename;
    const lowercaseCenterName = centerNote.normalizedBasename;

    // Henter agn direkte fra den lukkede referansen til anchorCache
    const baitForOther  = anchorCache.get(lowercaseOtherName);
    const baitForCenter = anchorCache.get(lowercaseCenterName);

    // ==========================================================================
    // CHECK A: Evaluates if centerNote owns an ACTIVE link to otherNote inside frontmatter
    // ==========================================================================
    if (baitForOther && baitForOther.sources.has(centerNote)) {
      const prop = baitForOther.sources.get(centerNote)!;
      otherNote.discoverySource = "frontmatter-kriterium";

      // PERFORMANCE OPTIMIZATION: Replaced slow O(N) .includes() arrays with ultra-fast O(1) Set .has()
      if (settings.optParentProperties.has(prop)) return "parent";
      if (settings.optChildProperties.has(prop))  return "child";
      if (settings.optFriendProperties.has(prop)) return "friend";
    }

    // ==========================================================================
    // CHECK B: Evaluates if otherNote owns an ACTIVE reciprocal link to centerNote (Mirroring)
    // HIGH-SCALE RECKONING: Guaranteed typesafe Map<Node, string> iteration.
    // ==========================================================================
    if (baitForCenter) {
      for (const [sourceNode, prop] of baitForCenter.sources.entries()) {
        if (!sourceNode) continue

        // STRICT IDENTICAL SJEKK:
        if (sourceNode.path === otherNote.path 
          || sourceNode.normalizedBasename === otherNote.normalizedBasename) {
          otherNote.discoverySource = "frontmatter-kriterium";

          if (settings.optParentProperties.has(prop)) return "child";  
          if (settings.optChildProperties.has(prop))  return "parent"; 
          if (settings.optFriendProperties.has(prop)) return "friend"; 
        }
      }
    }

    // ==========================================================================
    // TIER 2 & 3: TAG CLASSIFICATIONS AND RAW BODYTEXT TOKENS
    // ==========================================================================
    if (StringUtils.hasAnyOf(otherNote.tags, settings.optParentTags)) {
      otherNote.discoverySource = "frontmatter-kriterium";
      return "parent";
    }
    if (StringUtils.hasAnyOf(otherNote.tags, settings.optChildTags)) {
      otherNote.discoverySource = "frontmatter-kriterium";
      return "child";
    }
    if (StringUtils.hasAnyOf(otherNote.tags, settings.optFriendTags)) {
      otherNote.discoverySource = "frontmatter-kriterium";
      return "friend";
    }

    const targetName = otherNote.basename;
    
    
    // ============================================================================
    // EXECUTION MATRIX (High-Velocity Evaluation Loop)
    // ============================================================================
    // Step 1: Scan center note frontmatter for the target name.
    let hasMatchingFm = checkFrontmatterValue(centerNote.rawFrontmatter, targetName);

    // Step 2: Conditional short-circuit evaluation. 
    // Only scan the other note's frontmatter if the previous check yielded no results.
    if (!hasMatchingFm) {
        hasMatchingFm = checkFrontmatterValue(otherNote.rawFrontmatter, centerNote.basename);
    }
                      
    if (hasMatchingFm) {
      otherNote.discoverySource = "frontmatter-udefinert";
    } else {
      otherNote.discoverySource = "bodytext";
    }

    return "undefined";
  }
}
