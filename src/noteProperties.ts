import { FrontMatterCache, BasesEntry } from "obsidian";

export class NoteProperties2 {
    private frontmatter: FrontMatterCache | null | undefined;
    private element: BasesEntry | null;

    constructor(
        frontmatter: FrontMatterCache | null | undefined = null,
        element: BasesEntry | null = null
    ) {
        this.frontmatter = frontmatter;
        this.element = element;
    }

    /**
     * Get a property value from either source.
     * Normalizes the result so you always work with consistent data.
     */
    get(propertyName: string): any {
        // Prefer FrontMatterCache (most common in Obsidian plugins)
        if (this.frontmatter) {
            return this.frontmatter[propertyName];
        }

        if (this.element) {
            return this.element.getValue(`note.${propertyName}`);
        }

        return undefined;
    }

    /**
     * Returns the value always as an array (normalized)
     */
    getAsArray(propertyName: string): unknown[] {
        const value = this.get(propertyName);
        if (value == null) return [];
        if (Array.isArray(value)) return value;
        return [value];
    }

    /**
     * Check if this note has any value for the given property
     */
    has(propertyName: string): boolean {
        const value = this.get(propertyName);
        return value != null && value !== '';
    }
}