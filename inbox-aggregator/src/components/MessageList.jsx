import { senderName, shortDate } from '../format';
import { splitAddresses } from '../compose';

// '"Ann" <a@x.com>, b@y.com' -> 'To: Ann +1'
function recipientsLabel(recipients) {
  const list = splitAddresses(recipients);
  if (!list.length) return 'To: (nobody)';
  return `To: ${senderName(list[0])}${list.length > 1 ? ` +${list.length - 1}` : ''}`;
}

// showRecipients: for sent mail, the people it went to instead of the sender
function MessageList({ messages, accountColors, selectedId, onSelect, hasMore, loadingMore, onLoadMore, total, showRecipients = false }) {
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
            <span className="sender">{showRecipients ? recipientsLabel(m.to_recipients) : senderName(m.sender)}</span>
            <span className="date">{shortDate(m.received_at)}</span>
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