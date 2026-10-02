// Desktop: the strip of open tabs along the top of the main pane, all the
// same width. A temporary tab (not yet used) shows in italics. Closing a tab
// is its ×, or a middle click.
// tabs: [{ key, kind, label, color, kept }], kind 'email' (with its account
// color), 'note', 'draft' or another page.
function OpenTabs({ tabs, activeKey, onShow, onClose }) {
  return (
    <div className="open-tabs desktop-only">
      <div className="open-tabs-list" role="tablist" aria-label="Open">
        {tabs.map(t => (
          <div
            key={t.key}
            className={`open-tab${t.key === activeKey ? ' active' : ''}${t.kept ? '' : ' temporary'}`}
            title={t.label}
            onAuxClick={e => { if (e.button === 1) onClose(t.key); }}
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
      </div>
    </div>
  );
}

export default OpenTabs;
