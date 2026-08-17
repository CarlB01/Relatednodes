# myBrain for Obsidian

✅ **New in 1.0.38**

Hover highlighting for connected links and neighboring nodes

When hovering a link or node, the graph now highlights:

the hovered element,
directly connected links,
neighboring nodes.
This makes relationship tracing much faster and improves readability in dense graphs.

---

[![Obsidian Plugin](https://img.shields.io/badge/Obsidian-Plugin-%23483699.svg?logo=obsidian&logoColor=white)](https://obsidian.md)
[![Available in Community Plugins](https://img.shields.io/badge/Obsidian-Community%20Plugins-success)](https://obsidian.md/plugins?search=myBrain)
[![Release](https://img.shields.io/github/v/release/CarlB01/myBrain)](https://github.com/CarlB01/myBrain/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/CarlB01/myBrain/blob/master/LICENSE)
[![Downloads](https://img.shields.io/github/downloads/CarlB01/myBrain/total)](https://github.com/CarlB01/myBrain/releases)
[![Stars](https://img.shields.io/github/stars/CarlB01/myBrain)](https://github.com/CarlB01/myBrain/stargazers)

> "Structure is liberation. Your notes belong to you, and your graph should think the way you do."

Unlike standard chaotic force-directed link graphs, **myBrain** is a highly structured semantic graph view built for speed, clarity and large vaults. It layouts your notes using a predictable, clean layout matrix relative to your active focused note.

All node partitions, column expansions, and connections are built inside a 100% Hardware-Accelerated CSS Grid. Bypasses text-parsing chains and heavy canvas layers via an O(1) Just-In-Time (JIT) memory mesh.

**Typical display**

<img src="images/mybrain2.gif" alt="myBrain typical display" style="max-width: 100%; width: 500px; height: auto; border-radius: 8px;">

**In a crowded environment**

<img src="images/mybraindemo.gif" alt="myBrain denser example" style="max-width: 100%; width: 500px; height: auto; border-radius: 8px;">

---

## 📦 Installation

### Option 1: Community Plugins (recommended)
* Search for `myBrain` in Obsidian's Community Plugins.
* Click **Install** and then **Enable**.

### Option 2: BRAT (beta/testing)
* Install the `BRAT` plugin from Community Plugins.
* Go to BRAT settings -> Add Beta Plugin.
* Paste this repository URL: `https://github.com/CarlB01/myBrain`

### Option 3: Manual installation
* Download the latest release (`main.js`, `manifest.json`, `styles.css`).
* Create a folder named `mybrain` inside your vault under `.obsidian/plugins/`.
* Move the downloaded files into that folder and restart Obsidian.

---

## 🚀 Quick Start Guide

Get up and running with **myBrain** in less than 2 minutes. The plugin works automatically with your existing links, but you can unlock its full power using note properties (frontmatter).

### 1. The 5-Minute Layout Map
myBrain automatically organizes your vault relative to your active note based on how you link them:

* **Parents:** Add links to your parent notes in the frontmatter properties.
* **Friends:** Lateral peer connections. *Note: Unlike ExcaliBrain, notes do not become friends just by linking to each other. Instead, it is enough that **just one** of the notes explicitly defines the other as a friend in its properties.*
* **Siblings:** Notes that share the exact same parent note. *Note: You do not define siblings manually; myBrain calculates and computes them automatically based on shared parents.*
* **Children:** Standard forward links present inside your body text, or explicitly defined child properties.

💡 **Smart Link Direction:** You don't need to worry about link directionality for hierarchies. Whether a parent links down to a child, or a child links up to a parent, myBrain automatically resolves the relationship and routes them into the correct semantic quadrants.

### 2. Configure Your Note Properties (Optional)
To tell myBrain explicitly how notes are related, add these keys to your note's properties (YAML frontmatter):

```yaml
---
parents: [[My Parent Note]]
children: [[My Child Note]]
friends: [[My Friend Note]]
---
```

*(You can customize these property names under **Settings → myBrain** if you prefer using `up`, `down`, `peer`, etc.).*

### 3. Open the View
You can open the semantic graph view in two ways:

* **Method 1 (Fastest):** Click the ✨ (**Sparkle**) icon in your Obsidian left ribbon/toolbar.
* **Method 2:** Open the command palette (`Ctrl+P` or `Cmd+P`), type `myBrain: Open semantic graph view`, and press Enter.

*Tip: Drag and drop the opened myBrain tab anywhere you like in your workspace sidebar or main layout!*

---

## 🎨 Conceptual Layout Matrix

```text
           PARENTS
             │  \
             │   ---┐
             ▼      ▼
FRIENDS ◄► CENTER   SIBLINGS
             │
             ▼
           CHILDREN 
```
### Architectural Mapping Matrix

| Quadrant Area | Target Content Routing | Sourcing Logic |
| :--- | :--- | :--- |
| **`PARENTS`** *(Upper)* | Native structural ancestors and collection headers. | Sourced explicitly via your configured properties/tags. |
| **`FRIENDS`** *(Left)* | Reciprocal lateral relationships and peer connections. | Routed horizontally via direct cross-links. |
| **`CENTER NOTE`** | The active focus anchor context of the current viewport. | Binds the primary origin coordinates live. |
| **`CHILDREN`** *(Lower)* | Downstream target children and unmapped core links. | Sourced from child fields and raw bodytext tokens. |
| **`SIBLINGS`** *(Right)* | Peer cluster nodes sharing a mutual parent anchor. | Tier 1: Verified frontmatter. Tier 2: Bodytext siblings. |

### How undefined nodes are handled
- Links from the center note that are not explicitly defined as children are treated as **undefined** and automatically gathered at the **bottom of the lower area**.
- In the **Siblings** group, undefined siblings are sorted **last**.

### Collapse groups
When a quadrant contains many nodes of the same type, they can optionally be **collapsed** with a **+/- button** to keep the view clean and readable.

---

## ⚡ Technical Core & Architecture
Unlike standard chaotic force-directed link graphs, myBrain gives you local orientation. Native-style hover previews — peek at note content on hover, consistent with Obsidian's own page preview behavior.

### Flexible workspace placement
The myBrain graph is a normal Obsidian view. Drag its tab and drop it anywhere in the workspace—left or right sidebar, main editor area, or a separate window.

### Native-style hover previews
— peek at note content on hover, consistent with Obsidian’s own page preview behavior.

### 📐 CSS-first visual engine (now pane-adaptive)
myBrain is built on a **CSS-first rendering architecture**: quadrants, column flow, spacing, wrapping, and most interaction styling are handled by native, hardware-accelerated CSS.
* **Now fully pane-adaptive:** The graph dynamically adapts to the exact workspace container it lives in (sidebar, main pane, or detached window).
* **Lightweight runtime assist:** A small TypeScript layer only handles what CSS cannot do alone reliably across all contexts—runtime container measurement, adaptive height caps, redraw timing, and SVG path refresh.
* **Zero Layout-Squeezing:** Nodes are still generated in a protective off-screen render curtain (`.is-calculating`) to reduce visible reflow during render.

### 🚀 Fast JIT Cache Performance
* **No Database Bottlenecks:** Bypasses text-parsing chains and heavy queries during active navigation cycles using an advanced asynchronous Just-In-Time (JIT) memory mesh.
* **Instantaneous Cross-Linking ("Baits"):** Nodes dynamically cast multi-directional anchor tokens so that *"everyone discovers everyone"* across massive datasets instantly.

### Excalibrain-like structure
If your existing structure is Excalibrain-friendly and front-matter based there would be little or no rewrites necessary.

### Supercharged Links Ready
Respects your existing tag-based font colors, customized icons, and core appearance settings natively out of the box.

### Dynamic Top-to-Bottom Column Wrapping
Unlike standard horizontal CSS flex layouts, myBrain utilizes CSS Multi-column layout containers inside its responsive areas. 
* **Design Intent:** This enforces a strict top-to-bottom, left-to-right newspaper-style wrapping for clustered note groups, preserving structural hierarchy without hardcoding element heights.
* **Obsidian Partial Support Mitigation:** To fully shield the layout engine from edge-case Chromium reflow bugs during high-frequency tab swaps, the plugin encapsulates this layout using a protective off-screen render curtain (`.is-calculating`) combined with strict element containment rules (`break-inside: avoid`). This ensures flawless geometric coordinate tracking across both desktop and mobile viewports.

---

## 🔒 Privacy & Data Safety

This plugin triggers an automated notice during the Obsidian community review process called **Vault Enumeration** (due to the use of `vault.getMarkdownFiles()`). 

* **100% Local Processing:** This function is strictly used to map note relationships natively and build your semantic graph in real-time.
* **No External Transmission:** No file paths, note titles, or contents are ever sent to external servers, trackers, or third-party APIs. Your data remains completely yours, offline, and inside your vault.

---

## 📰 The Backstory & Legacy

For decades, the semantic power of mapping information into strict **Parents, Children, Friends, and Siblings** relationships belonged to closed, proprietary database silos. As a healthcare professional, I depended on this structured mode of thought every day.

When Licat and Silver launched Obsidian, it felt like home. When Zsolt introduced *ExcaliBrain*, it was a revelation. I even had the privilege of collaborating briefly with Zsolt to help adapt its behavior to real-world semantic workflows.

However, as the years passed, it became clear that a graph framework bolted onto a heavy vector drawing canvas (*Excalidraw*) introduced rigid limitations. It restricted downstream interface interactions and made dynamic scaling harder than necessary.

When Zsolt hinted at gatherings that it was time for a native implementation to take over, I accepted the challenge. I went back to the drawing board—mapping out how nodes could dynamically project into strict semantic quadrants without sacrificing speed.

**myBrain** is the result: a clean, uncompromising, lightning-fast native implementation designed to bring cognitive structure back to the user on their own terms.

---

## 🔮 Roadmap & Future Horizons

- [x] Colorize Lines & Gates: This update adds colorization for relationship lines and gate nodes, improving readability and direction-scanning in dense graphs.
- [ ] Interactive context popup menus to add parents/children on the fly.
- [ ] Multi-generation expansion toggles to view grandparents/grandchildren rows.
- [ ] Inline node image decoding when targeted hyperlink references represent image assets.
- [ ] Specialized handling of decrypted content blocks protected by *Meld Encrypt* (if possible).

---

## 🤝 Acknowledgments

This plugin would not exist without the immense inspiration, code legacy studies, and cognitive frameworks pioneered by:

* **Harlan and the creators of TheBrain** for proving that structured association is a beautiful way to organize human knowledge.
* **Zsolt Viczián** for creating *ExcaliBrain*, for the short and motivating period of collaboration, and for inspiring the native renaissance of this structure.
* **Licat and Silver** for giving the world Obsidian, an extensible, local-first ecosystem where we can build anything.

---

*Developed with passion by a healthcare worker who loves graphs and believes semantic structure should belong to everyone. If you enjoy this work, consider starring the repository!*
