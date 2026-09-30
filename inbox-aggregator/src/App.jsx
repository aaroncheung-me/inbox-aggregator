import { useState } from 'react';
import { dueReminderCount } from './features/notes/notes';
import { DRAFT_TITLES } from './features/compose/compose';
import { useNow } from './hooks/useNow';
import { useNavigation } from './shell/useNavigation';
import { useProviderStatus } from './shell/useProviderStatus';
import { useSync, oldestSyncTime } from './shell/useSync';
import { useMessageList } from './features/email/useMessageList';
import { useOpenEmail } from './features/email/useOpenEmail';
import { useSearch } from './features/email/useSearch';
import { useAccounts } from './features/accounts/useAccounts';
import { useTempAddresses } from './features/accounts/useTempAddresses';
import { useNotes } from './features/notes/useNotes';
import { useChat } from './features/assistant/useChat';
import { useCompose } from './features/compose/useCompose';
import Sidebar from './shell/Sidebar';
import MainPane from './shell/MainPane';
import CreditsBanner from './shell/CreditsBanner';
import DraftAssistant from './features/compose/DraftAssistant';
import AskBar from './features/assistant/AskBar';
import SidebarTabs from './shell/SidebarTabs';
import SendingBar from './features/compose/SendingBar';
import './styles/app.scss';

// After connecting an account, the server redirects back with ?connected=<email>
// or ?connect_error=<reason>. Read it once at startup and tidy the URL.
function readConnectResult() {
  const params = new URLSearchParams(window.location.search);
  const connected = params.get('connected');
  const error = params.get('connect_error');
  if (!connected && !error) return null;

  window.history.replaceState(null, '', window.location.pathname);
  return connected
    ? { type: 'success', text: `Connected ${connected}` }
    : { type: 'error', text: `Couldn't connect account: ${error}` };
}

const connectResult = readConnectResult();

// The installed app's icon shortcuts (see manifest.webmanifest) open
// /?action=new-note or /?action=ask. Read once at startup and tidy the URL.
function readLaunchAction() {
  const action = new URLSearchParams(window.location.search).get('action');
  if (action !== 'new-note' && action !== 'ask') return null;
  window.history.replaceState(null, '', window.location.pathname);
  return action;
}

const launchAction = readLaunchAction();

// The app: each feature keeps its own state in a hook (features/*/use*.js,
// shell/use*.js), and this wires them together and to the two panes.
function App({ userEmail, onSignOut }) {
  const [notice, setNotice] = useState(connectResult);
  // re-checked every minute, so a reminder turns due while the app is open
  const now = useNow();

  const status = useProviderStatus();
  // the "New note" shortcut opens straight onto Notes
  const nav = useNavigation(launchAction === 'new-note' ? 'notes' : 'inbox');
  const list = useMessageList();
  const accounts = useAccounts({ onNotice: setNotice, reloadMessages: list.reload });
  const temp = useTempAddresses({ onNotice: setNotice, reloadMessages: list.reload });
  const notes = useNotes({ onNotice: setNotice, refreshStatus: status.refresh });
  const sync = useSync({
    // a just-connected account is synced immediately on load
    syncNow: connectResult?.type === 'success',
    list,
    setAccounts: accounts.setAccounts,
    setTemp: temp.setTemp,
    setNotes: notes.setNotes,
    refreshStatus: status.refresh,
  });
  const openEmail = useOpenEmail(nav.selectedMessageId, { reloadMessages: list.reload, onNotice: setNotice });
  const search = useSearch();
  const chat = useChat({
    refreshNotes: notes.refresh,
    refreshStatus: status.refresh,
    onNoteDeleted: noteId => { if (nav.selectedNoteId === noteId) nav.closeNote(); },
  });
  const compose = useCompose({
    accounts: accounts.accounts,
    openMessage: openEmail.message,
    onNotice: setNotice,
    showDraft: nav.showDraft,
    hideDraft: nav.hideDraft,
    showListScreen: nav.showListScreen,
    reloadMessages: list.reload,
    refreshNotes: notes.refresh,
    refreshStatus: status.refresh,
  });
  const { draft } = compose;

  // Form-based connects (IMAP) finish without leaving the page, so sync right away.
  // Sign-in connects (Gmail) come back through a redirect instead, see readConnectResult.
  function handleAccountConnected(emailAddress) {
    setNotice({ type: 'success', text: `Connected ${emailAddress}` });
    accounts.refresh(); // show it in the panel before its first sync finishes
    sync.sync();
  }

  // Saving from the Notes box or from "+ Note" on an email (where addons already
  // include the link to that email). Either way the new note opens, so it's
  // clear it was made and any mistakes are visible straight away. (Going back to
  // the email later reloads it, so its new sticky note shows there too.)
  async function handleCreateNote(body, addons) {
    nav.openNote(await notes.create(body, addons));
  }

  async function handleAiSaveNote(body, addons) {
    nav.openNote(await notes.aiSave(body, addons));
  }

  async function handleDeleteNote(noteId) {
    await notes.remove(noteId, () => {
      nav.closeNote();
      nav.showListScreen();
    });
  }

  const noteActions = {
    onSaveBody: notes.saveBody,
    onDelete: handleDeleteNote,
    onAddAddon: notes.addAddon,
    onUpdateAddon: notes.updateAddon,
    onRemoveAddon: notes.removeAddon,
    onOpenNote: nav.openNote,
    onCreate: handleCreateNote,
    onAiCreate: handleAiSaveNote,
  };

  // the answer shows in the chat; the email on screen is "this email" for the assistant
  function handleAsk(question) {
    const openMessageId = nav.selectedMessageId;
    nav.openChat();
    chat.ask(question, openMessageId);
  }

  // search results are emails, so they show on the Inbox tab
  function handleSearch(query) {
    nav.setTab('inbox');
    search.run(query);
  }

  const selectedNote = notes.notes.find(note => note.id === nav.selectedNoteId) || null;
  const selectedAccount = accounts.accounts.find(a => a.id === openEmail.message?.account_id);
  const dueCount = dueReminderCount(notes.notes, now);

  return (
    <div className={`app phone-shows-${nav.phoneScreen}`}>
      <Sidebar
        creditsBanner={(
          <CreditsBanner
            problems={status.problems}
            hiddenSince={status.hidden}
            onHide={status.hide}
          />
        )}
        // while writing an email, the ask box asks that email's assistant
        onAsk={draft ? compose.ask : handleAsk}
        focusAskBox={launchAction === 'ask'}
        focusNoteBox={launchAction === 'new-note'}
        chatCount={chat.history.length}
        onOpenChat={nav.openChat}
        asking={draft ? compose.chatLoading : chat.loading}
        lastSyncedAt={oldestSyncTime(accounts.accounts)}
        onSync={sync.sync}
        syncing={sync.syncing}
        messages={list.messages}
        tempColors={temp.colors}
        pinned={list.pinned}
        selectedId={nav.selectedMessageId}
        onSelect={nav.openMessage}
        hasMore={list.messages.length < list.total}
        loadingMore={list.loadingMore}
        onLoadMore={list.loadMore}
        total={list.total}
        notice={notice}
        onDismissNotice={() => setNotice(null)}
        accounts={accounts.accounts}
        onToggleAccount={accounts.toggle}
        onChangeAccountColor={accounts.changeColor}
        onAccountConnected={handleAccountConnected}
        userEmail={userEmail}
        onSignOut={onSignOut}
        onOpenSettings={nav.openSettings}
        settingsOpen={nav.settingsVisible}
        search={search.search}
        onSearch={handleSearch}
        onClearSearch={search.clear}
        onLoadMoreSearch={search.loadMore}
        tab={nav.tab}
        onTabChange={nav.setTab}
        folder={list.folder}
        onFolderChange={list.changeFolder}
        dueCount={dueCount}
        notes={notes.notes}
        now={now}
        selectedNoteId={nav.selectedNoteId}
        onSelectNote={nav.openNote}
        onCreateNote={handleCreateNote}
        onAiCreateNote={handleAiSaveNote}
        onMoveNote={notes.move}
        onSuggestOrganizing={notes.suggest}
        onApplyOrganizing={notes.applyOrganizing}
        onNewEmail={compose.newEmail}
        tempAddresses={{
          temp: temp.temp,
          now,
          onCreate: temp.create,
          onExtend: temp.extend,
          onToggle: temp.toggle,
          onChangeColor: temp.changeColor,
          onDelete: temp.remove,
        }}
        drafting={draft && {
          title: DRAFT_TITLES[draft.mode],
          onBackToDraft: nav.showDraft,
          onDiscard: compose.discard,
          chat: (
            <DraftAssistant
              history={compose.chat}
              loading={compose.chatLoading}
              pending={compose.chatPending}
              error={compose.chatError}
              onUseDraft={compose.applyAiDraft}
              onOpenMessage={nav.openMessage}
              onOpenNote={nav.openNote}
              onUndoCreatedNote={compose.undoChatNote}
            />
          ),
        }}
      />
      <MainPane
        selectedMessageId={nav.selectedMessageId}
        selectedMessage={openEmail.message}
        selectedAccount={selectedAccount}
        tempColors={temp.colors}
        messageLoading={openEmail.loading}
        messageError={openEmail.error}
        chatHistory={chat.history}
        chatLoading={chat.loading}
        chatPending={chat.pending}
        chatError={chat.error}
        selectedNote={selectedNote}
        notes={notes.notes}
        now={now}
        noteActions={noteActions}
        aiHeadsUp={notes.aiHeadsUp}
        onDismissAiHeadsUp={notes.dismissAiHeadsUp}
        onOpenMessage={nav.openMessage}
        onUndoCreatedNote={chat.undoCreatedNote}
        onCloseMessage={nav.closeMessage}
        onBackToList={nav.showListScreen}
        // while writing, the list screen is the email's assistant
        backLabel={draft ? 'Assistant' : nav.tab === 'notes' ? 'Notes' : 'Inbox'}
        onReply={compose.reply}
        // Phone: emails, notes and answers keep the list screen's top (the ask
        // box and Inbox | Notes), so moving between screens doesn't change the
        // layout; the tabs lead back to the lists. Not while writing, which
        // has its own bar.
        phoneHeader={!draft && (
          <div className="phone-header phone-only">
            <AskBar
              onAsk={handleAsk}
              onSearch={query => { handleSearch(query); nav.showListScreen(); }}
              asking={chat.loading}
              topAction={{ label: 'New email', onClick: compose.newEmail }}
            />
            <SidebarTabs
              tab={nav.tab}
              onChange={next => { nav.setTab(next); nav.showListScreen(); }}
              dueCount={dueCount}
            />
          </div>
        )}
        onTogglePin={openEmail.togglePin}
        settingsVisible={nav.settingsVisible}
        compose={draft && {
          draft,
          visible: nav.draftVisible,
          accounts: accounts.accounts,
          sending: compose.sending,
          onChange: compose.update,
          onSend: compose.send,
          onDiscard: compose.discard,
          onUndoAiDraft: compose.undoAiDraft,
          onShowAssistant: nav.showListScreen,
          onShow: nav.showDraft,
        }}
      />
      {compose.outgoing && (
        <SendingBar
          outgoing={compose.outgoing}
          onUndo={compose.undoSend}
          onOpenDraft={compose.reopenFailedSend}
          onDismiss={compose.dismissOutgoing}
        />
      )}
    </div>
  );
}

export default App;
