// The Inbox | Notes switch at the top of the sidebar. The count shows how many
// reminders are due; it's the only way reminders get your attention (no notifications).
function SidebarTabs({ tab, onChange, dueCount }) {
  return (
    <div className="sidebar-tabs" role="tablist">
      <button role="tab" aria-selected={tab === 'inbox'} className={tab === 'inbox' ? 'active' : ''} onClick={() => onChange('inbox')}>
        Inbox
      </button>
      <button role="tab" aria-selected={tab === 'notes'} className={tab === 'notes' ? 'active' : ''} onClick={() => onChange('notes')}>
        Notes
        {dueCount > 0 && (
          <span className="due-count" aria-label={`${dueCount} reminder${dueCount === 1 ? '' : 's'} due`}>{dueCount}</span>
        )}
      </button>
    </div>
  );
}

export default SidebarTabs;
