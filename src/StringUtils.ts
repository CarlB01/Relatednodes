export class StringUtils {
  // Én felles Regex-motor som fanger opp [[Wikilenker]] og stripper dem i ett blunk.
  // Gjenbrukes i minnet i stedet for å opprette nye strenger hele tiden.
  private static readonly WIKILINK_REGEX = /^\[+|\u200B|\]+$/g;

  /**
   * TRINN 1: Lynrask normalisering.
   * Kutter ut unødvendige flatMaps og filters. Den sjekker typen med en gang,
   * og sluser innholdet direkte videre.
   */
  static normalizeToStringArray(input: unknown): string[] {
    if (input == null) return [];

    if (Array.isArray(input)) {
      const result: string[] = [];
      // Bruker en klassisk for-of loop (mye raskere enn .flatMap og .filter i JS!)
      for (const item of input) {
        if (item == null) continue;
        // Tvinger elementet til streng og vasker det direkte inn i resultatet
        const cleaned = this.splitAndClean(String(item));
        if (cleaned.length > 0) {
          // I stedet for å slå sammen arrays med .concat eller flatMap, 
          // dytter vi elementene direkte inn med en effektiv push-spread
          result.push(...cleaned);
        }
      }
      return result;
    }

    // Singel verdi
    return this.splitAndClean(String(input));
  }

  /**
   * TRINN 2: Smart komma-splitting.
   * I stedet for å kjøre tunge kjede-operasjoner, splitter vi på komma,
   * og kjører en super-ren for-loop som vasker bitene direkte.
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
   * TRINN 3: Den store tidsspareren!
   * Slår sammen dine gamle 'extractLinkTargets' og 'trimWikilinks' til én felles, lynrask operasjon.
   * Den parser unna pipen (|) og stripper klammer [[ ]] samtidig uten array-støy.
   */
  static cleanSingleSegment(text: unknown): string {
    if (text == null) return '';
    let segment = String(text).trim();
    if (!segment) return '';
    
    // Sjekk om det er en wikilink med en display-tekst pipe (f.eks. [[Notat|Mitt Alias]])
    // Vi bruker indexOf i stedet for split('|') for å unngå å lage en unødvendig array i minnet!
    const pipeIndex = segment.indexOf('|');
    if (pipeIndex !== -1) {
      // Vi kutter strengen og beholder kun den venstre siden (selve filnavnet)
      segment = segment.substring(0, pipeIndex).trim();
    }

    // Stripper bort [[ og ]] i én rask operasjon ved hjelp av Regex-motoren vår
    // KORRIGERT: Vi kaller den spesifikt via 'StringUtils.WIKILINK_REGEX' i stedet for 'this.WIKILINK_REGEX'!
    // Dette garanterer at JavaScript ALLTID finner motoren, uansett hvordan funksjonen kalles! [dan]
    return segment.replace(StringUtils.WIKILINK_REGEX, '').trim();
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