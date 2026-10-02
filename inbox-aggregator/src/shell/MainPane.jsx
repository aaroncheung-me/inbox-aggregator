import ChatPanel from '../features/assistant/ChatPanel';
import ComposeView from '../features/compose/ComposeView';
import EmailDetail from '../features/email/EmailDetail';
import NoteDetail from '../features/notes/NoteDetail';
import SettingsPage from '../features/settings/SettingsPage';
import ScheduledView from '../features/compose/ScheduledView';
import NoteComposer from '../features/notes/NoteComposer';
import PaneBar from '../ui/PaneBar';
import { PaneClose, PaneInteraction } from '../ui/paneContext';
import OpenTabs from './OpenTabs';

// The open tabs (desktop), then the page of the one showing: the email being
// written, the phone's new note, Settings, a scheduled email, a note, an
// email, the assistant, or else "Nothing open". Each page starts with the same
// top bar (PaneBar); on a phone without the header its left end leads back to
// the list.
// tabs: { tabs, activeKey, onShow, onClose, onCloseActive, onKeep, onNewEmail }
//   (see OpenTabs; onKeep keeps a temporary tab once its page is used).
// noteActions: { onSaveBody, onDelete, onAddAddon, onUpdateAddon, onRemoveAddon, onOpenNote, onCreate, onAiCreate }
// aiHeadsUp: { noteId, message } from the last AI save, shown on that note.
// compose: the email being written, or null: { draft, visible, accounts, sending,
//   onChange, onSend, onSchedule, onDiscard, onUndoAiDraft, onShowAssistant, onShow, onAddFiles,
//   onRemoveAttachment }.
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
  chatVisible = false,
  onNewChat,
  tabs,
  // phone: the full-screen new note, { text, onTextChange, onBack, onDiscard }, or null
  newNote = null,
  onOpenMessage,
  onUndoCreatedNote,
  onBackToList,
  backLabel,
  onReply,
  onTogglePin,
  compose,
  settingsVisible = false,
  // a scheduled email to show: { item, account, onEdit, onSendNow, onCancel }, or null
  scheduled = null,
  // for Settings: the accounts, whose signatures it edits
  accounts = [],
  onChangeSignature,
  // phone only: the ask box and Inbox | Notes, kept above every page but the writing screen
  phoneHeader = null,
}) {
  // on a phone the header's tabs lead back to the lists instead
  const back = !phoneHeader && <button className="pane-back phone-only" onClick={onBackToList}>← {backLabel}</button>;

  // pages closed with × (the writing screen and the new note have Discard)
  let closable = true;
  let content;
  if (compose?.visible) {
    closable = false;
    content = (
      <ComposeView
        draft={compose.draft}
        accounts={compose.accounts}
        sending={compose.sending}
        onChange={compose.onChange}
        onSend={compose.onSend}
        onSchedule={compose.onSchedule}
        onDiscard={compose.onDiscard}
        onUndoAiDraft={compose.onUndoAiDraft}
        onShowAssistant={compose.onShowAssistant}
        onAddFiles={compose.onAddFiles}
        onRemoveAttachment={compose.onRemoveAttachment}
      />
    );
  } else if (newNote) {
    closable = false;
    content = (
      <NoteComposer
        page={{
          back: <button className="pane-back" onClick={newNote.onBack}>← Notes</button>,
          onDiscard: newNote.onDiscard,
        }}
        notes={notes}
        onSave={noteActions.onCreate}
        onAiSave={noteActions.onAiCreate}
        placeholder="Write a note..."
        autoFocus
        initialText={newNote.text}
        onTextChange={newNote.onTextChange}
      />
    );
  } else if (settingsVisible) {
    content = <SettingsPage back={back} accounts={accounts} onChangeSignature={onChangeSignature} />;
  } else if (scheduled) {
    content = <ScheduledView key={scheduled.item.id} back={back} {...scheduled} />;
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
        onOpenMessage={onOpenMessage}
        onCreateNote={noteActions.onCreate}
        onAiCreateNote={noteActions.onAiCreate}
        onReply={onReply}
        onTogglePin={onTogglePin}
      />
    );
  } else if (chatVisible) {
    content = (
      <>
        <PaneBar left={back} title="Assistant">
          {chatHistory.length > 0 && (
            <button className="btn btn-ghost btn-small" onClick={onNewChat} disabled={chatLoading}>New chat</button>
          )}
        </PaneBar>
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
  } else {
    closable = false;
    content = (
      <>
        <PaneBar left={back} />
        <div className="pane-body">
          <div className="nothing-open">
            <p className="nothing-open-title">Nothing open</p>
            <p>Pick an email or a note, or ask the AI from the bar.</p>
          </div>
        </div>
      </>
    );
  }

  return (
    <div className="main-pane">
      <OpenTabs tabs={tabs.tabs} activeKey={tabs.activeKey} onShow={tabs.onShow} onClose={tabs.onClose} onNewEmail={tabs.onNewEmail} />
      {/* the new note is a full screen of its own, like the writing screen */}
      {!newNote && phoneHeader}
      <PaneClose.Provider value={closable ? tabs.onCloseActive : null}>
        <PaneInteraction.Provider value={tabs.onKeep}>
          {/* anything done on the page keeps its tab (display: contents, so it doesn't change the layout) */}
          <div className="main-pane-page" onPointerDown={tabs.onKeep} onWheel={tabs.onKeep} onKeyDown={tabs.onKeep} onTouchStart={tabs.onKeep}>
            {content}
          </div>
        </PaneInteraction.Provider>
      </PaneClose.Provider>
    </div>
  );
}

export default MainPane;
