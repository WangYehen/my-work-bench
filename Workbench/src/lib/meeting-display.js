const signaturePart = (value) => String(value || "").trim().toLocaleLowerCase("zh-CN");

export function meetingSignature(event) {
  return [event.startAt, event.endAt, event.title, event.location, event.meetingUrl].map(signaturePart).join("|");
}

export function mergeDuplicateMeetings(events = []) {
  const merged = new Map();
  for (const event of events) {
    const signature = meetingSignature(event);
    const current = merged.get(signature);
    if (current) current.duplicateCount += 1;
    else merged.set(signature, { ...event, duplicateCount: 1 });
  }
  return [...merged.values()];
}

export function meetingEndLabel(event, formatTime) {
  if (event?.isAllDay) return "";
  const start = Date.parse(event?.startAt);
  const end = Date.parse(event?.endAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return "时间待确认";
  return `${formatTime(event.endAt)} 结束`;
}
