import { senderName, shortDate } from '../../format';
import { splitAddresses } from '../compose/compose';
import { preloadEmailHtml } from './useEmailHtml';
import PaperclipIcon from '../../ui/PaperclipIcon';
import { dragItemProps, middleClickProps } from '../../ui/dragItem';

// How long the mouse rests on an email before its formatted version starts
// loading, so sweeping across the list doesn't load every email passed over.
const HOVER_PRELOAD_MS = 120;
let hoverTimer = null;

// Mouse: preload after a short rest. Touch or pen: preload on touching down,
// a moment before the tap opens it.
function preloadHandlers(messageId) {
  return {
    onPointerEnter: e => {
      if (e.pointerType !== 'mouse') return;
      clearTimeout(hoverTimer);
      hoverTimer = setTimeout(() => preloadEmailHtml(messageId), HOVER_PRELOAD_MS);
    },
    onPointerLeave: () => clearTimeout(hoverTimer),
    onPointerDown: () => preloadEmailHtml(messageId),
  };
}

// '"Ann" <a@x.com>, b@y.com' -> 'To: Ann +1'
function recipientsLabel(recipients) {
  const list = splitAddresses(recipients);
  if (!list.length) return 'To: (nobody)';
  return `To: ${senderName(list[0])}${list.length > 1 ? ` +${list.length - 1}` : ''}`;
}

// showRecipients: for sent mail, the people it went to instead of the sender.
// Colors come from the app's current accounts and temp addresses (accountColors,
// tempColors: address -> color), so recoloring one shows at once.
function MessageList({ messages, accountColors, tempColors, selectedId, onSelect, hasMore, loadingMore, onLoadMore, total, showRecipients = false }) {
  return (
    <div>
      {messages.map(m => (
        <div
          key={m.id}
          // mail to a temp address takes that address's color, with a dashed stripe
          className={`message-list-item${selectedId === m.id ? ' selected' : ''}${m.temp_address ? ' temp-mail' : ''}`}
          style={{
            '--account-color': m.temp_address
              ? tempColors?.get(m.temp_address.address) || m.temp_address.color
              : accountColors.get(m.account_id),
          }}
          // Ctrl/Cmd-click or a middle click: in a new tab, behind the one showing
          onClick={e => onSelect(m.id, e.ctrlKey || e.metaKey ? { newTab: true, focus: false } : undefined)}
          {...middleClickProps(() => onSelect(m.id, { newTab: true, focus: false }))}
          // dragged onto the tab bar: in a new tab
          {...dragItemProps({ kind: 'email', id: m.id, label: m.subject || '(no subject)', color: accountColors.get(m.account_id) })}
          {...preloadHandlers(m.id)}
        >
          <div className="message-list-item-top">
            <span className="sender">{showRecipients ? recipientsLabel(m.to_recipients) : senderName(m.sender)}</span>
            <span className="date">
              {m.has_files && <PaperclipIcon />}
              {shortDate(m.received_at)}
            </span>
          </div>
          <div className="subject">
            {m.temp_address && <span className="temp-chip" title={`Sent to ${m.temp_address.address}`}>Temp</span>}
            {m.subject || '(no subject)'}
          </div>
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