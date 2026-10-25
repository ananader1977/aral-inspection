// iCalendar generation (works with Zoho Calendar, Outlook, Google Calendar, Apple Calendar).
const fold = (line) => {
  const out = [];
  let s = line;
  while (Buffer.byteLength(s) > 74) {
    let cut = 74;
    while (Buffer.byteLength(s.slice(0, cut)) > 74) cut--;
    out.push(s.slice(0, cut));
    s = ' ' + s.slice(cut);
  }
  out.push(s);
  return out.join('\r\n');
};
const esc = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const stamp = (ts) => new Date(ts).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/**
 * events: [{uid,start,end,summary,description,location,color,status}] - times are epoch ms.
 * alarmMinutes adds a popup (DISPLAY) and an EMAIL alarm that many minutes before the start.
 */
export function buildIcs(events, { name = 'A R A L Inspection', alarmMinutes = 120, now = Date.now(), method } = {}) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//A R A L Inspection//Inspections//EN', 'CALSCALE:GREGORIAN'];
  if (method) lines.push(`METHOD:${method}`);
  lines.push(`X-WR-CALNAME:${esc(name)}`, 'X-WR-TIMEZONE:Asia/Dubai');
  for (const e of events) {
    lines.push('BEGIN:VEVENT', `UID:${e.uid}`, `DTSTAMP:${stamp(now)}`, `DTSTART:${stamp(e.start)}`, `DTEND:${stamp(e.end)}`, `SUMMARY:${esc(e.summary)}`);
    if (e.description) lines.push(`DESCRIPTION:${esc(e.description)}`);
    if (e.location) lines.push(`LOCATION:${esc(e.location)}`);
    lines.push(`STATUS:${e.status || 'CONFIRMED'}`);
    if (e.color) lines.push(`COLOR:${e.color}`);
    if (alarmMinutes) {
      const trig = `-PT${alarmMinutes}M`;
      lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(e.summary)}`, `TRIGGER:${trig}`, 'END:VALARM');
      lines.push('BEGIN:VALARM', 'ACTION:EMAIL', `SUMMARY:${esc('Reminder: ' + e.summary)}`, `DESCRIPTION:${esc(e.description || e.summary)}`, 'ATTENDEE:mailto:reminder@aral-inspection.invalid', `TRIGGER:${trig}`, 'END:VALARM');
    }
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
