import { useEffect, useState } from 'react';
import { droppedItem, droppedTab, isItemDrag, isTabDrag } from '../ui/dragItem';

const ZONE_LABELS = {
  left: 'Beside the email you\'re writing, on the left',
  right: 'Beside the email you\'re writing, on the right',
  tab: 'Open in a new tab',
};

// Where a dragged email, note or tab can be dropped on the page (desktop).
// While writing: either half, to show it beside the draft on that side
// (onDropBeside({ item } | { tabKey }, side)). Otherwise anywhere, to open a
// list row in a new tab (onDropItem(item)).
// The zones show from the moment a list row or tab starts being dragged (they
// then cover the email frames, which would swallow the drag), until the drag
// ends anywhere or is cancelled.
function DropZones({ writing, onDropItem, onDropBeside }) {
  const [dragKind, setDragKind] = useState(null); // 'item' (from a list) or 'tab'
  const [overZone, setOverZone] = useState(null);

  useEffect(() => {
    const start = e => {
      if (isItemDrag(e)) setDragKind('item');
      else if (isTabDrag(e)) setDragKind('tab');
    };
    const reset = () => {
      setDragKind(null);
      setOverZone(null);
    };
    window.addEventListener('dragstart', start);
    window.addEventListener('dragend', reset);
    window.addEventListener('drop', reset);
    return () => {
      window.removeEventListener('dragstart', start);
      window.removeEventListener('dragend', reset);
      window.removeEventListener('drop', reset);
    };
  }, []);

  let zones = [];
  if (dragKind && writing) zones = ['left', 'right'];
  else if (dragKind === 'item') zones = ['tab'];
  if (!zones.length) return null;

  function drop(e, zone) {
    e.preventDefault();
    const item = isItemDrag(e) ? droppedItem(e) : null;
    const tabKey = item ? null : droppedTab(e);
    setDragKind(null);
    setOverZone(null);
    if (zone === 'tab') {
      if (item) onDropItem(item);
    } else if (item || tabKey) {
      onDropBeside(item ? { item } : { tabKey }, zone);
    }
  }

  return (
    <div className="drop-zones">
      {zones.map(zone => (
        <div
          key={zone}
          className={`drop-zone${overZone === zone ? ' over' : ''}`}
          onDragOver={e => {
            e.preventDefault();
            setOverZone(zone);
          }}
          onDragLeave={() => setOverZone(null)}
          onDrop={e => drop(e, zone)}
        >
          {ZONE_LABELS[zone]}
        </div>
      ))}
    </div>
  );
}

export default DropZones;
