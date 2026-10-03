// Dragging things to open them (desktop): an email or note from a list onto
// the tab bar or the page opens it in a new tab; a list row or a tab onto
// either half of the writing screen shows it beside the email being written.

const ITEM_TYPE = 'application/x-inbox-item';
const TAB_TYPE = 'application/x-inbox-tab';

// Props for a list row. item: { kind: 'email' | 'note', id, label?, color? }
export function dragItemProps(item) {
  return {
    draggable: true,
    onDragStart: e => {
      e.dataTransfer.setData(ITEM_TYPE, JSON.stringify(item));
      e.dataTransfer.effectAllowed = 'copy';
    },
  };
}

export const isItemDrag = e => [...e.dataTransfer.types].includes(ITEM_TYPE);

// the dragged item, on drop
export function droppedItem(e) {
  try {
    return JSON.parse(e.dataTransfer.getData(ITEM_TYPE));
  } catch {
    return null;
  }
}

export function startTabDrag(e, key) {
  e.dataTransfer.setData(TAB_TYPE, key);
  e.dataTransfer.effectAllowed = 'move';
}

export const isTabDrag = e => [...e.dataTransfer.types].includes(TAB_TYPE);

export const droppedTab = e => e.dataTransfer.getData(TAB_TYPE) || null;

// A middle click, as props: auxclick doesn't fire on draggable elements, so
// it's the middle button's release (its press is kept from starting the
// browser's autoscroll).
export function middleClickProps(onMiddleClick) {
  return {
    onMouseDown: e => { if (e.button === 1) e.preventDefault(); },
    onMouseUp: e => { if (e.button === 1) onMiddleClick(e); },
  };
}
