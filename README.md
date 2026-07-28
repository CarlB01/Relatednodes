# myBrain for Obsidian

[![Obsidian Plugin](https://img.shields.io/badge/Obsidian-Plugin-%23483699.svg?logo=obsidian&logoColor=white)](https://obsidian.md)
[![Release](https://img.shields.io/github/v/release/CarlB01/myBrain)](https://github.com/CarlB01/myBrain/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/CarlB01/myBrain/blob/master/LICENSE)
[![Downloads](https://img.shields.io/github/downloads/CarlB01/myBrain/total)](https://github.com/CarlB01/myBrain/releases)
[![Stars](https://img.shields.io/github/stars/CarlB01/myBrain)](https://github.com/CarlB01/myBrain/stargazers)

> "Structure is liberation. Your notes belong to you, and your graph should think the way you do."

**myBrain** is a high-performance, strictly native semantic network graph for Obsidian.

It organizes your notes into a clean and predictable layout with **Parents · Friends · Center · Children · Siblings** — built for speed, clarity and large vaults.

<img src="images/showcase.gif" alt="myBrain Interface Showcase" style="max-width: 100%; height: auto; border-radius: 8px;">

---

## 📦 Installation

### Option 1: BRAT (recommended for now)
1. Install the [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin
2. Open **Settings → BRAT → Add Beta plugin**
3. Enter: `CarlB01/myBrain`
4. Click **Add Plugin**

### Option 2: Community Plugins (after approval)
1. Open **Settings → Community Plugins**
2. Search for **myBrain**
3. Click **Install**, then **Enable**

### Option 3: Manual installation
1. Download the latest release from [Releases](https://github.com/CarlB01/myBrain/releases)
2. Create the folder `.obsidian/plugins/mybrain/` in your vault
3. Place these files in the folder:
   - `main.js`
   - `manifest.json`
   - `styles.css`
4. Restart Obsidian (or reload plugins)
5. Enable **myBrain** under Community Plugins

---

## ⚡ Technical Core & Architecture

Unlike standard chaotic force-directed link graphs, **myBrain** routes information into a highly organized, predictable layout matrix relative to your active focused note.

### 📐 100% Hardware-Accelerated CSS Grid
All node partitions, column expansions, and quadrant assignments are managed **100% by native, hardware-accelerated CSS Grid infrastructure** instead of heavy, laggy JavaScript calculation matrices. 
* **Zero Layout-Squeezing:** Nodes are generated in a protective off-screen render curtain (`.is-calculating`) to completely isolate DOM reflows. 
* **Predictable Layouts:** Quadrants expand fluidly only when needed, preserving snappier multi-direction responses.
* **Supercharged Links Ready:** Respects your existing tag-based font colors, customized icons, and core appearance settings natively out of the box.

### 🚀 Pure O(1) JIT Cache Performance
* **No Database Bottlenecks:** Bypasses text-parsing chains and heavy queries during active navigation cycles using an advanced asynchronous Just-In-Time (JIT) memory mesh.
* **Instantaneous Cross-Linking ("Baits"):** Nodes dynamically cast multi-directional anchor tokens so that *"everyone discovers everyone"* across massive datasets instantly.

---

## 🎨 Conceptual Layout Matrix

```text
               [ PARENTS ]
                    │  \
                    │   - - - ┐
                    ▼         ▼
  [ FRIENDS ] ◄► [ CENTER ]  [ SIBLINGS ]
                    │
                    ▼
               [ CHILDREN ]
```

### Architectural Mapping Matrix

| Quadrant Area | Target Content Routing | Sourcing Logic |
| :--- | :--- | :--- |
| **`[ PARENTS ]`** *(Upper)* | Native structural ancestors and collection headers. | Sourced explicitly via your configured properties/tags. |
| **`[ FRIENDS ]`** *(Left)* | Reciprocal lateral relationships and peer connections. | Routed horizontally via direct cross-links. |
| **`[ CENTER NOTE ]`** | The active focus anchor context of the current viewport. | Binds the primary origin coordinates live. |
| **`[ CHILDREN ]`** *(Lower)* | Downstream target children and unmapped core links. | Sourced from child fields and raw bodytext tokens. |
| **`[ SIBLINGS ]`** *(Right)* | Peer cluster nodes sharing a mutual parent anchor. | Tier 1: Verified frontmatter. Tier 2: Bodytext siblings. |

---

## 📰 The Backstory & Legacy

For decades, the semantic power of mapping information into strict **Parents, Children, Friends, and Siblings** relationships belonged to closed, proprietary database silos. As a healthcare professional navigating intensive daily workflows, I searched for alternative architectures that combined this specific cognitive layout with local, secure data ownership. 

When Licat and Silver launched Obsidian, it felt like home. When Zsolt introduced *ExcaliBrain*, it was a revelation. I even had the privilege of collaborating briefly with Zsolt to help adapt its behavior toward mobile touchscreens and sidebar layouts. 

However, as the years passed, it became clear that a graph framework bolted onto a heavy vector drawing canvas (*Excalidraw*) introduced rigid limitations. It restricted downstream interface interactions like native contextual popup menus, localized styling, drag-and-drop mechanics, or integration with decrypting tools like *Meld Encrypt*. 

When Zsolt hinted at gatherings that it was time for a native implementation to take over, I accepted the challenge. I went back to the drawing board—mapping out how nodes could dynamically project multi-directional network anchors using links and backlinks. If you are an *ExcaliBrain* user, your files are **already 100% compatible** with **myBrain**. Your years of structured data will render beautifully on day one.

**myBrain** is the result: a clean, uncompromising, lightning-fast native implementation designed to bring cognitive structure back to the user on their own terms.

---

## 🔮 Roadmap & Future Horizons

This is only the baseline foundation of a completely native semantic framework. Planned milestones include:
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

