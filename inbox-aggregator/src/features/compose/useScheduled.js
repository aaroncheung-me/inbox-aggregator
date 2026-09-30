import { useEffect, useState } from 'react';
import { getScheduled, sendScheduledNow, cancelSend } from '../../api';

// Emails scheduled with Send later and not sent yet (plus any that failed),
// shown at the top of Sent. See GET /scheduled for the shape.
// reloadMessages: brings an email sent now into Sent once it has gone.
export function useScheduled({ reloadMessages }) {
  const [scheduled, setScheduled] = useState([]);

  useEffect(() => {
    getScheduled().then(setScheduled).catch(() => {});
  }, []);

  function refresh() {
    return getScheduled().then(setScheduled).catch(err => console.error(err));
  }

  async function sendNow(id) {
    await sendScheduledNow(id);
    await refresh();
    // the server syncs the account after sending, bringing in the sent copy
    setTimeout(() => reloadMessages().catch(() => {}), 5000);
  }

  // its uploaded files go too
  async function cancel(id) {
    await cancelSend(id);
    await refresh();
  }

  return { scheduled, refresh, sendNow, cancel };
}
