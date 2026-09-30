// Received | Sent, above the inbox list. folder: 'inbox' or 'sent'.
function FolderSwitch({ folder, onChange }) {
  return (
    <div className="mode-toggle folder-switch" role="group" aria-label="Which mail to list">
      <button type="button" className={folder === 'inbox' ? 'active' : ''} aria-pressed={folder === 'inbox'} onClick={() => onChange('inbox')}>
        Received
      </button>
      <button type="button" className={folder === 'sent' ? 'active' : ''} aria-pressed={folder === 'sent'} onClick={() => onChange('sent')}>
        Sent
      </button>
    </div>
  );
}

export default FolderSwitch;
