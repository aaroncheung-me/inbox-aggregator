import { useState } from 'react';
import { formatReminder, noteTitle } from '../notes';
import { EmailLinkPicker, NoteLinkPicker, ReminderPicker } from './NoteAddonPickers';

// Writing a new note: text plus any add-ons, all saved together with one Save.
// Not a <form>: the email picker inside has its own search form, and forms can't nest.
// Used by the box at the top of Notes and by "+ Note" on an email.
//
// fixedAddons: add-ons that always come with this note and can't be removed
//   here, as { addon, label } (e.g. the link to the email being noted).
// notes: the user's notes, to pick from when linking one.
// onSave(body, addons) resolves once saved; the composer then clears itself.
function NoteComposer({ notes, fixedAddons = [], onSave, onCancel, placeholder, className = '', autoFocus = false }) {
  const [draft, setDraft] = useState('');
  // add-ons picked but not saved yet: [{ addon, label }]
  const [pending, setPending] = useState([]);
  const [picker, setPicker] = useState(null); // 'reminder' | 'email' | 'note' | null
  const [menuOpen, setMenuOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const has = kind => pending.some(p => p.addon.kind === kind);
  const reminder = pending.find(p => p.addon.kind === 'reminder');
  const linkedNoteIds = new Set(pending.filter(p => p.addon.kind === 'note_link').map(p => p.addon.noteId));
  const linkableNotes = notes.filter(note => !linkedNoteIds.has(note.id));

  // one reminder and one pin at most; the same email or note isn't added twice
  function addPending(addon, label) {
    setPending(prev => {
      const others = prev.filter(p => {
        if (p.addon.kind !== addon.kind) return true;
        if (addon.kind === 'reminder' || addon.kind === 'pin') return false;
        if (addon.kind === 'email_link') return p.addon.messageId !== addon.messageId;
        return p.addon.noteId !== addon.noteId;
      });
      return [...others, { addon, label }];
    });
    setPicker(null);
    setMenuOpen(false);
  }

  function removePending(index) {
    setPending(prev => prev.filter((_, i) => i !== index));
  }

  async function handleSave(e) {
    e?.preventDefault();
    const body = draft.trim();
    if (!body || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(body, [...fixedAddons, ...pending].map(p => p.addon));
      setDraft('');
      setPending([]);
      setPicker(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function openPicker(kind) {
    setPicker(kind);
    setMenuOpen(false);
  }

  return (
    <div className={`note-composer ${className}`}>
      <textarea
        value={draft}
        onChange={e => setDraft(e.target.value)}
        // Ctrl+Enter (Cmd+Enter on Mac) saves
        onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleSave(e); }}
        placeholder={placeholder}
        aria-label={placeholder}
        rows={2}
        autoFocus={autoFocus}
      />

      {(fixedAddons.length > 0 || pending.length > 0) && (
        <div className="composer-addons">
          {fixedAddons.map(p => (
            <span key={p.label} className="addon-chip fixed">
              <span className="addon-chip-main">{p.label}</span>
            </span>
          ))}
          {pending.map((p, i) => (
            <span key={`${p.addon.kind}-${p.label}`} className="addon-chip">
              <span className="addon-chip-main">{p.label}</span>
              <button type="button" className="addon-remove" onClick={() => removePending(i)} aria-label={`Remove ${p.label}`}>×</button>
            </span>
          ))}
        </div>
      )}

      {picker === 'reminder' && (
        <ReminderPicker
          initial={reminder?.addon.remindAt}
          onPick={remindAt => addPending({ kind: 'reminder', remindAt }, `⏰ ${formatReminder(remindAt)}`)}
          onCancel={() => setPicker(null)}
        />
      )}
      {picker === 'email' && (
        <EmailLinkPicker
          onPick={message => addPending({ kind: 'email_link', messageId: message.id }, `✉ ${message.subject || '(no subject)'}`)}
          onCancel={() => setPicker(null)}
        />
      )}
      {picker === 'note' && (
        <NoteLinkPicker
          notes={linkableNotes}
          onPick={note => addPending({ kind: 'note_link', noteId: note.id }, `🗒 ${noteTitle(note.body)}`)}
          onCancel={() => setPicker(null)}
        />
      )}

      {error && <p className="form-error">{error}</p>}

      {!picker && (
        <div className="composer-actions">
          <div className="add-addon">
            <button type="button" className="btn btn-ghost btn-small" onClick={() => setMenuOpen(prev => !prev)} aria-expanded={menuOpen}>
              + Add
            </button>
            {menuOpen && (
              <div className="add-addon-options">
                <button type="button" onClick={() => openPicker('reminder')}>⏰ {reminder ? 'Change reminder' : 'Reminder'}</button>
                <button type="button" onClick={() => openPicker('email')}>✉ Link email</button>
                <button type="button" onClick={() => openPicker('note')}>🗒 Link note</button>
                {!has('pin') && <button type="button" onClick={() => addPending({ kind: 'pin' }, '📌 Pinned')}>📌 Pin</button>}
              </div>
            )}
          </div>
          <div className="composer-save">
            {onCancel && (
              <button type="button" className="btn btn-ghost btn-small" onClick={onCancel}>Cancel</button>
            )}
            <button type="button" className="btn btn-small" onClick={handleSave} disabled={!draft.trim() || saving}>
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default NoteComposer;
