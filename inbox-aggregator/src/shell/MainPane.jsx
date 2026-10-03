import { useState } from 'react';
import ChatPanel from '../features/assistant/ChatPanel';
import ComposeView from '../features/compose/ComposeView';
import EmailDetail from '../features/email/EmailDetail';
import NoteDetail from '../features/notes/NoteDetail';
import SettingsPage from '../features/settings/SettingsPage';
import ScheduledView from '../features/compose/ScheduledView';
import NoteComposer from '../features/notes/NoteComposer';
import PaneBar from '../ui/PaneBar';
import { PaneBeside, PaneClose } from '../ui/paneContext';
import { droppedTab, isTabDrag } from '../ui/dragItem';
import OpenTabs from './OpenTabs';

// The open tabs (desktop), then the page of the one showing: the email being
// written, the phone's new note, Settings, a scheduled email, a note, an
// email, the assistant, or else "Nothing open". Each page starts with the same
// top bar (PaneBar); on a phone without the header its left end leads back to
// the list.
// While an email is being written (desktop), an email or note can show beside
// it (`beside`); a reading page offers "Show beside", and a tab dragged onto
// the writing screen's right half goes there too.
// tabs: { tabs, activeKey, besideKey, onShow, onClose, onCloseActive, onNewTab,
//   onDropItem, onShowBeside(key) or null, onCloseBeside } (see OpenTabs).
// beside: { kind: 'email', messageId, message, account, loading, error,
//   onTogglePin } or { kind: 'note', note }, or null.
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
  beside = null,
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
  const [draggingTab, setDraggingTab] = useState(null);
  const [overBeside, setOverBeside] = useState(false);

  // on a phone the header's tabs lead back to the lists instead
  const back = !phoneHeader && <button className="pane-back phone-only" onClick={onBackToList}>← {backLabel}</button>;

  const emailPage = (props, key) => (
    <EmailDetail
      key={key}
      back={back}
      tempColors={tempColors}
      now={now}
      allNotes={notes}
      onOpenNote={noteActions.onOpenNote}
      onOpenMessage={onOpenMessage}
      onCreateNote={noteActions.onCreate}
      onAiCreateNote={noteActions.onAiCreate}
      {...props}
    />
  );

  const notePage = note => (
    <NoteDetail
      key={note.id}
      back={back}
      note={note}
      notes={notes}
      now={now}
      onSaveBody={noteActions.onSaveBody}
      onDelete={noteActions.onDelete}
      onAddAddon={noteActions.onAddAddon}
      onUpdateAddon={noteActions.onUpdateAddon}
      onRemoveAddon={noteActions.onRemoveAddon}
      onOpenMessage={onOpenMessage}
      onOpenNote={noteActions.onOpenNote}
      headsUp={aiHeadsUp?.noteId === note.id ? aiHeadsUp.message : null}
      onDismissHeadsUp={onDismissAiHeadsUp}
    />
  );

  // pages closed with × on a phone (the writing screen and the new note have
  // Discard); reading pages can go beside the email being written
  let closable = true;
  let reading = false;
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
    reading = true;
    content = notePage(selectedNote);
  } else if (selectedMessageId != null) {
    reading = true;
    content = emailPage({
      messageId: selectedMessageId,
      message: selectedMessage,
      account: selectedAccount,
      loading: messageLoading,
      error: messageError,
      onReply,
      onTogglePin,
    }, selectedMessageId);
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

  const page = (
    <PaneClose.Provider value={closable ? tabs.onCloseActive : null}>
      <PaneBeside.Provider value={reading && tabs.onShowBeside ? () => tabs.onShowBeside(tabs.activeKey) : null}>
        {content}
      </PaneBeside.Provider>
    </PaneClose.Provider>
  );

  // the writing screen, with what's beside it
  const writing = compose?.visible;
  let besidePage = null;
  if (writing && beside?.kind === 'email') {
    besidePage = emailPage({ ...beside, onReply: null }, `beside-${beside.messageId}`);
  } else if (writing && beside?.kind === 'note') {
    besidePage = notePage(beside.note);
  }
  const dropBeside = writing && draggingTab && draggingTab !== tabs.besideKey;

  return (
    <div className="main-pane">
      <OpenTabs
        tabs={tabs.tabs}
        activeKey={tabs.activeKey}
        besideKey={writing ? tabs.besideKey : null}
        onShow={tabs.onShow}
        onClose={tabs.onClose}
        onNewTab={tabs.onNewTab}
        onDropItem={tabs.onDropItem}
        onTabDrag={key => { setDraggingTab(key); setOverBeside(false); }}
      />
      {/* the new note is a full screen of its own, like the writing screen */}
      {!newNote && phoneHeader}
      {/* always this shape, so the page doesn't start over when something goes beside it */}
      <div className="split">
        <div className="split-pane">{page}</div>
        {besidePage && (
          <div className="split-pane split-side">
            <PaneClose.Provider value={tabs.onCloseBeside}>{besidePage}</PaneClose.Provider>
          </div>
        )}
        {dropBeside && (
          <div
            className={`beside-drop${overBeside ? ' over' : ''}`}
            onDragOver={e => {
              if (!isTabDrag(e)) return;
              e.preventDefault();
              setOverBeside(true);
            }}
            onDragLeave={() => setOverBeside(false)}
            onDrop={e => {
              e.preventDefault();
              const key = droppedTab(e);
              setDraggingTab(null);
              if (key) tabs.onPutBeside(key);
            }}
          >
            Drop to show it beside the email you're writing
          </div>
        )}
      </div>
    </div>
  );
}

export default MainPane;
