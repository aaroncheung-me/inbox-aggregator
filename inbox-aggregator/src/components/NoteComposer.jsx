import { useState } from 'react';
import { formatReminder, noteTitle } from '../notes';
import { EmailLinkPicker, NoteLinkPicker, ReminderPicker } from './NoteAddonPickers';
import VoiceButton from './VoiceButton';
import { useVoiceRecorder } from '../hooks/useVoiceRecorder';
import { transcribeRecording } from '../api';

const KIND_ORDER = ['reminder', 'pin', 'email_link', 'note_link'];

// Writing a new note: text plus any add-ons, all saved together.
// Not a <form>: the email picker inside has its own search form, and forms can't nest.
// Used by the box at the top of Notes and by "+ Note" on an email.
//
// fixedAddons: add-ons that always come with this note and can't be removed
//   here, as { addon, label } (e.g. the link to the email being noted).
// notes: the user's notes, to pick from when linking one.
// onSave(body, addons): saves as written. onAiSave(body, addons): lets the AI
//   rewrite it and add more. Both resolve once saved; the composer then clears.
//   With onAiSave there's also a Voice button: speak, and it's AI-saved at once.
function NoteComposer({ notes, fixedAddons = [], onSave, onAiSave, onCancel, placeholder, className = '', autoFocus = false }) {
  const [draft, setDraft] = useState('');
  // add-ons picked but not saved yet: [{ addon, label }]
  const [pending, setPending] = useState([]);
  const [picker, setPicker] = useState(null); // 'reminder' | 'email' | 'note' | null
  const [menuOpen, setMenuOpen] = useState(false);
  const [saving, setSaving] = useState(null); // null | 'plain' | 'ai'
  const [error, setError] = useState(null);

  const has = kind => pending.some(p => p.addon.kind === kind);
  const reminder = pending.find(p => p.addon.kind === 'reminder');
  const linkedNoteIds = new Set(pending.filter(p => p.addon.kind === 'note_link').map(p => p.addon.noteId));
  const linkableNotes = notes.filter(note => !linkedNoteIds.has(note.id));

  // One reminder and one pin at most; the same email or note isn't added twice.
  // Kept in a fixed order (reminder, pin, emails, notes) rather than the order picked.
  function addPending(addon, label) {
    setPending(prev => {
      const others = prev.filter(p => {
        if (p.addon.kind !== addon.kind) return true;
        if (addon.kind === 'reminder' || addon.kind === 'pin') return false;
        if (addon.kind === 'email_link') return p.addon.messageId !== addon.messageId;
        return p.addon.noteId !== addon.noteId;
      });
      return [...others, { addon, label }].sort((a, b) => KIND_ORDER.indexOf(a.addon.kind) - KIND_ORDER.indexOf(b.addon.kind));
    });
    setPicker(null);
    setMenuOpen(false);
  }

  function removePending(index) {
    setPending(prev => prev.filter((_, i) => i !== index));
  }

  // mode: 'plain' (Save) or 'ai' (AI save). Throws if saving fails.
  async function saveAs(mode, body) {
    setSaving(mode);
    setError(null);
    try {
      const save = mode === 'ai' ? onAiSave : onSave;
      await save(body, [...fixedAddons, ...pending].map(p => p.addon));
      setDraft('');
      setPending([]);
      setPicker(null);
    } finally {
      setSaving(null);
    }
  }

  // On failure the text and chips stay, so nothing is lost.
  async function handleSave(mode) {
    const body = draft.trim();
    if (!body || saving) return;
    try {
      await saveAs(mode, body);
    } catch (err) {
      setError(err.message);
    }
  }

  // Voice always goes through AI save, straight away. What's spoken is added to
  // anything already typed. If saving fails, the words land in the box instead.
  const voice = useVoiceRecorder(async recording => {
    const spoken = await transcribeRecording(recording);
    const body = [draft.trim(), spoken].filter(Boolean).join('\n');
    try {
      await saveAs('ai', body);
    } catch (err) {
      setDraft(body);
      throw err;
    }
  });

  function openPicker(kind) {
    setPicker(kind);
    setMenuOpen(false);
  }

  return (
    <div className={`note-composer ${className}`}>
      <textarea
        value={draft}
        onChange={e => setDraft(e.target.value)}
        // Ctrl+Enter (Cmd+Enter on Mac) saves as written
        onKeyDown={e => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            handleSave('plain');
          }
        }}
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
          onPick={remindAt => addPending({ kind: 'reminder', remindAt }, `Remind: ${formatReminder(remindAt)}`)}
          onCancel={() => setPicker(null)}
        />
      )}
      {picker === 'email' && (
        <EmailLinkPicker
          onPick={message => addPending({ kind: 'email_link', messageId: message.id }, `Email: ${message.subject || '(no subject)'}`)}
          onCancel={() => setPicker(null)}
        />
      )}
      {picker === 'note' && (
        <NoteLinkPicker
          notes={linkableNotes}
          onPick={note => addPending({ kind: 'note_link', noteId: note.id }, `Note: ${noteTitle(note.body)}`)}
          onCancel={() => setPicker(null)}
        />
      )}

      {(error || voice.error) && <p className="form-error">{error || voice.error}</p>}

      {!picker && (
        <div className="composer-actions">
          <div className="add-addon">
            <button type="button" className="btn btn-ghost btn-small" onClick={() => setMenuOpen(prev => !prev)} aria-expanded={menuOpen}>
              + Add
            </button>
            {menuOpen && (
              <div className="add-addon-options">
                <button type="button" onClick={() => openPicker('reminder')}>{reminder ? 'Change reminder' : 'Reminder'}</button>
                <button type="button" onClick={() => openPicker('email')}>Link email</button>
                <button type="button" onClick={() => openPicker('note')}>Link note</button>
                {!has('pin') && <button type="button" onClick={() => addPending({ kind: 'pin' }, 'Pinned')}>Pin</button>}
              </div>
            )}
          </div>
          <div className="composer-save">
            {onCancel && (
              <button type="button" className="btn btn-ghost btn-small" onClick={onCancel}>Cancel</button>
            )}
            {onAiSave && (
              <VoiceButton recorder={voice} workingLabel="AI saving..." disabled={!!saving} />
            )}
            {onAiSave && (
              <button
                type="button"
                className="btn btn-ghost btn-small"
                onClick={() => handleSave('ai')}
                disabled={!draft.trim() || saving}
                title="Let the AI tidy the text and add a reminder, pin or links"
              >
                {saving === 'ai' ? 'AI saving...' : 'AI save'}
              </button>
            )}
            <button type="button" className="btn btn-small" onClick={() => handleSave('plain')} disabled={!draft.trim() || saving}>
              {saving === 'plain' ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default NoteComposer;
