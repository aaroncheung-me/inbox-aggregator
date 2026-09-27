function formatDate(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  const today = new Date();
  const isToday = date.toDateString() === today.toDateString();
  return isToday
    ? date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function senderName(sender) {
  if (!sender) return 'Unknown';
  const match = sender.match(/^"?([^"<]+)"?\s*</);
  return match ? match[1].trim() : sender;
}

function MessageList({ messages, accountColors, selectedId, onSelect, hasMore, loadingMore, onLoadMore, total }) {
  return (
    <div>
      {messages.map(m => (
        <div
          key={m.id}
          className={`message-list-item${selectedId === m.id ? ' selected' : ''}`}
          style={{ '--account-color': accountColors.get(m.account_id) }}
          onClick={() => onSelect(m.id)}
        >
          <div className="message-list-item-top">
            <span className="sender">{senderName(m.sender)}</span>
            <span className="date">{formatDate(m.received_at)}</span>
          </div>
          <div className="subject">{m.subject || '(no subject)'}</div>
          <div className="snippet">{m.snippet}</div>
        </div>
      ))}

      {hasMore && (
        <button className="btn btn-ghost load-more" onClick={onLoadMore} disabled={loadingMore}>
          {loadingMore ? 'Loading...' : total == null ? 'Load more' : `Load more (${messages.length} of ${total})`}
        </button>
      )}
    </div>
  );
}

export default MessageList;