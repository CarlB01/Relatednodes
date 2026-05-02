import { TFile, MetadataCache, Vault } from 'obsidian';

interface NoteProperties {
    filename: string;
    basename: string;
    aliases?: string[];
    tags?: string[];
    properties: [string, any][];
    connectionCount: number;
    sharedLinksWithStart: number;
    degree: 'first' | 'second';
    file: TFile;
}


export class ConnectWithData {

/**
 * Helper to safely get backlinks, with optional Backlink Cache plugin support
 */
private getBacklinks(app: any, file: TFile) {
    const metadataCache = app.metadataCache;

    // 1. Try Backlink Cache plugin (fastest)
    if (metadataCache.getBacklinksForFile?.safe) {
        try {
            return metadataCache.getBacklinksForFile.safe(file);
        } catch (e) {
            console.warn("Backlink Cache safe() failed, falling back...", e);
        }
    }

    // 2. Fallback to undocumented method
    if (metadataCache.getBacklinksForFile) {
        try {
            return (metadataCache as any).getBacklinksForFile(file);
        } catch (e) {
            console.warn("getBacklinksForFile failed", e);
        }
    }

    // 3. Ultimate fallback: empty result
    return { data: {} };
}


    constructor(
        private app: { metadataCache: MetadataCache; vault: Vault }
    ) {}

    private normalizeAliases(aliases: any): string[] | undefined {
        if (!aliases) return undefined;
        if (Array.isArray(aliases)) return aliases;
        if (typeof aliases === 'string') return [aliases];
        return undefined;
    }

    private normalizeTags(tags: any): string[] | undefined {
        if (!tags) return undefined;
        if (Array.isArray(tags)) return tags;
        if (typeof tags === 'string') return [tags];
        return undefined;
    }

    private getNoteProperties(
        file: TFile,
        connectionCount: number,
        sharedLinksWithStart: number,
        degree: 'first' | 'second'
    ): NoteProperties {
        const cache = this.app.metadataCache.getFileCache(file);
        const frontmatter = cache?.frontmatter || {};

        return {
            filename: file.name,
            basename: file.basename,
            aliases: this.normalizeAliases(frontmatter.aliases),
            tags: this.normalizeTags(frontmatter.tags),
            properties: Object.entries(frontmatter)
                .filter(([key]) => !['aliases', 'tags'].includes(key)),
            connectionCount,
            sharedLinksWithStart,
            degree,
            file
        };
    }

    /**
     * Get all direct neighbors (1st degree) of a file
     */
    private getFirstDegreeFiles(file: TFile): TFile[] {
        const connections = new Set<TFile>();

        // === Outgoing Links (Official & Fast) ===
        const cache = this.app.metadataCache.getFileCache(file);
        if (cache?.links) {
            for (const link of cache.links) {
                const target = this.app.metadataCache.getFirstLinkpathDest(link.link, file.path);
                if (target && target.path !== file.path) {
                    connections.add(target);
                }
            }
        }

        // === Incoming Backlinks (with soft dependency) ===
        const backlinks = this.getBacklinks(this.app, file);
        if (backlinks?.data) {
            for (const sourcePath of Object.keys(backlinks.data)) {
                const sourceFile = this.app.vault.getFileByPath(sourcePath);
                if (sourceFile && sourceFile.path !== file.path) {
                    connections.add(sourceFile);
                }
            }
        }

        return Array.from(connections);
    }

    /**
     * Count how many common neighbors two files share
     */
    private countSharedConnections(fileA: TFile, fileB: TFile): number {
        const neighborsA = this.getFirstDegreeFiles(fileA);
        const neighborsB = this.getFirstDegreeFiles(fileB);

        let count = 0;
        for (const neighbor of neighborsA) {
            if (neighborsB.some(n => n.path === neighbor.path)) {
                count++;
            }
        }
        return count;
    }

    // ===================== Public Methods =====================

    /**
     * Get first-degree connected notes with rich metadata
     */
    getFirstDegreeConnections(startFile: TFile): NoteProperties[] {
        const neighbors = this.getFirstDegreeFiles(startFile);
        const result: NoteProperties[] = [];

        for (const file of neighbors) {
            const connectionCount = this.getFirstDegreeFiles(file).length;
            const shared = this.countSharedConnections(startFile, file);

            result.push(this.getNoteProperties(file, connectionCount, shared, 'first'));
        }

        // Sort: strongest shared connection first, then total connections
        return result.sort((a, b) => 
            b.sharedLinksWithStart - a.sharedLinksWithStart ||
            b.connectionCount - a.connectionCount
        );
    }

    /**
     * Get second-degree connected notes (union of connections of first-degree notes)
     */
    getSecondDegreeConnections(startFile: TFile): NoteProperties[] {
        const firstDegreeFiles = this.getFirstDegreeFiles(startFile);
        const secondDegreeMap = new Map<string, { file: TFile; shared: number }>();

        for (const neighbor of firstDegreeFiles) {
            const neighborsOfNeighbor = this.getFirstDegreeFiles(neighbor);

            for (const candidate of neighborsOfNeighbor) {
                if (candidate.path === startFile.path) continue;
                if (firstDegreeFiles.some(f => f.path === candidate.path)) continue;

                const shared = this.countSharedConnections(startFile, candidate);

                const existing = secondDegreeMap.get(candidate.path);
                if (!existing || shared > existing.shared) {
                    secondDegreeMap.set(candidate.path, { file: candidate, shared });
                }
            }
        }

        const result: NoteProperties[] = [];

        for (const { file, shared } of secondDegreeMap.values()) {
            const connectionCount = this.getFirstDegreeFiles(file).length;
            result.push(this.getNoteProperties(file, connectionCount, shared, 'second'));
        }

        return result.sort((a, b) => 
            b.sharedLinksWithStart - a.sharedLinksWithStart ||
            b.connectionCount - a.connectionCount
        );
    }

    /**
     * Convenience method: Get both first and second degree in one call
     */
    getNeighborhood(startFile: TFile) {
        const firstDegree = this.getFirstDegreeConnections(startFile);
        const secondDegree = this.getSecondDegreeConnections(startFile);

        return {
            startFile,
            firstDegree,
            secondDegree,
            allConnected: [...firstDegree, ...secondDegree]
        };
    }
}