import { senderName } from '../../format';
import { splitAddresses } from './compose';
import { scheduleLabel } from './sendLater';

// The Scheduled group at the top of Sent: who each goes to, its subject, and
// when it goes (or that it failed). Rows look like the email list's.
// accountColors: account id -> color.
function ScheduledList({ scheduled, accountColors, selectedId, onSelect }) {
  return (
    <div>
      {scheduled.map(item => {
        const to = splitAddresses(item.to);
        return (
          <div
            key={item.id}
            className={`message-list-item${selectedId === item.id ? ' selected' : ''}`}
            style={{ '--account-color': accountColors.get(item.accountId) }}
            onClick={() => onSelect(item.id)}
          >
            <div className="message-list-item-top">
              <span className="sender">
                To: {to.length ? senderName(to[0]) : '(nobody)'}{to.length > 1 ? ` +${to.length - 1}` : ''}
              </span>
              {item.failed
                ? <span className="date scheduled-failed">Failed</span>
                : <span className="date">{scheduleLabel(item.sendAt)}</span>}
            </div>
            <div className="subject">{item.subject || '(no subject)'}</div>
            <div className="snippet">{item.body.replace(/\s+/g, ' ').slice(0, 120)}</div>
          </div>
        );
      })}
    </div>
  );
}

export default ScheduledList;
