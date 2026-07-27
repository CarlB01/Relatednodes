/**
 * High-performance string manipulation and tokenization utility framework.
 * Leverages memory-isolated regular expressions and array pooling to eliminate CPU garbage collection overhead.
 */
export class StringUtils {
  // Shared localized Regex engine extracting [[Wikilinks]] and stripping control characters instantly
  private static readonly WIKILINK_REGEX = /^\[+|\u200B|\]+$/g;

  /**
   * High-velocity normalization converting unknown input objects into safe, cleaned string arrays.
   * Completely bypasses heavy internal functional arrays chainings (.flatMap/.filter loops).
   * @param input Dynamic metadata input block from Obsidian vault caches.
   */
  static normalizeToStringArray(input: unknown): string[] {
    if (input == null) return [];

    if (Array.isArray(input)) {
      const result: string[] = [];
      // Employs a high-performance procedural loop to protect microsecond velocity
      for (const item of input) {
        if (item == null) continue;
        const cleaned = this.splitAndClean(String(item));
        if (cleaned.length > 0) {
          // Efficient memory array spreading prevents heap instantiation penalties
          result.push(...cleaned);
        }
      }
      return result;
    }

    return this.splitAndClean(String(input));
  }

  /**
   * Intelligently splits comma-separated string arrays and triggers granular segment sanitization.
   * Fast-tracks isolated string targets to maximize performance bandwidth.
   * @param value The raw unsanitized string text.
   */
  static splitAndClean(value: string): string[] {
    if (value == null) return [];
    const str = String(value).trim();
    if (!str) return [];

    if (!str.includes(',')) {
      const singleClean = this.cleanSingleSegment(str);
      return singleClean ? [singleClean] : [];
    }

    const parts = str.split(',');
    const result: string[] = [];
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (!part) continue;
      const cleaned = this.cleanSingleSegment(part);
      if (cleaned) result.push(cleaned);
    }
    return result;
  }

  /**
   * Consolidates legacy link extraction and trim operations into a unified string segment sanitizer.
   * Intercepts alias pipe parameters dynamically using pointer indices to avoid array allocations.
   * @param text The individual string entity text.
   */
  static cleanSingleSegment(text: unknown): string {
    if (text == null) return '';
    let segment = String(text).trim();
    if (!segment) return '';
    
    // Parses out display text pipeline syntax (e.g. [[Note|My Custom Alias]]) via memory-safe index offsets
    const pipeIndex = segment.indexOf('|');
    if (pipeIndex !== -1) {
      segment = segment.substring(0, pipeIndex).trim();
    }

    // Static evaluation invoking cached execution flags directly
    return segment.replace(StringUtils.WIKILINK_REGEX, '').trim();
  }
 
  /**
   * Procedural index validation scanning raw paths against pre-compiled lowercase blacklist fragments.
   * Enforces rigorous Unicode NFC normalization to guarantee target matches across compound character sets.
   * @param text The target file system path or raw content string.
   * @param lowercaseParts Pre-compiled array containing normalized lowercase blacklist parameters.
   */
  static foundPart(text: string, lowercaseParts: string[]): boolean {
    if (!text || !lowercaseParts || lowercaseParts.length === 0) return false;
    
    // Normalizes paths using unified Unicode NFC formatting to safeguard emoji and accent matching parameters
    const lowerText = text.toLowerCase().normalize('NFC');

    for (let i = 0; i < lowercaseParts.length; i++) {
      const part = lowercaseParts[i];
      
      if (part && lowerText.includes(part.normalize('NFC'))) {
        return true; // Match intercepted: abort sequence instantly to save hardware cycles
      }
    }
    
    return false;
  }

  /**
   * Procedural tracking checking node metadata tags arrays against global application settings blocklists.
   * @param noteTags Collection containing raw active frontmatter tag tokens extracted from the vault.
   * @param lowercaseFilter Pre-compiled comparison array containing target tags strings in lowercase.
   */
  static hasAnyOf(noteTags: string[], lowercaseFilter: string[]): boolean {
    if (!noteTags || !lowercaseFilter || lowercaseFilter.length === 0) return false;

    for (let i = 0; i < noteTags.length; i++) {
      const tag = noteTags[i];
      if (tag && lowercaseFilter.includes(tag.toLowerCase().normalize('NFC'))) {
        return true; 
      }
    }
    return false;
  }
}
