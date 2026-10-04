// The demo's made-up mailbox: three accounts (work, school, personal), their
// email, notes, a scheduled email and a temp address, for Alex Rivera, a
// student finishing a degree while interning and looking for a job. Every
// name, address and company here is invented (addresses end in .example).
// Times are relative to when the page opened, so the demo always looks current.

export const DEMO_USER = { id: 'demo-user', email: 'alex.rivera@gmail.example', aud: 'authenticated', role: 'authenticated' };

export const TEMP_DOMAIN = 'alexrivera.example';

const MINUTE = 60 * 1000;

// A local time `days` from today at hour:minute.
export function dayAt(now, days, hour, minute = 0) {
  const d = new Date(now);
  d.setDate(d.getDate() + days);
  d.setHours(hour, minute, 0, 0);
  return d;
}

export const weekday = d => d.toLocaleDateString('en-US', { weekday: 'long' });
export const shortDate = d => d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
export const clock = d => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

const WORK = 1;
const SCHOOL = 2;
const PERSONAL = 3;

// Email ids are referenced by notes and the assistant's answers.
export const IDS = {
  standup: 101, roadmap: 102, roadmapReply: 103, roadmapPriya: 104, roadmapMoved: 105, panel: 106, expenses: 107, wiki: 108,
  hwGraded: 201, officeHours: 202, labReport: 203, registration: 204, capstone: 205, hwQuestion: 206,
  order: 301, flight: 302, brightwave: 303, lumenReceived: 304, harbor: 305, glasses: 306, rent: 307, newsletter: 308,
  brightwaveReply: 309, lumenChallenge: 310, weekend: 311,
};

export const NOTE_IDS = { jobs: 1, glasses: 2, labReport: 3, trip: 4, seattle: 5 };

export function createDemoData(openedAt = Date.now()) {
  // whole minutes, so no email shows a time like 11:00:18
  const now = Math.floor(openedAt / MINUTE) * MINUTE;
  const ago = minutes => new Date(now - minutes * MINUTE).toISOString();
  const HOUR = 60;
  const DAY = 24 * HOUR;

  const panelAt = dayAt(now, 2, 14);
  const reviewAt = dayAt(now, 1, 10);
  const interviewAt = dayAt(now, 3, 11);
  const challengeDue = dayAt(now, 5, 23, 59);
  const labDue = dayAt(now, 4, 17);
  const flightAt = dayAt(now, 1, 7, 45);
  const officeHoursAt = dayAt(now, 1, 15);
  const rentDue = dayAt(now, 3, 9);
  const deliveryAt = dayAt(now, 0, 20);

  const accounts = [
    { id: WORK, user_id: DEMO_USER.id, provider: 'imap', email_address: 'alex@northwind.example', display_name: null, color: '#93CDE6', show_in_inbox: true, signature: 'Alex Rivera\nSoftware Engineering Intern, Northwind', last_synced_at: ago(22), sync_state: null },
    { id: SCHOOL, user_id: DEMO_USER.id, provider: 'imap', email_address: 'arivera@stateu.example', display_name: null, color: '#9FD8B0', show_in_inbox: true, signature: 'Alex Rivera\nB.S. Computer Science, State University', last_synced_at: ago(25), sync_state: null },
    { id: PERSONAL, user_id: DEMO_USER.id, provider: 'gmail', email_address: DEMO_USER.email, display_name: null, color: '#CDA8EC', show_in_inbox: true, signature: '', last_synced_at: ago(21), sync_state: null },
  ];

  const ME = {
    [WORK]: 'Alex Rivera <alex@northwind.example>',
    [SCHOOL]: 'Alex Rivera <arivera@stateu.example>',
    [PERSONAL]: `Alex Rivera <${DEMO_USER.email}>`,
  };

  // { id, account, from, to, cc?, subject, body, minutes, sent?, read?, thread?, attachments?, html?, replyTo? }
  const emails = [
    // ---------- work ----------
    {
      id: IDS.standup, account: WORK, minutes: 35, thread: 'w-standup',
      from: 'Priya Shah <priya@northwind.example>', to: 'search-team@northwind.example',
      subject: 'Standup notes',
      body: `Morning all, quick notes from standup:\n\n- Search indexing: Alex has the new ranking behind a flag, testing on staging today\n- Jordan: roadmap review moved to ${weekday(reviewAt)} 10 AM (see Jordan's email)\n- Mei: on-call handoff Friday, ping her with anything open\n- Blocked: nothing\n\nPriya`,
    },
    {
      id: IDS.roadmap, account: WORK, minutes: 2 * DAY + 5 * HOUR, thread: 'w-roadmap', read: true,
      from: 'Jordan Lee <jordan@northwind.example>', to: 'search-team@northwind.example',
      subject: 'Q3 roadmap review',
      body: `Hi team,\n\nAttached is the draft Q3 roadmap. The big items are faster search, saved filters and the mobile layout.\n\nPlease read it before the review and bring questions. Anything you think is missing, reply here.\n\nThanks,\nJordan`,
      attachments: [{ id: 9001, filename: 'q3-roadmap.pdf', mime: 'application/pdf', size: 184000, pdf: ['Q3 roadmap (draft)', '', '1. Faster search: new ranking, cached results', '2. Saved filters', '3. Mobile layout pass', '', 'Made-up demo document.'] }],
    },
    {
      id: IDS.roadmapReply, account: WORK, minutes: 2 * DAY + 3 * HOUR, thread: 'w-roadmap', sent: true, read: true,
      from: ME[WORK], to: 'Jordan Lee <jordan@northwind.example>', cc: 'search-team@northwind.example',
      subject: 'Re: Q3 roadmap review',
      body: `Looks good overall. One question: could faster search come before saved filters? Saved filters lean on the new ranking, so doing search first saves us redoing work.\n\nAlex`,
    },
    {
      id: IDS.roadmapPriya, account: WORK, minutes: DAY + 2 * HOUR, thread: 'w-roadmap', read: true,
      from: 'Priya Shah <priya@northwind.example>', to: 'Alex Rivera <alex@northwind.example>', cc: 'search-team@northwind.example, jordan@northwind.example',
      subject: 'Re: Q3 roadmap review',
      body: `Agreed with Alex, search first makes the filters work much easier. Happy to pair on the ranking piece.\n\nPriya\n\nOn ${shortDate(new Date(now - (2 * DAY + 3 * HOUR) * MINUTE))}, Alex Rivera <alex@northwind.example> wrote:\n> Looks good overall. One question: could faster search come before saved\n> filters? Saved filters lean on the new ranking, so doing search first saves\n> us redoing work.\n>\n> Alex`,
    },
    {
      id: IDS.roadmapMoved, account: WORK, minutes: 3 * HOUR, thread: 'w-roadmap',
      from: 'Jordan Lee <jordan@northwind.example>', to: 'search-team@northwind.example',
      subject: 'Re: Q3 roadmap review',
      body: `Good call, search moves up. I've updated the doc.\n\nThe review is now ${shortDate(reviewAt)} at ${clock(reviewAt)} in the Cedar room (or the usual video link).\n\nJordan`,
    },
    {
      id: IDS.panel, account: WORK, minutes: 5 * HOUR,
      from: 'Northwind Recruiting <recruiting@northwind.example>', to: 'alex@northwind.example',
      subject: `You're on the interview panel ${weekday(panelAt)} 2 PM`,
      body: `Hi Alex,\n\nThanks for joining the panel for the frontend intern candidate. You're covering the 30-minute code review session.\n\nWhen: ${shortDate(panelAt)}, ${clock(panelAt)} to 2:30 PM\nWhere: Video call (link in the calendar invite)\n\nThe candidate's take-home is in the shared folder. Scorecards are due the same day.\n\nNorthwind Recruiting`,
    },
    {
      id: IDS.expenses, account: WORK, minutes: 3 * DAY + 4 * HOUR, read: true,
      from: 'Northwind Finance <finance@northwind.example>', to: 'alex@northwind.example',
      subject: 'Expense report approved',
      body: `Your expense report "Team offsite travel" for $86.40 has been approved and will be paid with your next paycheck.\n\nNorthwind Finance`,
    },
    {
      id: IDS.wiki, account: WORK, minutes: 12 * DAY, read: true,
      from: 'Mei Tanaka <mei@northwind.example>', to: 'alex@northwind.example',
      subject: 'Welcome to the team wiki',
      body: `Hi Alex,\n\nYou now have edit access to the team wiki. Good places to start: "How search works", "On-call basics" and "Deploying to staging".\n\nShout if anything is unclear.\n\nMei`,
    },

    // ---------- school ----------
    {
      id: IDS.hwGraded, account: SCHOOL, minutes: 70,
      from: 'Course Notices <notices@stateu.example>', to: 'arivera@stateu.example',
      subject: 'HW 4 graded',
      body: `CS 4349 Algorithms\n\nHomework 4 (Dynamic Programming) has been graded.\n\nYour score: 92 / 100\nClass average: 81\n\nComment: "Nice proof on problem 3. Problem 5's recurrence misses the empty case."\n\nRegrade requests are open for one week.`,
    },
    {
      id: IDS.officeHours, account: SCHOOL, minutes: 6 * HOUR,
      from: 'Dr. Elena Park <epark@stateu.example>', to: 'cs4349-students@stateu.example',
      subject: 'Office hours moved',
      body: `Hi all,\n\nThis week only, my office hours move to ${shortDate(officeHoursAt)}, ${clock(officeHoursAt)} to 4:30 PM, same room (ECS 3.405).\n\nBring questions about HW 5 and the midterm.\n\nDr. Park`,
    },
    {
      id: IDS.labReport, account: SCHOOL, minutes: DAY + 1 * HOUR, read: true,
      from: 'Marcus Webb <mwebb@stateu.example>', to: 'cs3377-lab@stateu.example',
      subject: `Lab report due ${weekday(labDue)}`,
      body: `Reminder: Lab 6 (process scheduling) is due ${shortDate(labDue)} at 5 PM.\n\nInclude:\n- your scheduler's code\n- a chart of average wait time for FCFS, SJF and Round Robin\n- one paragraph on which you'd pick and why\n\nLate reports lose 10% per day.\n\nMarcus (TA)`,
    },
    {
      id: IDS.registration, account: SCHOOL, minutes: 4 * DAY, read: true,
      from: 'Office of the Registrar <registrar@stateu.example>', to: 'arivera@stateu.example',
      subject: 'Registration opens Monday',
      body: `Registration for the spring term opens Monday at 8 AM for seniors.\n\nCheck your degree audit first: you have 9 credit hours left, including the capstone.\n\nOffice of the Registrar`,
    },
    {
      id: IDS.capstone, account: SCHOOL, minutes: 2 * DAY + 7 * HOUR, read: true,
      from: 'Sam Ortiz <sortiz@stateu.example>', to: 'arivera@stateu.example',
      subject: 'Capstone demo slides',
      body: `Hey Alex,\n\nHere's the first pass at our demo slides. I left slide 6 (architecture) for you since you built most of the backend.\n\nCan we do a run-through before the demo?\n\nSam`,
      attachments: [{ id: 9002, filename: 'capstone-demo.pdf', mime: 'application/pdf', size: 420000, pdf: ['Capstone demo', '', 'Slide 6: architecture (Alex)', '', 'Made-up demo document.'] }],
    },
    {
      id: IDS.hwQuestion, account: SCHOOL, minutes: 2 * DAY + 2 * HOUR, sent: true, read: true,
      from: ME[SCHOOL], to: 'Dr. Elena Park <epark@stateu.example>',
      subject: 'Question about HW 5',
      body: `Hi Dr. Park,\n\nFor HW 5 problem 2, can we assume the edge weights are non-negative?\n\nThanks,\nAlex Rivera`,
    },

    // ---------- personal ----------
    {
      id: IDS.order, account: PERSONAL, minutes: 25, labels: ['INBOX', 'CATEGORY_UPDATES'],
      from: 'Shopwise <orders@shopwise.example>', to: DEMO_USER.email,
      subject: 'Your order shipped',
      body: `Good news, your order #SW-48213 is on its way.\n\nNoise-cancelling headphones (black) x1 $129.99\nUSB-C cable, 2 m x1 $12.99\n\nEstimated delivery: today, ${shortDate(deliveryAt)}\nCarrier: Parcelway, tracking PW 7741 2290 18`,
      html: orderHtml(deliveryAt),
    },
    {
      id: IDS.flight, account: PERSONAL, minutes: 3 * HOUR, labels: ['INBOX', 'CATEGORY_UPDATES'],
      from: 'Skyline Air <checkin@skylineair.example>', to: DEMO_USER.email,
      subject: 'Check-in is open for your flight to Seattle',
      body: `Check-in is open.\n\nFlight SK 482, Dallas (DAL) to Seattle (SEA)\n${shortDate(flightAt)}, departs ${clock(flightAt)}\nConfirmation: QX7P2L\nSeat 14C, 1 carry-on included`,
      html: flightHtml(flightAt),
    },
    {
      id: IDS.brightwave, account: PERSONAL, minutes: 7 * HOUR, thread: 'p-brightwave',
      from: 'Dana Kim <dana@brightwave.example>', to: DEMO_USER.email,
      subject: 'Interview invitation: Software Engineer, Brightwave',
      body: `Hi Alex,\n\nThanks for applying to the Software Engineer role at Brightwave. The team enjoyed your portfolio and would like to invite you to a technical interview.\n\nCould you do ${shortDate(interviewAt)} at ${clock(interviewAt)}? It's 60 minutes on video: 15 minutes about your projects, 45 minutes of pair programming in the language of your choice.\n\nBest,\nDana Kim\nTechnical Recruiter, Brightwave`,
    },
    {
      id: IDS.brightwaveReply, account: PERSONAL, minutes: 6 * HOUR, thread: 'p-brightwave', sent: true, read: true,
      from: ME[PERSONAL], to: 'Dana Kim <dana@brightwave.example>',
      subject: 'Re: Interview invitation: Software Engineer, Brightwave',
      body: `Hi Dana,\n\nThank you, ${weekday(interviewAt)} at ${clock(interviewAt)} works well for me. I'll plan on TypeScript for the pairing session.\n\nLooking forward to it,\nAlex`,
    },
    {
      id: IDS.lumenReceived, account: PERSONAL, minutes: 4 * DAY + 3 * HOUR, thread: 'p-lumen', read: true,
      from: 'Lumen Labs Careers <careers@lumenlabs.example>', to: DEMO_USER.email,
      subject: 'Application received: Frontend Engineer at Lumen Labs',
      body: `Hi Alex,\n\nThanks for applying for Frontend Engineer at Lumen Labs. We've received your application and will be in touch within two weeks.\n\nLumen Labs Careers`,
    },
    {
      id: IDS.lumenChallenge, account: PERSONAL, minutes: 2 * DAY + 1 * HOUR, thread: 'p-lumen',
      from: 'Lumen Labs Careers <careers@lumenlabs.example>', to: DEMO_USER.email,
      subject: 'Re: Application received: Frontend Engineer at Lumen Labs',
      body: `Hi Alex,\n\nGood news: we'd like you to move on to our coding challenge. It's a small React app (about 3 hours). Please submit it by ${shortDate(challengeDue)}.\n\nThe instructions are at the link in your candidate portal.\n\nLumen Labs Careers`,
    },
    {
      id: IDS.harbor, account: PERSONAL, minutes: 6 * DAY, read: true,
      from: 'Harbor Analytics <jobs@harboranalytics.example>', to: DEMO_USER.email,
      subject: 'Update on your application',
      body: `Hi Alex,\n\nThank you for your interest in the Junior Data Engineer role. After careful review, we've decided to move forward with other candidates.\n\nWe'll keep your resume on file for future openings.\n\nHarbor Analytics`,
    },
    {
      id: IDS.glasses, account: PERSONAL, minutes: 9 * DAY, read: true,
      from: 'Clearview Optometry <frontdesk@clearview.example>', to: DEMO_USER.email,
      subject: 'Your eyeglass prescription',
      body: `Hi Alex,\n\nThanks for visiting Clearview Optometry. Your updated eyeglass prescription is attached and below.\n\nRight eye (OD): -2.25 sphere, -0.50 cylinder, axis 180\nLeft eye (OS): -2.00 sphere, -0.75 cylinder, axis 175\nPupillary distance: 63 mm\n\nIt's valid for two years. Call us at the front desk to order frames.\n\nClearview Optometry`,
      attachments: [{ id: 9003, filename: 'prescription.pdf', mime: 'application/pdf', size: 96000, pdf: ['Clearview Optometry: eyeglass prescription', '', 'OD: -2.25 sph, -0.50 cyl, axis 180', 'OS: -2.00 sph, -0.75 cyl, axis 175', 'PD: 63 mm', '', 'Made-up demo document.'] }],
    },
    {
      id: IDS.rent, account: PERSONAL, minutes: DAY + 4 * HOUR,
      from: 'Maple Court Apartments <office@maplecourt.example>', to: DEMO_USER.email,
      subject: 'Rent reminder',
      body: `Hi Alex,\n\nA friendly reminder that rent of $1,150 for unit 214 is due ${shortDate(rentDue)}. You can pay in the resident portal.\n\nMaple Court Apartments`,
    },
    {
      id: IDS.newsletter, account: PERSONAL, minutes: 2 * DAY + 9 * HOUR, read: true, labels: ['INBOX', 'CATEGORY_PROMOTIONS'],
      from: 'This Week in Web Dev <hello@webdevweekly.example>', to: 'news-k7x2m9qa@alexrivera.example',
      subject: 'This week: CSS anchor positioning, faster builds',
      body: `This week in web dev: CSS anchor positioning lands everywhere, a look at faster builds, and five small accessibility fixes you can ship today.`,
      html: newsletterHtml(),
      replyTo: 'editors@webdevweekly.example',
    },
    {
      id: IDS.weekend, account: PERSONAL, minutes: 3 * DAY + 6 * HOUR, sent: true, read: true,
      from: ME[PERSONAL], to: 'Mom <rivera.family@home.example>',
      subject: 'Weekend plans',
      body: `Hi Mom,\n\nI'll be in Seattle for a few days for the trip with Sam. I'll call you Sunday when I'm back.\n\nLove,\nAlex`,
    },
  ];

  // New mail that "arrives" with the next syncs, so syncing visibly does something.
  const incoming = [
    {
      id: 401, account: PERSONAL, labels: ['INBOX', 'CATEGORY_UPDATES'],
      from: 'Parcelway <tracking@parcelway.example>', to: DEMO_USER.email,
      subject: 'Your Shopwise package is out for delivery',
      body: `Your package PW 7741 2290 18 from Shopwise is out for delivery and should arrive by 8 PM today.`,
    },
    {
      id: 402, account: SCHOOL,
      from: 'Course Notices <notices@stateu.example>', to: 'arivera@stateu.example',
      subject: 'Quiz 3 opens tomorrow',
      body: `CS 4349 Algorithms\n\nQuiz 3 (graphs) opens tomorrow at 9 AM and is open for 48 hours. 30 minutes, one attempt.`,
    },
  ];

  let nextAttachmentId = 9100;
  const toMessage = (e, receivedAt) => {
    const sent = Boolean(e.sent);
    return {
      id: e.id,
      account_id: e.account,
      thread_id: e.thread || null,
      sender: e.from,
      to_recipients: e.to,
      cc_recipients: e.cc || null,
      subject: e.subject,
      body: e.body,
      snippet: e.body.replace(/\s+/g, ' ').slice(0, 200),
      received_at: receivedAt,
      labels: e.labels || (sent ? ['SENT'] : ['INBOX']),
      is_read: sent || Boolean(e.read),
      has_attachments: Boolean(e.attachments?.length),
      pinned_at: null,
      html: e.html || null,
      reply_to: e.replyTo || null,
      attachments: (e.attachments || []).map(a => ({
        id: a.id ?? nextAttachmentId++, external_id: '2', filename: a.filename, mime_type: a.mime, size_bytes: a.size, pdf: a.pdf || null,
      })),
    };
  };

  const messages = emails.map(e => toMessage(e, ago(e.minutes)));
  messages.find(m => m.id === IDS.brightwave).pinned_at = ago(6 * HOUR);

  // ---------- notes ----------
  const notes = [
    { id: NOTE_IDS.jobs, position: 1, minutes: 5 * DAY, body: `Job search\nBrightwave: interview ${weekday(interviewAt)} ${clock(interviewAt)} (video, pair programming in TypeScript)\nLumen Labs: coding challenge due ${weekday(challengeDue)}\nHarbor Analytics: turned down\nFollow up with Lumen if no reply a week after submitting` },
    { id: NOTE_IDS.glasses, position: 2, minutes: 9 * DAY, body: 'Order new glasses\nUse the new prescription, ask about blue-light lenses' },
    { id: NOTE_IDS.labReport, position: 3, minutes: DAY, body: 'Lab 6 report\n- run FCFS, SJF, Round Robin (quantum 4)\n- chart average wait time\n- argue for Round Robin on interactive loads' },
    { id: NOTE_IDS.trip, position: 4, minutes: 3 * DAY, body: 'Seattle trip packing\nRain jacket, charger, headphones (if they arrive in time), boarding pass' },
    { id: NOTE_IDS.seattle, position: 5, minutes: 3 * DAY, body: 'Things to do in Seattle\nPike Place early, the ferry to Bainbridge, the waterfront, coffee near Capitol Hill' },
  ].map(({ minutes, ...n }) => ({ ...n, created_at: ago(minutes), updated_at: ago(minutes) }));

  let addonId = 1;
  const addon = (noteId, kind, extra = {}) => ({
    id: addonId++, note_id: noteId, kind, added_by: 'user', remind_at: null, done_at: null,
    linked_message_id: null, linked_note_id: null, created_at: ago(DAY), ...extra,
  });
  const addons = [
    addon(NOTE_IDS.jobs, 'pin'),
    addon(NOTE_IDS.jobs, 'email_link', { linked_message_id: IDS.brightwave }),
    addon(NOTE_IDS.jobs, 'email_link', { linked_message_id: IDS.lumenChallenge }),
    addon(NOTE_IDS.jobs, 'email_link', { linked_message_id: IDS.harbor, added_by: 'ai' }),
    addon(NOTE_IDS.glasses, 'reminder', { remind_at: dayAt(now, 1, 9).toISOString() }),
    addon(NOTE_IDS.glasses, 'email_link', { linked_message_id: IDS.glasses }),
    addon(NOTE_IDS.labReport, 'reminder', { remind_at: dayAt(now, 3, 18).toISOString(), added_by: 'ai' }),
    addon(NOTE_IDS.labReport, 'email_link', { linked_message_id: IDS.labReport }),
    addon(NOTE_IDS.trip, 'pin', { added_by: 'ai' }),
    addon(NOTE_IDS.trip, 'email_link', { linked_message_id: IDS.flight }),
    addon(NOTE_IDS.trip, 'note_link', { linked_note_id: NOTE_IDS.seattle }),
  ];

  // ---------- a scheduled email and a temp address ----------
  const outbox = [{
    id: 1, account_id: WORK, status: 'waiting', error: null, send_at: dayAt(now, 1, 8).toISOString(),
    email: {
      to: [{ name: 'Priya Shah', address: 'priya@northwind.example' }, { name: 'Jordan Lee', address: 'jordan@northwind.example' }],
      cc: [], bcc: [], subject: 'Weekly update: search ranking',
      body: 'Hi Priya and Jordan,\n\nThis week: the new ranking is behind a flag on staging, and early numbers show the right result in the top 3 for 9 out of 10 test searches.\n\nNext week: turn it on for internal users and collect feedback.\n\nAlex\n\n-- \nAlex Rivera\nSoftware Engineering Intern, Northwind',
      replyToMessageId: null, attachments: [], forwarded: [], scheduled: true,
    },
  }];

  const tempAddresses = [{
    id: 1, account_id: PERSONAL, address: `news-k7x2m9qa@${TEMP_DOMAIN}`, label: 'Newsletter sign-up',
    color: '#E9D17A', show_in_inbox: true, created_at: ago(9 * DAY), expires_at: dayAt(now, 21, 12).toISOString(),
  }];

  return {
    accounts, messages, notes, addons, outbox, tempAddresses,
    // dates the assistant's answers quote, matching what the emails say
    facts: { panelAt, reviewAt, interviewAt, challengeDue, labDue, flightAt, officeHoursAt, rentDue, deliveryAt },
    incoming: incoming.map(e => receivedAt => toMessage(e, receivedAt)),
  };
}

// ---------- formatted emails ----------
// Inline styles only, like real email HTML; the app shows them in its sandboxed frame.

function orderHtml(deliveryDate) {
  return `<html><body style="margin:0;background:#f4f4f2;font-family:Helvetica,Arial,sans-serif;color:#222">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:8px;overflow:hidden">
<tr><td style="background:#1f6f5c;color:#ffffff;padding:20px 28px;font-size:22px;font-weight:bold">Shopwise</td></tr>
<tr><td style="padding:28px">
<h1 style="margin:0 0 8px;font-size:22px">Your order is on its way</h1>
<p style="margin:0 0 20px;color:#555">Order #SW-48213 shipped with Parcelway.</p>
<table width="100%" cellpadding="8" cellspacing="0" style="border-top:1px solid #eee;border-bottom:1px solid #eee;font-size:15px">
<tr><td>Noise-cancelling headphones (black)</td><td align="right">$129.99</td></tr>
<tr><td>USB-C cable, 2 m</td><td align="right">$12.99</td></tr>
<tr><td style="font-weight:bold">Total</td><td align="right" style="font-weight:bold">$142.98</td></tr>
</table>
<p style="margin:20px 0 4px;color:#555">Estimated delivery</p>
<p style="margin:0 0 24px;font-size:18px;font-weight:bold">Today, ${shortDate(deliveryDate)}</p>
<a href="https://shopwise.example/track" style="display:inline-block;background:#1f6f5c;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:6px;font-weight:bold">Track package</a>
</td></tr>
<tr><td style="padding:16px 28px;background:#fafafa;color:#888;font-size:12px">A made-up store for the Inbox Aggregator demo.</td></tr>
</table></td></tr></table></body></html>`;
}

function flightHtml(flightAt) {
  return `<html><body style="margin:0;background:#eef2f7;font-family:Helvetica,Arial,sans-serif;color:#1b2533">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:10px;overflow:hidden">
<tr><td style="background:#173a6b;color:#ffffff;padding:20px 28px;font-size:20px;font-weight:bold;letter-spacing:1px">SKYLINE AIR</td></tr>
<tr><td style="padding:28px">
<h1 style="margin:0 0 6px;font-size:22px">Check-in is open</h1>
<p style="margin:0 0 22px;color:#566">Confirmation QX7P2L</p>
<table width="100%" cellpadding="0" cellspacing="0"><tr>
<td style="font-size:34px;font-weight:bold">DAL</td><td align="center" style="color:#8a99ad;font-size:14px">SK 482<br>&#8594;</td><td align="right" style="font-size:34px;font-weight:bold">SEA</td>
</tr><tr><td style="color:#566">Dallas</td><td></td><td align="right" style="color:#566">Seattle</td></tr></table>
<p style="margin:22px 0 4px;color:#566">Departs</p>
<p style="margin:0 0 4px;font-size:18px;font-weight:bold">${shortDate(flightAt)}, ${clock(flightAt)}</p>
<p style="margin:0 0 24px;color:#566">Seat 14C &middot; 1 carry-on included</p>
<a href="https://skylineair.example/checkin" style="display:inline-block;background:#e0682b;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:6px;font-weight:bold">Check in now</a>
</td></tr>
<tr><td style="padding:16px 28px;background:#f6f8fb;color:#8a99ad;font-size:12px">A made-up airline for the Inbox Aggregator demo.</td></tr>
</table></td></tr></table></body></html>`;
}

function newsletterHtml() {
  const item = (title, text) => `<tr><td style="padding:0 0 18px"><p style="margin:0 0 4px;font-size:17px;font-weight:bold;color:#3b2a8a">${title}</p><p style="margin:0;color:#444;line-height:1.5">${text}</p></td></tr>`;
  return `<html><body style="margin:0;background:#f7f5ff;font-family:Georgia,serif;color:#222">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border:1px solid #e4defa">
<tr><td style="padding:24px 30px;border-bottom:3px solid #3b2a8a"><span style="font-size:24px;font-weight:bold">This Week in Web Dev</span><br><span style="color:#777;font-size:13px">Issue 212</span></td></tr>
<tr><td style="padding:24px 30px"><table width="100%" cellpadding="0" cellspacing="0">
${item('CSS anchor positioning lands everywhere', 'Tooltips and popovers that stay attached to their trigger, with no JavaScript measuring.')}
${item('Faster builds, fewer plugins', 'A walk through cutting a build from 40 seconds to 6 by removing what the bundler already does.')}
${item('Five accessibility fixes to ship today', 'Visible focus, real buttons, labels on icon buttons, enough contrast, and touch targets that fit a thumb.')}
</table></td></tr>
<tr><td style="padding:16px 30px;background:#faf9ff;color:#999;font-size:12px">A made-up newsletter for the Inbox Aggregator demo. <a href="https://webdevweekly.example/unsubscribe" style="color:#999">Unsubscribe</a></td></tr>
</table></td></tr></table></body></html>`;
}
