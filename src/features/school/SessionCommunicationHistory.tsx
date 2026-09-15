import type { SessionCommunication } from "./session-communication-contract";
import { sessionCommunicationMessages } from "./session-communication-messages";

export function SessionCommunicationHistory({ records, locale, studentNames, timeZone }: {
  records: readonly SessionCommunication[]; locale: string; studentNames?: Record<string, string>; timeZone: string;
}) {
  const m = sessionCommunicationMessages(locale);
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short", timeZone });
  return <div className="space-y-2 text-xs">
    <h4 className="font-medium">{m.history}</h4>
    {!records.length && <p className="text-muted">{m.empty}</p>}
    <ul className="max-h-80 space-y-3 overflow-auto">{records.map(record => <li key={record.id} className="space-y-1">
      <p className="text-muted">{studentNames && `${record.studentId ? studentNames[record.studentId] ?? m.student : m.classRecord} · `}
        {record.occurredOn} · {m.channels[record.channel]} · {m.outcomes[record.outcome]}</p>
      <p className="whitespace-pre-wrap break-words">{record.content}</p>
      {record.outcome === "follow_up" && <p>{m.nextAction}：{record.nextAction} · {record.nextFollowUpOn}</p>}
      <p className="text-muted">{record.author} · {date.format(new Date(record.createdAt))}</p>
    </li>)}</ul>
  </div>;
}
