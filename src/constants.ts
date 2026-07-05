export const RV_CLASSES = {
  RELATED_NOTES_VIEW_TYPE: 'relatednotes-view',
  RELATED_SIDEBAR_PANEL_TYPE: 'related-sidebar-view',

  // Icon
  ICON: 'lucide-apple',

  // Container
  RELATED_VIEW_CONTAINER: 'rv-container',
  CONTAINER: 'rv-container',
  SVG_LAYER: 'rv-svg-layer',
  
  // Kvadranter
  AREA_CENTER: 'rv-area center',
  AREA_LEFT: 'rv-area left',
  AREA_RIGHT: 'rv-area right',
  AREA_TOP: 'rv-area upper',
  AREA_BOTTOM: 'rv-area lower',
  
  // Samlinger og grupper
  COLLECTION: 'rv-collection',
  COL_WRAPPER: 'rv-columns-wrapper',
  GROUPS: 'rv-groups',

  // Links
  LINK: 'rv-linkdiv',
  A: 'internal-link focusable-note-link relatednotes-text',

  //Buttons
  INFO_BTN: 'rv-info-button',
  INFO_HOVER: 'rv-info-hover',
  PLUS_MINUS_BTN: 'rv-plusminus',
  BORDERED: 'bordered-div',
  ROUNDED: 'rounded-div',
  MINUS: '−',
  PLUS: '+',

  //Gates
  GATE_SVG: 'rv-gate-svg',
  
  // Data-attributter
  LEFT_TALL: 'data-left-tall',
  RIGHT_TALL: 'data-right-tall',

  // Drawing
  GATE_COLOR: 'var(--bases-table-header-color)',
  RADIUS: 2.5,
  FACTOR: 1,

  // Welcome
    WELCOME: 'to view related notes, please open one of your notes first',

  // Supercharged Links compatible
  SUPERCHARGED_ATTRIB: 'data-link-icon data-link-icon-after data-link-text',

} as const;
