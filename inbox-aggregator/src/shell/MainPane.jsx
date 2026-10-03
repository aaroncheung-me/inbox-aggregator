import { useEffect, useState } from 'react';
import ChatPanel from '../features/assistant/ChatPanel';
import ComposeView from '../features/compose/ComposeView';
import EmailDetail from '../features/email/EmailDetail';
import NoteDetail from '../features/notes/NoteDetail';
import SettingsPage from '../features/settings/SettingsPage';
import ScheduledView from '../features/compose/ScheduledView';
import NoteComposer from '../features/notes/NoteComposer';
import PaneBar from '../ui/PaneBar';
import { PaneBeside, PaneClose, PaneSwap } from '../ui/paneContext';
import { droppedItem, droppedTab, isItemDrag, isTabDrag } from '../ui/dragItem';
import OpenTabs from './OpenTabs';

// The open tabs (desktop), then the page of the one showing: the email being
// written, the phone's new note, Settings, a scheduled email, a note, an
// email, the assistant, or else "Nothing open". Each page starts with the same
// top bar (PaneBar); on a phone without the header its left end leads back to
// the list.
// While an email is being written (desktop), an email or note can show beside
// it (`beside`), on the side `besideSide` ('left' | 'right'); a reading page
// offers "Show beside", and the side page ⇄ to swap sides.
// Dragging an email or note from a list over the page: dropping it opens it
// in a new tab, or while writing, beside the draft on the half it's dropped
// on (tabs dragged from the tab bar can go beside too).
// tabs: { tabs, activeKey, besideKey, onShow, onClose, onCloseActive, onNewTab,
//   onDropItem(item, index), onDropBeside({ item } | { tabKey }, side),
//   onShowBeside(key) or null, onCloseBeside, onSwapBeside } (see OpenTabs).
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
  besideSide = 'right',
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
  // something being dragged over the page: 'item' (from a list) or 'tab'
  const [dragKind, setDragKind] = useState(null);
  const [overZone, setOverZone] = useState(null);

  // The drop zones show from the moment a list row or tab starts being
  // dragged (they then cover the email frames, which would swallow the drag),
  // until the drag ends anywhere or is cancelled.
  useEffect(() => {
    const start = e => {
      if (isItemDrag(e)) setDragKind('item');
      else if (isTabDrag(e)) setDragKind('tab');
    };
    const reset = () => {
      setDragKind(null);
      setOverZone(null);
    };
    window.addEventListener('dragstart', start);
    window.addEventListener('dragend', reset);
    window.addEventListener('drop', reset);
    return () => {
      window.removeEventListener('dragstart', start);
      window.removeEventListener('dragend', reset);
      window.removeEventListener('drop', reset);
    };
  }, []);

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
  // where a drop can go: while writing, either half (beside the draft);
  // otherwise anywhere, for a new tab
  let zones = [];
  if (dragKind && writing) zones = ['left', 'right'];
  else if (dragKind === 'item') zones = ['tab'];
  const zoneLabels = {
    left: 'Beside the email you\'re writing, on the left',
    right: 'Beside the email you\'re writing, on the right',
    tab: 'Open in a new tab',
  };

  function drop(e, zone) {
    e.preventDefault();
    const item = isItemDrag(e) ? droppedItem(e) : null;
    const tabKey = item ? null : droppedTab(e);
    setDragKind(null);
    setOverZone(null);
    if (zone === 'tab') {
      if (item) tabs.onDropItem(item, tabs.tabs.length);
    } else if (item || tabKey) {
      tabs.onDropBeside(item ? { item } : { tabKey }, zone);
    }
  }

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
      />
      {/* the new note is a full screen of its own, like the writing screen */}
      {!newNote && phoneHeader}
      {/* always this shape, so the page doesn't start over when something goes beside it */}
      <div className={`split beside-${besideSide}`}>
        <div className="split-pane">{page}</div>
        {besidePage && (
          <div className="split-pane split-side">
            <PaneClose.Provider value={tabs.onCloseBeside}>
              <PaneSwap.Provider value={tabs.onSwapBeside}>{besidePage}</PaneSwap.Provider>
            </PaneClose.Provider>
          </div>
        )}
        {zones.length > 0 && (
          <div className="drop-zones">
            {zones.map(zone => (
              <div
                key={zone}
                className={`drop-zone${overZone === zone ? ' over' : ''}`}
                onDragOver={e => {
                  e.preventDefault();
                  setOverZone(zone);
                }}
                onDragLeave={() => setOverZone(null)}
                onDrop={e => drop(e, zone)}
              >
                {zoneLabels[zone]}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default MainPane;
