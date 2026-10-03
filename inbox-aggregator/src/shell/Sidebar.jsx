import AskBar from '../features/assistant/AskBar';
import SyncStatus from '../features/email/SyncStatus';
import FolderSwitch from '../features/email/FolderSwitch';
import PaneBar from '../ui/PaneBar';
import ResultsBar from '../ui/ResultsBar';
import { resultsText } from '../format';
import AccountsPanel from '../features/accounts/AccountsPanel';
import PhoneAccountsBar from '../features/accounts/PhoneAccountsBar';
import MessageList from '../features/email/MessageList';
import ScheduledList from '../features/compose/ScheduledList';
import SidebarTabs from './SidebarTabs';
import NotesPanel from '../features/notes/NotesPanel';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { PHONE_LAYOUT } from '../layout';

// The sidebar: the ask bar, Inbox | Notes, and the list below them, with the
// accounts and sign-out (desktop: above and below the list; phone: one bar
// under it). Grouped by what they're for:
// askBar: AskBar's props (mode, resetKey, placeholders, onAsk, onSearch...).
// inbox: the email list, { folder, onFolderChange, messages, pinned, total,
//   hasMore, loadingMore, onLoadMore, selectedId, onSelect, tempColors (temp
//   address -> color, for its emails' stripes), scheduled, selectedScheduledId,
//   onOpenScheduled, lastSyncedAt, onSync, syncing }.
// search: the email search showing in the list's place ({ query, results,
//   hasMore, loading, loadingMore, error, onClear, onLoadMore }), or null.
// notesPanel: NotesPanel's props. accountsPanel: { accounts, onToggleAccount,
//   onChangeColor, onAccountConnected, tempAddresses }. user: { email,
//   onSignOut, onOpenSettings, settingsOpen }.
// drafting: while an email is being written, { title, onBackToDraft,
//   onDiscard, chat }: the Inbox | Notes row becomes "Writing: ...", the list
//   becomes the email's assistant, and the ask box asks that assistant.
// waitingDraft (phone): an email being written while something else shows, { title, onShow }.
function Sidebar({
  askBar, onNewEmail, onCollapse, creditsBanner, notice, onDismissNotice,
  tab, onTabChange, dueCount, chatCount, onOpenChat,
  inbox, search, notesPanel, accountsPanel, user, drafting = null, waitingDraft = null,
}) {
  const isPhone = useMediaQuery(PHONE_LAYOUT);
  const accountColors = new Map(accountsPanel.accounts.map(a => [a.id, a.color]));
  const rowProps = { accountColors, tempColors: inbox.tempColors, selectedId: inbox.selectedId, onSelect: inbox.onSelect };

  const noticeBanner = notice && (
    <div className={`notice notice-${notice.type}`} role="status">
      <span>{notice.text}</span>
      <button className="notice-dismiss" onClick={onDismissNotice} aria-label="Dismiss">×</button>
    </div>
  );

  const searchList = search && (
    <>
      <ResultsBar
        backLabel={drafting ? 'Assistant' : 'Inbox'}
        onBack={search.onClear}
        text={search.loading ? 'Searching...' : resultsText(search.results.length, search.query, search.hasMore)}
      />
      {search.error && <p className="search-empty">{search.error}</p>}
      {!search.loading && !search.error && search.results.length === 0 && (
        <p className="search-empty">No emails match.</p>
      )}
      <MessageList
        {...rowProps}
        messages={search.results}
        hasMore={search.hasMore}
        loadingMore={search.loadingMore}
        onLoadMore={search.onLoadMore}
        total={null}
      />
    </>
  );

  // received or sent mail, whichever the switch above the list shows; pinned
  // emails sit in their own group above Received, scheduled ones above Sent
  const folderList = (
    <>
      {inbox.folder === 'sent' && inbox.scheduled.length > 0 && (
        <>
          <div className="list-group-label">Scheduled</div>
          <ScheduledList scheduled={inbox.scheduled} accountColors={accountColors} selectedId={inbox.selectedScheduledId} onSelect={inbox.onOpenScheduled} />
          <div className="list-group-label">Sent</div>
        </>
      )}
      {inbox.folder === 'inbox' && inbox.pinned.length > 0 && (
        <>
          <div className="list-group-label">Pinned</div>
          <MessageList {...rowProps} messages={inbox.pinned} hasMore={false} />
          <div className="list-group-label">Received</div>
        </>
      )}
      <MessageList
        {...rowProps}
        messages={inbox.messages}
        hasMore={inbox.hasMore}
        loadingMore={inbox.loadingMore}
        onLoadMore={inbox.onLoadMore}
        total={inbox.total}
        showRecipients={inbox.folder === 'sent'}
      />
    </>
  );

  let list;
  if (drafting) {
    // searching still works while writing; otherwise this is the email's assistant
    list = searchList || drafting.chat;
  } else if (tab === 'notes') {
    list = (
      <>
        {noticeBanner}
        <NotesPanel
          {...notesPanel}
          autoFocusComposer={notesPanel.autoFocusComposer && !isPhone}
          onStartNote={isPhone ? notesPanel.onStartNote : undefined}
        />
      </>
    );
  } else if (search) {
    // search results take the whole list's place, right under the bar
    list = (
      <>
        {noticeBanner}
        {searchList}
      </>
    );
  } else {
    list = (
      <>
        <div className="list-header">
          <FolderSwitch folder={inbox.folder} onChange={inbox.onFolderChange} />
          <SyncStatus lastSyncedAt={inbox.lastSyncedAt} onSync={inbox.onSync} syncing={inbox.syncing} />
        </div>
        {!isPhone && <AccountsPanel {...accountsPanel} />}
        {noticeBanner}
        {folderList}
      </>
    );
  }

  return (
    <div className="sidebar">
      {creditsBanner}
      {/* Phone, while writing: this screen is the email's assistant. Its bar
          mirrors the writing screen's: the switch between them top left,
          Discard top right. */}
      {drafting && isPhone && (
        <PaneBar
          left={<button className="btn btn-ghost btn-small" onClick={drafting.onBackToDraft}>Back to email</button>}
          title="Assistant"
        >
          <button className="btn btn-ghost btn-small" onClick={drafting.onDiscard}>Discard</button>
        </PaneBar>
      )}
      <AskBar
        {...askBar}
        onCollapse={isPhone ? undefined : onCollapse}
        // New email; while writing it becomes Discard in the same spot (on a
        // phone, Discard is in this screen's bar above)
        topAction={!drafting
          ? { label: 'New email', onClick: onNewEmail }
          : isPhone ? undefined : { label: 'Discard', onClick: drafting.onDiscard, className: 'btn-ghost' }}
      />
      {/* phone layout only: on desktop the chat is always beside the list */}
      {waitingDraft && (
        <button className="phone-open-chat phone-only" onClick={waitingDraft.onShow}>
          Back to writing: {waitingDraft.title} →
        </button>
      )}
      {!drafting && chatCount > 0 && (
        <button className="phone-open-chat phone-only" onClick={onOpenChat}>
          View AI conversation ({chatCount}) →
        </button>
      )}
      {/* desktop, while writing: the main pane's bar has "Back to email" when needed */}
      {drafting ? (
        !isPhone && (
          <div className="draft-bar">
            <span className="draft-bar-title">Writing: {drafting.title}</span>
          </div>
        )
      ) : (
        <SidebarTabs tab={tab} onChange={onTabChange} dueCount={dueCount} />
      )}

      <div className="sidebar-scroll">{list}</div>

      {isPhone ? (
        <PhoneAccountsBar {...accountsPanel} user={user} />
      ) : (
        <div className="sidebar-footer">
          <span className="signed-in-as" title={user.email}>{user.email}</span>
          <span className="sidebar-footer-actions">
            <button
              className={`btn btn-ghost btn-small settings-button${user.settingsOpen ? ' active' : ''}`}
              onClick={user.onOpenSettings}
              aria-pressed={user.settingsOpen}
            >
              Settings
            </button>
            <button className="btn btn-ghost btn-small" onClick={user.onSignOut}>Sign out</button>
          </span>
        </div>
      )}
    </div>
  );
}

export default Sidebar;
