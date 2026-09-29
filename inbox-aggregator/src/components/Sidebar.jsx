import AskBar from './AskBar';
import SyncStatus from './SyncStatus';
import FolderSwitch from './FolderSwitch';
import PaneBar from './PaneBar';
import AccountsPanel from './AccountsPanel';
import PhoneAccountsBar from './PhoneAccountsBar';
import MessageList from './MessageList';
import SidebarTabs from './SidebarTabs';
import NotesPanel from './NotesPanel';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { PHONE_LAYOUT } from '../layout';

function Sidebar({
  onAsk,
  asking,
  lastSyncedAt,
  onSync,
  syncing,
  messages,
  // temp address -> its color, for the stripes of the emails it received
  tempColors,
  pinned = [],
  selectedId,
  onSelect,
  hasMore,
  loadingMore,
  onLoadMore,
  total,
  notice,
  onDismissNotice,
  accounts,
  onToggleAccount,
  onChangeAccountColor,
  onAccountConnected,
  userEmail,
  onSignOut,
  search,
  onSearch,
  onClearSearch,
  onLoadMoreSearch,
  chatCount,
  onOpenChat,
  tab,
  onTabChange,
  dueCount,
  notes,
  now,
  selectedNoteId,
  onSelectNote,
  onCreateNote,
  onAiCreateNote,
  onMoveNote,
  onSuggestOrganizing,
  onApplyOrganizing,
  creditsBanner,
  focusAskBox = false,
  focusNoteBox = false,
  onNewEmail,
  // temp addresses, shown under the accounts: { temp, now, onCreate, onExtend, onDelete }
  tempAddresses = null,
  folder,
  onFolderChange,
  // while an email is being written: { title, onBackToDraft, onDiscard, chat }.
  // The Inbox | Notes row becomes a Discard row, the list below becomes
  // the email's assistant, and the ask box at the top asks that assistant.
  drafting = null,
}) {
  // Desktop: sync status and accounts sit above the inbox list, sign-out below it.
  // Phone: all of that folds into one bar under the list, so the list screen opens uncluttered.
  const isPhone = useMediaQuery(PHONE_LAYOUT);

  const accountColors = new Map(accounts.map(a => [a.id, a.color]));

  const noticeBanner = notice && (
    <div className={`notice notice-${notice.type}`} role="status">
      <span>{notice.text}</span>
      <button className="notice-dismiss" onClick={onDismissNotice} aria-label="Dismiss">×</button>
    </div>
  );

  const searchList = search && (
    <>
      <div className="search-header">
        <span>
          {search.loading
            ? 'Searching...'
            : `${search.results.length}${search.hasMore ? '+' : ''} result${search.results.length === 1 ? '' : 's'} for "${search.query}"`}
        </span>
        <button className="btn btn-ghost btn-small" onClick={onClearSearch}>
          {drafting ? 'Back to assistant' : 'Back to inbox'}
        </button>
      </div>
      {search.error && <p className="search-empty">{search.error}</p>}
      {!search.loading && !search.error && search.results.length === 0 && (
        <p className="search-empty">No emails match.</p>
      )}
      <MessageList
        messages={search.results}
        accountColors={accountColors}
        tempColors={tempColors}
        selectedId={selectedId}
        onSelect={onSelect}
        hasMore={search.hasMore}
        loadingMore={search.loadingMore}
        onLoadMore={onLoadMoreSearch}
        total={null}
      />
    </>
  );

  // received or sent mail, whichever the switch above the list shows; pinned
  // emails sit in their own group above Received
  const folderList = (
    <>
      {folder === 'inbox' && pinned.length > 0 && (
        <>
          <div className="list-group-label">Pinned</div>
          <MessageList messages={pinned} accountColors={accountColors} tempColors={tempColors} selectedId={selectedId} onSelect={onSelect} hasMore={false} />
          <div className="list-group-label">Received</div>
        </>
      )}
      <MessageList
        messages={messages}
        accountColors={accountColors}
        tempColors={tempColors}
        selectedId={selectedId}
        onSelect={onSelect}
        hasMore={hasMore}
        loadingMore={loadingMore}
        onLoadMore={onLoadMore}
        total={total}
        showRecipients={folder === 'sent'}
      />
    </>
  );

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
        onAsk={onAsk}
        onSearch={onSearch}
        asking={asking}
        autoFocus={focusAskBox}
        aiPlaceholder={drafting ? 'Ask, or say what to write...' : undefined}
        topAction={!drafting
          ? { label: 'New email', onClick: onNewEmail }
          : isPhone ? undefined : { label: 'Discard', onClick: drafting.onDiscard, className: 'btn-ghost' }}
      />
      {/* phone layout only: on desktop the chat is always beside the list */}
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

      <div className="sidebar-scroll">
        {drafting ? (
          // searching still works while writing; otherwise this is the email's assistant
          searchList || drafting.chat
        ) : tab === 'notes' ? (
          <>
            {noticeBanner}
            <NotesPanel
              notes={notes}
              now={now}
              selectedNoteId={selectedNoteId}
              onSelect={onSelectNote}
              onCreate={onCreateNote}
              onAiCreate={onAiCreateNote}
              onMove={onMoveNote}
              onSuggestOrganizing={onSuggestOrganizing}
              onApplyOrganizing={onApplyOrganizing}
              autoFocusComposer={focusNoteBox}
            />
          </>
        ) : (
          <>
            {/* search results take the list's place, with their own header */}
            <div className="list-header">
              {!search && <FolderSwitch folder={folder} onChange={onFolderChange} />}
              <SyncStatus lastSyncedAt={lastSyncedAt} onSync={onSync} syncing={syncing} />
            </div>
            {!isPhone && (
              <>
                <AccountsPanel
                  accounts={accounts}
                  onToggleAccount={onToggleAccount}
                  onChangeColor={onChangeAccountColor}
                  onAccountConnected={onAccountConnected}
                  tempAddresses={tempAddresses}
                />
              </>
            )}
            {noticeBanner}
            {searchList || folderList}
          </>
        )}
      </div>

      {isPhone ? (
        <PhoneAccountsBar
          accounts={accounts}
          onToggleAccount={onToggleAccount}
          onChangeColor={onChangeAccountColor}
          onAccountConnected={onAccountConnected}
          userEmail={userEmail}
          onSignOut={onSignOut}
          tempAddresses={tempAddresses}
        />
      ) : (
        <div className="sidebar-footer">
          <span className="signed-in-as" title={userEmail}>{userEmail}</span>
          <button className="btn btn-ghost btn-small" onClick={onSignOut}>Sign out</button>
        </div>
      )}
    </div>
  );
}

export default Sidebar;
