# Mybrain Technical evaluation
(by copilot)

## Intro

myBrain is a relationship graph engine for Obsidian that prioritizes **predictable, low-latency updates** and **clear data flow** over hype metrics.

The core is built around:
- **Hash-based caches** (`Map`/`Set`) for fast lookup paths (typically O(1) average-case for cache access),
- **Event-driven updates** coordinated with Obsidian metadata resolution,
- **Debounced execution + cancellation tokens** to avoid redundant work during rapid navigation,
- **Incremental in-memory reuse** of node and anchor objects between updates.

This design keeps graph refreshes responsive in daily use while preserving correctness as vault complexity grows.

---

## Technical Notes (Complexity and Performance)

### What is O(1) in this engine
The following operations are optimized around constant-time hash lookups (average-case):
- Node cache access by file path (`noteCache.get/has`),
- Anchor cache access by normalized key (`anchorCache.get/has`),
- Direct link existence checks against Obsidian link indexes (object key lookup style).

These choices reduce repeated string scans and avoid many linear lookups that would otherwise accumulate in hot paths.

### What is *not* O(1)
Overall graph rebuild cost is **not** constant and depends on visible graph size and link density:

- **Reset/prepare phase:** linear in cached elements (O(N)),
- **First-degree discovery:** scales with outbound + inbound link volume,
- **Cross-network connection pass:** pairwise comparison over visible notes (**O(N²)** in the current model).

So the correct claim is:  
**“O(1)-style cache/index lookups inside a broader pipeline whose total runtime scales with graph size.”**

### Memory behavior
The engine is optimized to **reduce unnecessary allocations**, but does not claim zero allocation:
- Reuses long-lived caches across updates,
- Minimizes repeated normalization in inner loops,
- Avoids redundant recomputation through per-pass flags and token invalidation.

Temporary allocations still occur (for example during array/set materialization and sorting), which is expected in JavaScript/TypeScript runtime behavior.

### Update model and responsiveness
myBrain uses a cooperative update model:
- Debounced update trigger,
- Async yielding during heavier passes,
- Token-based invalidation to stop stale update runs.

This improves UI responsiveness and prevents older async passes from overriding newer navigation state.

### Practical interpretation
In practice, performance is driven by:
1. Number of visible nodes,
2. Number of links among them,
3. Metadata/index readiness in Obsidian at update time.

The current architecture is designed to keep the common path fast while remaining explicit about the non-constant parts of the pipeline.