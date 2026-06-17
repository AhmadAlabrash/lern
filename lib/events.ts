export function normalizeEventList(value: any): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }

  if (typeof value === 'string') {
    return value
      .split(/[\n,]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

export function getEventName(payload: any) {
  return String(payload?.event || '').trim();
}

export function shouldDeliverForEvent(configuredEvents: any, eventName: string) {
  const events = normalizeEventList(configuredEvents);
  if (!eventName || events.length === 0) return false;
  return events.includes('*') || events.includes(eventName);
}
