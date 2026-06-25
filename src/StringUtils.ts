export class StringUtils {

  /**
   * Splits by comma and cleans each part (handles wikilinks with | )
   */
  static splitAndClean(value: unknown): string[] {
    if (value == null) return [];

    const str = String(value).trim();
    if (!str) return [];

    return str.split(',')
        .flatMap(part => this.extractLinkTargets(part))
        .filter(Boolean);
  }

  /**
   * Handles both [[Link]] and [[Link|Display Text]] → returns clean link targets
   */
  static extractLinkTargets(text: string): string[] {
      const trimmed = text.trim();
      if (!trimmed) return [];

      // Split on pipe (|) and take the first part (the actual link target)
      const segments = trimmed.split('|').map(s => s.trim());

      return segments.map(segment => StringUtils.trimWikilinks(segment));
  }

  /**
   * Optional: Cleaner alias for trimWikilinks if you prefer the name
   */
  static cleanLink = (str: string): string => this.trimWikilinks(str);

  /**
   * Removes [[ and ]] from both sides
   */
  static trimWikilinks(str: string): string {
      if (typeof str !== 'string' || !str) return '';

      return str
          .trim()
          .replace(/^\[+/, '')   // remove one or more [ at start
          .replace(/\]+$/, '')   // remove one or more ] at end
          .trim();
  }

  //return an array 
  static itemsOf(value: unknown): string[] {
    if (value == null) return [];

    const str = String(value).trim();
    if (!str) return [];

    return str.split(',')
      .flatMap(part => part.trim())
      .filter(Boolean);
  }

  /**
     * Sjekker om en tekst inneholder noen av de forhåndskonverterte fragmentene.
     * @param text Stien eller teksten som skal sjekkes
     * @param lowercaseParts MÅ være en array med strenger i lowercase på forhånd!
     */
    static foundPart(text: string, lowercaseParts: string[]): boolean {
        // Hvis teksten er tom, eller filterlisten er tom, avbryt med en gang
        if (!text || !lowercaseParts || lowercaseParts.length === 0) return false;
        
        const lowerText = text.toLowerCase();

        // Klassisk, lynrask indeks-løkke. Ingen allokering, ingen anonyme funksjoner.
        for (let i = 0; i < lowercaseParts.length; i++) {
            const part = lowercaseParts[i];
            
            // Sjekken 'part && ...' fjerner 'undefined'-feilen i TypeScript fullstendig
            if (part && lowerText.includes(part)) {
                return true; // Fant en ignore-match! Avbryt umiddelbart.
            }
        }
        
        return false;
    }

    /**
   * Normalizes any input (string, array, null, etc.) into a clean string array
   */
  static normalizeToStringArray(input: unknown): string[] {
    if (input == null) return [];

    // If it's already an array, process each item
    if (Array.isArray(input)) {
        return input
            .flatMap(item => StringUtils.splitAndClean(item))
            .filter(Boolean);
    }

    // Single value (string, number, etc.)
    return StringUtils.splitAndClean(input);
  }

  /**
	 * Sjekker om noen av notens tagger matcher dine forhåndslagrede lowercase-tagger.
	 * @param noteTags Taggene fra noten (f.eks. ["#Prosjekt", "#Jobb"])
	 * @param lowercaseFilter De forhåndslagrede taggene fra innstillingene (f.eks. ["#prosjekt"])
	 */
	static hasAnyOf(noteTags: string[], lowercaseFilter: string[]): boolean {
		if (!noteTags || !lowercaseFilter || lowercaseFilter.length === 0) return false;

		for (let i = 0; i < noteTags.length; i++) {
			const tag = noteTags[i];
			if (tag && lowercaseFilter.includes(tag.toLowerCase())) {
				return true; // Match funnet, avbryt løkken umiddelbart
			}
		}
		return false;
	}

}