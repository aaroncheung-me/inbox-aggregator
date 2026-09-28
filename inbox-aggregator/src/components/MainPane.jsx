import ChatPanel from './ChatPanel';
import EmailDetail from './EmailDetail';
import NoteDetail from './NoteDetail';

// Shows one of: the selected email, the selected note, or the assistant chat.
// noteActions: { onSaveBody, onDelete, onAddAddon, onUpdateAddon, onRemoveAddon, onOpenNote, onCreate, onAiCreate }
// aiHeadsUp: { noteId, message } from the last AI save, shown on that note.
function MainPane({
  selectedMessageId,
  selectedMessage,
  selectedAccount,
  messageLoading,
  messageError,
  selectedNote,
  notes,
  now,
  noteActions,
  aiHeadsUp,
  onDismissAiHeadsUp,
  chatHistory,
  chatLoading,
  chatError,
  onOpenMessage,
  onUndoCreatedNote,
  onCloseMessage,
  onBackToList,
  backLabel,
}) {
  let content;
  if (selectedNote) {
    content = (
      <NoteDetail
        key={selectedNote.id}
        note={selectedNote}
        notes={notes}
        now={now}
        onSaveBody={noteActions.onSaveBody}
        onDelete={noteActions.onDelete}
        onAddAddon={noteActions.onAddAddon}
        onUpdateAddon={noteActions.onUpdateAddon}
        onRemoveAddon={noteActions.onRemoveAddon}
        onOpenMessage={onOpenMessage}
        onOpenNote={noteActions.onOpenNote}
        headsUp={aiHeadsUp?.noteId === selectedNote.id ? aiHeadsUp.message : null}
        onDismissHeadsUp={onDismissAiHeadsUp}
      />
    );
  } else if (selectedMessageId != null) {
    content = (
      <>
        {chatHistory.length > 0 && (
          <button className="back-link" onClick={onCloseMessage}>← Back to assistant</button>
        )}
        <EmailDetail
          message={selectedMessage}
          account={selectedAccount}
          loading={messageLoading}
          error={messageError}
          now={now}
          allNotes={notes}
          onOpenNote={noteActions.onOpenNote}
          onCreateNote={noteActions.onCreate}
          onAiCreateNote={noteActions.onAiCreate}
        />
      </>
    );
  } else {
    content = (
      <ChatPanel
        history={chatHistory}
        loading={chatLoading}
        error={chatError}
        onOpenMessage={onOpenMessage}
        onOpenNote={noteActions.onOpenNote}
        onUndoCreatedNote={onUndoCreatedNote}
      />
    );
  }

  return (
    <div className="main-pane">
      {/* phone layout only: the list is a separate screen there */}
      <button className="phone-back phone-only" onClick={onBackToList}>← {backLabel}</button>
      {content}
    </div>
  );
}

export default MainPane;
