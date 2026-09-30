import ChatPanel from '../features/assistant/ChatPanel';
import ComposeView from '../features/compose/ComposeView';
import EmailDetail from '../features/email/EmailDetail';
import NoteDetail from '../features/notes/NoteDetail';
import SettingsPage from '../features/settings/SettingsPage';
import PaneBar from '../ui/PaneBar';

// Shows one of: the email being written, Settings, the selected note, the
// selected email, or the assistant chat. Each starts with the same top bar (PaneBar), whose left
// end is worked out here: on a phone, back to the list; on desktop, back to the
// email being written or to the assistant, when there's one to go back to.
// noteActions: { onSaveBody, onDelete, onAddAddon, onUpdateAddon, onRemoveAddon, onOpenNote, onCreate, onAiCreate }
// aiHeadsUp: { noteId, message } from the last AI save, shown on that note.
// compose: the email being written, or null: { draft, visible, accounts, sending,
//   onChange, onSend, onDiscard, onUndoAiDraft, onShowAssistant, onShow, onAddFiles, onRemoveAttachment }.
function MainPane({
  selectedMessageId,
  selectedMessage,
  selectedAccount,
  tempColors,
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
  chatPending,
  chatError,
  onOpenMessage,
  onUndoCreatedNote,
  onCloseMessage,
  onBackToList,
  backLabel,
  onReply,
  onTogglePin,
  compose,
  settingsVisible = false,
  // for Settings: the accounts, whose signatures it edits
  accounts = [],
  onChangeSignature,
  // phone only: the ask box and Inbox | Notes, kept above every page but the writing screen
  phoneHeader = null,
}) {
  let desktopBack = null;
  if (compose) {
    desktopBack = { label: '← Back to email', onClick: compose.onShow };
  } else if (selectedMessageId != null && !selectedNote && chatHistory.length > 0) {
    desktopBack = { label: '← Assistant', onClick: onCloseMessage };
  }
  const back = (
    <>
      {/* on a phone the header's tabs lead back to the lists instead */}
      {!phoneHeader && <button className="pane-back phone-only" onClick={onBackToList}>← {backLabel}</button>}
      {desktopBack && (
        <button className="pane-back desktop-only" onClick={desktopBack.onClick}>{desktopBack.label}</button>
      )}
    </>
  );

  let content;
  if (compose?.visible) {
    content = (
      <ComposeView
        draft={compose.draft}
        accounts={compose.accounts}
        sending={compose.sending}
        onChange={compose.onChange}
        onSend={compose.onSend}
        onDiscard={compose.onDiscard}
        onUndoAiDraft={compose.onUndoAiDraft}
        onShowAssistant={compose.onShowAssistant}
        onAddFiles={compose.onAddFiles}
        onRemoveAttachment={compose.onRemoveAttachment}
      />
    );
  } else if (settingsVisible) {
    content = <SettingsPage back={back} accounts={accounts} onChangeSignature={onChangeSignature} />;
  } else if (selectedNote) {
    content = (
      <NoteDetail
        key={selectedNote.id}
        back={back}
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
      <EmailDetail
        key={selectedMessageId}
        back={back}
        messageId={selectedMessageId}
        message={selectedMessage}
        account={selectedAccount}
        tempColors={tempColors}
        loading={messageLoading}
        error={messageError}
        now={now}
        allNotes={notes}
        onOpenNote={noteActions.onOpenNote}
        onCreateNote={noteActions.onCreate}
        onAiCreateNote={noteActions.onAiCreate}
        onReply={onReply}
        onTogglePin={onTogglePin}
      />
    );
  } else {
    content = (
      <>
        <PaneBar left={back} title="Assistant" />
        <div className="pane-body">
          <ChatPanel
            history={chatHistory}
            loading={chatLoading}
            pending={chatPending}
            error={chatError}
            onOpenMessage={onOpenMessage}
            onOpenNote={noteActions.onOpenNote}
            onUndoCreatedNote={onUndoCreatedNote}
          />
        </div>
      </>
    );
  }

  return (
    <div className="main-pane">
      {phoneHeader}
      {content}
    </div>
  );
}

export default MainPane;
