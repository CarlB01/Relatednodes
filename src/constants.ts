/**
 * Global Constants Dictionary for minBrain Related Notes Network.
 * Structured cleanly into architectural categories for production release.
 */
export const RV = {
  // ==========================================================================
  // Obsidian View Identifiers
  // ==========================================================================
  RELATED_NOTES_VIEW_TYPE: 'mybrain-view',
  
  // Core application visual node icon
  ICON: 'brain',

  // ==========================================================================
  // High-Level DOM Containers
  // ==========================================================================
  CONTAINER: 'rv-container',
  RELATED_VIEW_CONTAINER: 'rv-container',
  SVG_LAYER: 'rv-svg-layer',
  
  // ==========================================================================
  // Network Graph Area Quadrants
  // ==========================================================================
  AREA_CENTER: 'rv-area center',
  AREA_LEFT: 'rv-area left',
  AREA_RIGHT: 'rv-area right',
  AREA_TOP: 'rv-area upper',
  AREA_BOTTOM: 'rv-area lower',
  
  // ==========================================================================
  // Tier Collections & Column Flow Wrappers
  // ==========================================================================
  COLLECTION_WRAPPER: 'rv-collection-wrapper',
  COLLECTION: 'rv-collection',
  COL_WRAPPER: 'rv-columns-wrapper',
  GROUPS: 'rv-groups',

  // ==========================================================================
  // Hyperlink Anatomy & Target Node Classes
  // ==========================================================================
  LINKDIV: 'rv-linkdiv',
  
  /* 
   * Hyperlink base classes. Restored 'internal-link' natively at birth
   * to ensure maximum compatibility and clean native core alignment.
   */
  A: 'internal-link focusable-note-link',
  SPAN: 'rv-text-span',

  // ==========================================================================
  // Interactive Controls, Toggles & Badges
  // ==========================================================================
  INFO_BTN: 'rv-info-button',
  INFO_HOVER: 'rv-info-hover',
  PLUS_MINUS_BTN: 'rv-plusminus',
  BORDERED: 'bordered-div',
  ROUNDED: 'rounded-div',
  MINUS: '−',
  PLUS: '+',

  // Geometrical vector docking connectors
  GATE_SVG: 'rv-gate-svg',
  
  // ==========================================================================
  // Dataset Responsive Reflow Properties
  // ==========================================================================
  LEFT_TALL: 'data-left-tall',
  RIGHT_TALL: 'data-right-tall',

  // Coordinates mathematical rendering factor
  FACTOR: 1,

  // Empty view state instructional text
  WELCOME: 'Please allow obsidian some time to prepare the files! \n'
      + 'To view graph, please open one of your notes.',

  // ==========================================================================
  // Third-Party Ecosystem Overrides
  // ==========================================================================
  
  /* 
   * Supercharged Links Compatibility Hooks: 
   * Preserves downstream element discovery matching tag-based attributes.
   */
  SUPERCHARGED_ATTRIB: 'data-link-icon data-link-icon-after data-link-text',

} as const;
