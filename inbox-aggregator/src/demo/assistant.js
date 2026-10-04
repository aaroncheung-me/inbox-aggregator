// The demo assistant: canned answers about the made-up mail, no AI. It knows
// the questions the app suggests ("Find my glasses prescription", "How are my
// job applications going?" then "save that as a note", "note this email,
// remind me Friday"), the main topics in the demo's mail, and drafting from
// the writing screen; anything else gets a plain keyword search. Answers use
// the real app's citation markers, [#12] for an email and [note 3] for a note.

import { IDS, NOTE_IDS, weekday, shortDate, clock } from './data';

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

// "remind me Friday at 3pm" -> { date, matches: the words that said when }, or null.
export function parseReminder(text, base = new Date()) {
  const dayMatch = /\b(?:on\s+)?(today|tonight|tomorrow|next week|in (\d+) days?|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i.exec(text);
  const timeMatch = /\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b|\bat\s+(\d{1,2})(?::(\d{2}))?\b|\b(?:in the\s+)?(noon|morning|afternoon|evening)\b/i.exec(text);
  if (!dayMatch && !timeMatch) return null;

  const date = new Date(base);
  const day = dayMatch?.[1].toLowerCase();
  let offset = 0;
  if (day === 'tomorrow') offset = 1;
  else if (day === 'next week') offset = (8 - base.getDay()) % 7 || 7;
  else if (dayMatch?.[2]) offset = Number(dayMatch[2]);
  else if (WEEKDAYS.includes(day)) offset = (WEEKDAYS.indexOf(day) - base.getDay() + 7) % 7 || 7;
  date.setDate(date.getDate() + offset);

  let hour = day === 'tonight' ? 19 : 9;
  let minute = 0;
  if (timeMatch) {
    const [, h12, m12, ampm, hAt, mAt, part] = timeMatch;
    if (h12) {
      hour = (Number(h12) % 12) + (ampm.toLowerCase() === 'pm' ? 12 : 0);
      minute = Number(m12 || 0);
    } else if (hAt) {
      hour = Number(hAt) < 8 ? Number(hAt) + 12 : Number(hAt);
      minute = Number(mAt || 0);
    } else {
      hour = { noon: 12, morning: 9, afternoon: 14, evening: 18 }[part.toLowerCase()];
    }
  }
  date.setHours(hour, minute, 0, 0);
  if (date.getTime() <= base.getTime()) date.setDate(date.getDate() + 1);
  return { date, matches: [dayMatch?.[0], timeMatch?.[0]].filter(Boolean) };
}

// "today at 3:00 PM", "tomorrow at 9:00 AM", "Friday at 9:00 AM", "Monday, Oct 19 at 9:00 AM"
export function describeReminder(date) {
  const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(date) - startOfDay(new Date())) / DAY_MS);
  const day = days === 0 ? 'today' : days === 1 ? 'tomorrow' : days < 7 ? weekday(date) : shortDate(date);
  return `${day} at ${clock(date)}`;
}

const emailOf = sender => (/<([^>]+)>/.exec(sender || '')?.[1] || sender || '').trim().toLowerCase();
const nameOf = sender =>(/^"?([^"<]+?)"?\s*</.exec(sender || '')?.[1] || sender || '').trim();
// "Dana Kim" -> "Dana", "Dr. Elena Park" -> "Dr. Park"
function firstName(sender) {
  const words = nameOf(sender).split(' ');
  return /^(dr|prof|mr|ms|mrs)\.?$/i.test(words[0]) && words.length > 1 ? `${words[0]} ${words[words.length - 1]}` : words[0];
}

// The first sentence or two after the greeting, for summaries and notes.
function gist(body, sentences = 2) {
  const lines = body.split('\n').map(l => l.trim()).filter(l => l && !/^(hi|hey|hello|dear)\b/i.test(l) && !l.startsWith('>'));
  return (lines.join(' ').match(/[^.!?]+[.!?]+/g) || [lines.join(' ')]).slice(0, sentences).map(s => s.trim()).join(' ');
}

const STOP_WORDS = new Set(['what', 'when', 'where', 'which', 'with', 'from', 'about', 'have', 'there', 'that', 'this', 'your', 'mine',
  'find', 'show', 'tell', 'does', 'into', 'were', 'will', 'would', 'could', 'should', 'email', 'emails', 'please', 'anything', 'they', 'them',
  'who', 'the', 'and', 'are', 'how', 'did', 'for', 'you', 'was', 'any', 'can', 'get', 'has', 'had', 'not', 'but', 'all', 'out', 'why', 'say', 'said']);
// Senders that are a team or a system, not a person to greet by name.
const GENERIC_SENDERS = /^(recruiting|notices|registrar|finance|office|orders|checkin|careers|jobs|hello|frontdesk|tracking|editors|no-?reply|info|support)@/;

// Builds the reply: { answer, sources, steps, createdNotes, draft }.
export function answerQuestion(ctx) {
  const { question, history, openMessageId, draft } = ctx;
  const q = question.toLowerCase();
  const reply = (answer, steps, extra = {}) => ({ answer, steps, sources: sourcesOf(answer, ctx), createdNotes: [], draft: null, ...extra });

  if (draft && /\b(write|draft|reply|respond|answer|say|tell|decline|accept|confirm|thank|reschedule|polite|shorter|longer|rewrite|formal|friendly)\b/.test(q)) {
    return reply('Here is a draft. Press "Use this draft" to put it in your email.',
      draft.replyToMessageId ? ["Read the email you're replying to"] : [],
      { draft: { body: writeDraft(draft, q, ctx), subject: null } });
  }

  const open = openMessageId ? ctx.findMessage(openMessageId) : null;
  if (open && /\b(note|remind)\b/.test(q)) return noteOpenEmail(open, question, ctx, reply);
  if (/\bsave\b|\bnote (that|it)\b|\b(make|turn) (that|it|this) into a note\b/.test(q)) return saveLastAnswer(history, ctx, reply);
  if (open && /\b(summar\w*|tl;?dr|what does|what's this|explain|about)\b/.test(q)) {
    return reply(`${nameOf(open.sender)} wrote [#${open.id}]: ${gist(open.body, 3)}`, [`Read "${open.subject}"`]);
  }

  for (const topic of TOPICS) {
    if (topic.match.test(q)) return reply(...topic.answer(ctx));
  }
  return searchAnswer(question, ctx, reply);
}

// [#12] and [note 3] markers -> sources, in order of first mention.
function sourcesOf(answer, ctx) {
  const sources = [];
  const seen = new Set();
  for (const [marker, prefix, rawId] of answer.matchAll(/\[(#|note )(\d+)\]/g)) {
    if (seen.has(marker)) continue;
    seen.add(marker);
    const id = Number(rawId);
    if (prefix === '#') {
      const m = ctx.findMessage(id);
      if (m) sources.push({ kind: 'email', id, accountId: m.account_id, subject: m.subject, sender: m.sender, received_at: m.received_at, preview: m.snippet.slice(0, 150) });
    } else {
      const note = ctx.data.notes.find(n => n.id === id);
      if (note) sources.push({ kind: 'note', id, title: note.body.split('\n').find(l => l.trim())?.trim() || '(empty note)' });
    }
  }
  return sources;
}

// "note this email, remind me Friday"
function noteOpenEmail(open, question, ctx, reply) {
  const reminder = parseReminder(question);
  const addons = [{ kind: 'email_link', messageId: open.id }];
  if (reminder) addons.push({ kind: 'reminder', remindAt: reminder.date.toISOString() });
  const title = open.subject.replace(/^(re|fwd?):\s*/i, '');
  const id = ctx.saveNote(`${title}\n${gist(open.body)}`, addons, 'ai');
  const when = reminder ? `, with a reminder ${describeReminder(reminder.date)}` : '';
  return reply(`Noted [note ${id}], linked to this email${when}.`,
    [`Read "${open.subject}"`, 'Created a note'],
    { createdNotes: [{ id, title }] });
}

// "save that as a note", after an answer
function saveLastAnswer(history, ctx, reply) {
  const last = history[history.length - 1];
  if (!last) return reply('Ask me something first, then I can save the answer as a note. Or open an email and say "note this email".', []);
  const emailIds = [...new Set([...last.answer.matchAll(/\[#(\d+)\]/g)].map(m => Number(m[1])))].filter(id => ctx.findMessage(id));
  const text = last.answer.replace(/\s*\[(?:#|note )\d+\]/g, '').replace(/\n*Your [^\n]* note [^\n]*$/i, '').trim();
  const topic = TOPICS.find(t => t.match.test(last.question.toLowerCase()));
  const noteTitle = topic?.title || `About: ${last.question.replace(/[?.!]+$/, '')}`;
  const id = ctx.saveNote(`${noteTitle}\n${text}`, emailIds.map(messageId => ({ kind: 'email_link', messageId })), 'ai');
  const linked = emailIds.length ? `, linked to the ${emailIds.length === 1 ? 'email' : `${emailIds.length} emails`} it came from` : '';
  return reply(`Saved it as a note [note ${id}]${linked}.`, ['Created a note'], { createdNotes: [{ id, title: noteTitle }] });
}

function writeDraft(draft, q, ctx) {
  const original = draft.replyToMessageId ? ctx.findMessage(draft.replyToMessageId) : null;
  const toSender = original ? original.sender : draft.to || '';
  const to = firstName(toSender);
  const greeting = GENERIC_SENDERS.test(emailOf(toSender)) ? 'Hi there,' : to && !/[@<]/.test(to) ? `Hi ${to},` : 'Hi [name],';
  let middle;
  if (/\b(decline|can't|cannot|no thanks|not able)\b/.test(q)) {
    middle = "Thank you for thinking of me. Unfortunately I can't make it this time, but I'd be glad to help another way if that's useful.";
  } else if (/\b(reschedul|another time|move it|later)\b/.test(q)) {
    middle = "Would it be possible to find another time? I'm free most afternoons this week: [times that work for you].";
  } else if (/\b(accept|confirm|yes|works|sounds good)\b/.test(q)) {
    middle = original ? `That works for me, thank you. I'll be there and will come prepared.` : "I'm happy to confirm. [details]";
  } else if (/\bthank/.test(q)) {
    middle = original ? `Thank you for the update about "${original.subject.replace(/^(re|fwd?):\s*/i, '')}". I appreciate it.` : 'Thank you for [what they did]. I really appreciate it.';
  } else {
    middle = original
      ? `Thanks for your email about "${original.subject.replace(/^(re|fwd?):\s*/i, '')}". [Your reply here]`
      : 'I wanted to reach out about [topic]. [The details]';
  }
  return `${greeting}\n\n${middle}\n\nBest,\nAlex`;
}

// Anything else: the emails that match the question's words.
function searchAnswer(question, ctx, reply) {
  const words = [...new Set(question.toLowerCase().match(/[a-z0-9]{3,}/g) || [])].filter(w => !STOP_WORDS.has(w));
  const scored = new Map();
  for (const word of words) {
    for (const m of ctx.searchEmails(word)) scored.set(m, (scored.get(m) || 0) + 1);
  }
  const found = [...scored].sort((a, b) => b[1] - a[1] || b[0].received_at.localeCompare(a[0].received_at)).slice(0, 3).map(([m]) => m);
  const steps = [`Searched your email for "${words.slice(0, 4).join(' ') || question}"`];
  if (!found.length) {
    return reply("I couldn't find anything about that in this demo's made-up email. The demo's assistant gives ready-made answers instead of using AI, so try asking about your job applications, your glasses prescription, the Seattle trip, school, work, or what's new.", steps);
  }
  const lines = found.map(m => `- ${m.subject}, from ${nameOf(m.sender)} [#${m.id}]`).join('\n');
  return reply(`These look related:\n\n${lines}\n\nThe demo's assistant gives ready-made answers instead of using AI, so for anything beyond a search, try asking about your job applications, the Seattle trip, school, work, or what's new.`, steps);
}

const TOPICS = [
  {
    match: /glasses|prescription|optometr|\beyes?\b/,
    title: 'Glasses prescription',
    answer: () => [
      `Your prescription is in the email from Clearview Optometry [#${IDS.glasses}]:\n\nRight eye (OD): -2.25 sphere, -0.50 cylinder, axis 180\nLeft eye (OS): -2.00 sphere, -0.75 cylinder, axis 175\nPupillary distance: 63 mm\n\nIt's also attached as prescription.pdf, and it's valid for two years. You have a note to order new glasses [note ${NOTE_IDS.glasses}].`,
      ['Searched your email for "eyeglass prescription"', 'Read "Your eyeglass prescription"', 'Searched your notes for "glasses"'],
    ],
  },
  {
    match: /\bjobs?\b|application|interview|applied|hiring|recruit|offer/,
    title: 'Job applications',
    answer: ({ data: { facts } }) => [
      `Three applications are active:\n\n- Brightwave, Software Engineer: a 60-minute video interview ${shortDate(facts.interviewAt)} at ${clock(facts.interviewAt)}, with pair programming [#${IDS.brightwave}]. You confirmed and said you'd use TypeScript [#${IDS.brightwaveReply}].\n- Lumen Labs, Frontend Engineer: you passed the first round [#${IDS.lumenReceived}], and the coding challenge (a small React app, about 3 hours) is due ${shortDate(facts.challengeDue)} [#${IDS.lumenChallenge}].\n- Harbor Analytics, Junior Data Engineer: they went with other candidates [#${IDS.harbor}].\n\nYour job search note tracks the same three [note ${NOTE_IDS.jobs}].`,
      ['Searched your email for "application interview"', 'Read "Interview invitation: Software Engineer, Brightwave"', 'Read "Re: Application received: Frontend Engineer at Lumen Labs"', 'Searched your notes for "job"'],
    ],
  },
  {
    match: /flight|trip|seattle|travel|check.?in|\bpack(ing)?\b|airport/,
    title: 'Seattle trip',
    answer: ({ data: { facts } }) => [
      `Your flight is Skyline Air SK 482 from Dallas (DAL) to Seattle (SEA), ${shortDate(facts.flightAt)} at ${clock(facts.flightAt)}. Confirmation QX7P2L, seat 14C, and check-in is open now [#${IDS.flight}].\n\nYour packing note lists a rain jacket, charger, headphones and boarding pass [note ${NOTE_IDS.trip}]. The headphones from Shopwise are due today, so they should make it [#${IDS.order}].`,
      ['Searched your email for "flight Seattle"', 'Read "Check-in is open for your flight to Seattle"', 'Searched your notes for "Seattle"'],
    ],
  },
  {
    match: /order|package|ship|deliver|headphone|shopwise|parcel/,
    title: 'Shopwise order',
    answer: ({ findMessage }) => [
      `Your Shopwise order #SW-48213 (noise-cancelling headphones and a USB-C cable, $142.98) shipped with Parcelway and is due today [#${IDS.order}].${findMessage(401) ? ' It is out for delivery now and should arrive by 8 PM [#401].' : ''}`,
      ['Searched your email for "order shipped"', 'Read "Your order shipped"'],
    ],
  },
  {
    match: /\brent\b|apartment|landlord|lease/,
    title: 'Rent',
    answer: ({ data: { facts } }) => [
      `Rent is $1,150 for unit 214, due ${shortDate(facts.rentDue)}. You can pay in the resident portal [#${IDS.rent}].`,
      ['Searched your email for "rent"', 'Read "Rent reminder"'],
    ],
  },
  {
    match: /roadmap|standup|\bwork\b|panel|northwind|meeting|\bteam\b/,
    title: 'Work this week',
    answer: ({ data: { facts } }) => [
      `At work:\n\n- The Q3 roadmap review moved to ${shortDate(facts.reviewAt)} at ${clock(facts.reviewAt)} in the Cedar room, and faster search now comes before saved filters, as you suggested [#${IDS.roadmapMoved}] [#${IDS.roadmapReply}].\n- You're on the interview panel ${shortDate(facts.panelAt)} at ${clock(facts.panelAt)}, covering the code review session [#${IDS.panel}].\n- At standup: your new ranking is behind a flag on staging [#${IDS.standup}].\n\nYour weekly update to Priya and Jordan is scheduled to send tomorrow at 8:00 AM.`,
      ['Searched your email for "roadmap review"', 'Read "Re: Q3 roadmap review"', 'Read "Standup notes"'],
    ],
  },
  {
    match: /homework|\bhw\b|grade|class|school|lab|quiz|exam|midterm|office hours|professor|registration|capstone|due/,
    title: 'School this week',
    answer: ({ data: { facts }, findMessage }) => [
      `This week at school:\n\n- HW 4 is graded: 92/100, against a class average of 81 [#${IDS.hwGraded}].\n- The Lab 6 report is due ${shortDate(facts.labDue)} at 5 PM [#${IDS.labReport}]; your outline is in your notes [note ${NOTE_IDS.labReport}].\n- Dr. Park's office hours moved to ${shortDate(facts.officeHoursAt)}, 3 to 4:30 PM [#${IDS.officeHours}].\n- Spring registration opens Monday, and you have 9 credit hours left [#${IDS.registration}].${findMessage(402) ? `\n- Quiz 3 opens tomorrow at 9 AM [#402].` : ''}`,
      ['Searched your email for "due graded"', 'Read "HW 4 graded"', `Read "Lab report due ${weekday(facts.labDue)}"`],
    ],
  },
  {
    match: /\bnew\b|today|catch|summar|miss|important|inbox|what'?s up|anything|urgent|priorit/,
    title: 'Catching up',
    answer: ({ data }) => {
      const since = Date.now() - DAY_MS;
      const recent = data.messages
        .filter(m => !m.labels.includes('SENT') && new Date(m.received_at).getTime() > since)
        .sort((a, b) => b.received_at.localeCompare(a.received_at));
      const lines = recent.map(m => `- ${HEADLINES[m.id]?.(data.facts) || `${m.subject}, from ${nameOf(m.sender)}`} [#${m.id}]`).join('\n');
      return [
        `Here's what came in over the last day:\n\n${lines}\n\nMost urgent: check in for tomorrow's flight to Seattle [#${IDS.flight}]. You've already replied to Brightwave about the interview [#${IDS.brightwaveReply}].`,
        ['Listed your email from the last day', 'Read "Check-in is open for your flight to Seattle"'],
      ];
    },
  },
];

// One-line summaries for the "what's new" answer.
const HEADLINES = {
  [IDS.order]: () => 'Your Shopwise order shipped and is due today',
  [IDS.standup]: () => 'Standup notes: your ranking work is on staging',
  [IDS.hwGraded]: () => 'HW 4 is graded: 92/100',
  [IDS.roadmapMoved]: f => `The roadmap review moved to ${weekday(f.reviewAt)} at ${clock(f.reviewAt)}`,
  [IDS.panel]: f => `You're on an interview panel ${weekday(f.panelAt)} at ${clock(f.panelAt)}`,
  [IDS.flight]: () => 'Check-in is open for your flight to Seattle',
  [IDS.officeHours]: f => `Dr. Park's office hours moved to ${weekday(f.officeHoursAt)}`,
  [IDS.brightwave]: f => `Brightwave invited you to interview ${weekday(f.interviewAt)}`,
  [IDS.rent]: f => `Rent of $1,150 is due ${weekday(f.rentDue)}`,
  401: () => 'Your Shopwise package is out for delivery',
  402: () => 'Quiz 3 opens tomorrow',
};
