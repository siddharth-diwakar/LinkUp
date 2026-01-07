import * as ical from "node-ical";

export type BusyBlockInput = {
  weekday: number;
  start_time: string;
  end_time: string;
};

type ParsedEvent = {
  type?: string;
  start?: Date;
  end?: Date;
  datetype?: string;
  rrule?: {
    options?: {
      byweekday?: Array<{ weekday?: number }> | { weekday?: number } | number;
    };
  };
};

const WEEKDAY_MIN = 1;
const WEEKDAY_MAX = 5;
const CALENDAR_TIME_ZONE = "America/Chicago";
const WEEKDAY_LOOKUP: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};
const TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: CALENDAR_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const WEEKDAY_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: CALENDAR_TIME_ZONE,
  weekday: "short",
});

function formatTime(value: Date): string {
  const parts = TIME_FORMATTER.formatToParts(value);
  const hours = parts.find((part) => part.type === "hour")?.value ?? "00";
  const minutes = parts.find((part) => part.type === "minute")?.value ?? "00";
  return `${hours}:${minutes}:00`;
}

function getWeekdayInZone(value: Date): number | null {
  const label = WEEKDAY_FORMATTER.format(value);
  return WEEKDAY_LOOKUP[label] ?? null;
}

function extractWeekdays(event: ParsedEvent): number[] {
  const byweekday = event.rrule?.options?.byweekday;

  if (byweekday !== undefined) {
    const weekdays = Array.isArray(byweekday) ? byweekday : [byweekday];
    const normalized = new Set<number>();

    for (const entry of weekdays) {
      const weekday =
        typeof entry === "number" ? entry : entry?.weekday ?? null;

      if (typeof weekday === "number") {
        normalized.add(weekday + 1);
      }
    }

    if (normalized.size > 0) {
      return Array.from(normalized);
    }
  }

  if (event.start instanceof Date) {
    const weekday = getWeekdayInZone(event.start);
    if (weekday) {
      return [weekday];
    }
  }

  return [];
}

export function parseIcsToBusyBlocks(icsText: string): BusyBlockInput[] {
  const parsed = ical.parseICS(icsText) as Record<string, ParsedEvent>;
  const blocks: BusyBlockInput[] = [];

  for (const entry of Object.values(parsed)) {
    if (!entry || entry.type !== "VEVENT") {
      continue;
    }

    if (!(entry.start instanceof Date) || !(entry.end instanceof Date)) {
      continue;
    }

    if (entry.datetype === "date") {
      continue;
    }

    if (entry.end <= entry.start) {
      continue;
    }

    const weekdays = extractWeekdays(entry);
    if (weekdays.length === 0) {
      continue;
    }

    const startTime = formatTime(entry.start);
    const endTime = formatTime(entry.end);

    for (const weekday of weekdays) {
      if (weekday < WEEKDAY_MIN || weekday > WEEKDAY_MAX) {
        continue;
      }

      blocks.push({
        weekday,
        start_time: startTime,
        end_time: endTime,
      });
    }
  }

  return blocks;
}
