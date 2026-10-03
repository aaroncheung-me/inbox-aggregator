import { useState } from 'react';
import { droppedItem, isItemDrag, middleClickProps, startTabDrag } from '../ui/dragItem';

// Desktop: the strip of open tabs along the top of the main pane, all the
// same width, then "+" for a new empty tab. Closing a tab is its ×, or a
// middle click. Dropping an email or note from a list here opens it in a new
// tab, where it's dropped (onDropItem(item, index)). Tabs can be dragged onto
// the writing screen, to show them beside the email being written (MainPane).
// tabs: [{ key, kind, label, color }], kind 'email' (with its account
// color), 'note', 'draft', 'empty' or another page. besideKey: the tab showing
// beside the email being written.
function OpenTabs({ tabs, activeKey, besideKey, onShow, onClose, onNewTab, onDropItem }) {
  const [dropping, setDropping] = useState(false);

  function allowDrop(e) {
    if (!isItemDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setDropping(true);
  }

  // dropped on a tab: after it; elsewhere on the strip: at the end
  function drop(e, index = tabs.length) {
    setDropping(false);
    const item = droppedItem(e);
    if (!item) return;
    e.preventDefault();
    e.stopPropagation();
    onDropItem(item, index);
  }

  return (
    <div
      className={`open-tabs desktop-only${dropping ? ' dropping' : ''}`}
      onDragOver={allowDrop}
      onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setDropping(false); }}
      onDrop={e => drop(e)}
    >
      <div className="open-tabs-list" role="tablist" aria-label="Open">
        {tabs.map((t, i) => (
          <div
            key={t.key}
            className={`open-tab${t.key === activeKey ? ' active' : ''}${t.key === besideKey ? ' beside' : ''}`}
            title={t.label}
            draggable={t.kind !== 'draft'}
            onDragStart={e => startTabDrag(e, t.key)}
            onDrop={e => drop(e, i + 1)}
            {...middleClickProps(() => onClose(t.key))}
          >
            <button
              className="open-tab-main"
              role="tab"
              aria-selected={t.key === activeKey}
              onClick={() => onShow(t.key)}
            >
              {t.kind === 'email' && <span className="open-tab-dot" style={{ background: t.color }} aria-hidden="true" />}
              {t.kind === 'note' && <span className="open-tab-kind">Note</span>}
              {t.kind === 'draft' && <span className="open-tab-kind writing">Writing</span>}
              <span className="open-tab-label">{t.label}</span>
            </button>
            <button className="open-tab-close" onClick={() => onClose(t.key)} aria-label={`Close ${t.label}`}>×</button>
          </div>
        ))}
        <button className="open-tabs-add" onClick={onNewTab} aria-label="New tab" title="New tab">+</button>
      </div>
    </div>
  );
}

export default OpenTabs;
