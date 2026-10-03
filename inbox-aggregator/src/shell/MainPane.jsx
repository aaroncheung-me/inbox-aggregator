import ChatPanel from '../features/assistant/ChatPanel';
import ComposeView from '../features/compose/ComposeView';
import EmailDetail from '../features/email/EmailDetail';
import NoteDetail from '../features/notes/NoteDetail';
import SettingsPage from '../features/settings/SettingsPage';
import ScheduledView from '../features/compose/ScheduledView';
import NoteComposer from '../features/notes/NoteComposer';
import PaneBar from '../ui/PaneBar';
import { PaneBeside, PaneClose, PaneSwap } from '../ui/paneContext';
import OpenTabs from './OpenTabs';
import DropZones from './DropZones';

// The open tabs (desktop), then the page of the one showing: the email being
// written, the phone's new note, Settings, a scheduled email, a note, an
// email, the assistant, or else "Nothing open". Each page starts with the same
// top bar (PaneBar); on a phone without the header its left end leads back to
// the list (onBackToList, labelled backLabel).
// While an email is being written (desktop), an email or note can show beside
// it (`beside`), on the side `besideSide` ('left' | 'right'); a reading page
// offers "Show beside", and the side page ⇄ to swap sides. Emails and notes
// dragged over the page can be dropped there (DropZones).
// tabs: { tabs, activeKey, besideKey, onShow, onClose, onCloseActive, onNewTab,
//   onDropItem(item, index), onDropBeside({ item } | { tabKey }, side),
//   onShowBeside(key) or null, onCloseBeside, onSwapBeside } (see OpenTabs).
// email: the open email, { messageId, message, account, loading, error,
//   onTogglePin, onReply(kind) }, or null. beside: an email of that shape (no
//   onReply), or { kind: 'note', note }, or null.
// note: the open note, or null. notes: { notes, now, actions: { onSaveBody,
//   onDelete, onAddAddon, onUpdateAddon, onRemoveAddon, onOpenNote, onCreate,
//   onAiCreate }, aiHeadsUp ({ noteId, message } from the last AI save),
//   onDismissAiHeadsUp }.
// chat: the assistant, { visible, history, loading, pending, error, onNewChat,
//   onUndoCreatedNote }. settings: { visible, accounts, onChangeSignature }.
// scheduled: a scheduled email to show, { item, account, onEdit, onSendNow, onCancel }, or null.
// compose: the email being written ({ draft, visible, ... }, see ComposeView), or null.
// newNote (phone): the full-screen new note, { text, onTextChange, onBack, onDiscard }, or null.
// phoneHeader (phone): the ask box and Inbox | Notes, kept above every page but the writing screen.
function MainPane({
  tabs, besideSide = 'right', email, beside = null, note, notes, chat, settings, scheduled = null,
  compose, newNote = null, phoneHeader = null, tempColors, onOpenMessage, onBackToList, backLabel,
}) {
  // on a phone the header's tabs lead back to the lists instead
  const back = !phoneHeader && <button className="pane-back phone-only" onClick={onBackToList}>← {backLabel}</button>;

  const emailPage = (props, key) => (
    <EmailDetail
      key={key}
      back={back}
      tempColors={tempColors}
      now={notes.now}
      allNotes={notes.notes}
      onOpenNote={notes.actions.onOpenNote}
      onOpenMessage={onOpenMessage}
      onCreateNote={notes.actions.onCreate}
      onAiCreateNote={notes.actions.onAiCreate}
      {...props}
    />
  );

  const notePage = shown => (
    <NoteDetail
      key={shown.id}
      back={back}
      note={shown}
      notes={notes.notes}
      now={notes.now}
      {...notes.actions}
      onOpenMessage={onOpenMessage}
      headsUp={notes.aiHeadsUp?.noteId === shown.id ? notes.aiHeadsUp.message : null}
      onDismissHeadsUp={notes.onDismissAiHeadsUp}
    />
  );

  // pages closed with × on a phone (the writing screen and the new note have
  // Discard); reading pages can go beside the email being written
  let closable = true;
  let reading = false;
  let content;
  if (compose?.visible) {
    closable = false;
    content = <ComposeView {...compose} />;
  } else if (newNote) {
    closable = false;
    content = (
      <NoteComposer
        page={{
          back: <button className="pane-back" onClick={newNote.onBack}>← Notes</button>,
          onDiscard: newNote.onDiscard,
        }}
        notes={notes.notes}
        onSave={notes.actions.onCreate}
        onAiSave={notes.actions.onAiCreate}
        placeholder="Write a note..."
        autoFocus
        initialText={newNote.text}
        onTextChange={newNote.onTextChange}
      />
    );
  } else if (settings.visible) {
    content = <SettingsPage back={back} accounts={settings.accounts} onChangeSignature={settings.onChangeSignature} />;
  } else if (scheduled) {
    content = <ScheduledView key={scheduled.item.id} back={back} {...scheduled} />;
  } else if (note) {
    reading = true;
    content = notePage(note);
  } else if (email) {
    reading = true;
    content = emailPage(email, email.messageId);
  } else if (chat.visible) {
    content = (
      <>
        <PaneBar left={back} title="Assistant">
          {chat.history.length > 0 && (
            <button className="btn btn-ghost btn-small" onClick={chat.onNewChat} disabled={chat.loading}>New chat</button>
          )}
        </PaneBar>
        <div className="pane-body">
          <ChatPanel
            history={chat.history}
            loading={chat.loading}
            pending={chat.pending}
            error={chat.error}
            onOpenMessage={onOpenMessage}
            onOpenNote={notes.actions.onOpenNote}
            onUndoCreatedNote={chat.onUndoCreatedNote}
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
  if (writing && beside?.kind === 'email') besidePage = emailPage({ ...beside, onReply: null }, `beside-${beside.messageId}`);
  else if (writing && beside?.kind === 'note') besidePage = notePage(beside.note);

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
        <DropZones
          writing={writing}
          onDropItem={item => tabs.onDropItem(item, tabs.tabs.length)}
          onDropBeside={tabs.onDropBeside}
        />
      </div>
    </div>
  );
}

export default MainPane;
