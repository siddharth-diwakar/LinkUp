import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type MemberRow = {
  user_id: string;
  profiles?: { display_name: string | null } | null;
};

type MemberRowRaw = {
  user_id: string;
  profiles?: { display_name: string | null }[] | { display_name: string | null } | null;
};

type BusyBlockRow = {
  user_id: string;
  start_time: string;
  end_time: string;
};

type BusyInterval = {
  startMinutes: number;
  endMinutes: number;
  start_time: string;
  end_time: string;
};

const TIME_ZONE = "America/Chicago";
const WEEKDAY_LOOKUP: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};
const NOW_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE,
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function timeToMinutes(timeValue: string): number {
  const [hours, minutes, seconds] = timeValue.split(":").map(Number);
  const safeHours = Number.isFinite(hours) ? hours : 0;
  const safeMinutes = Number.isFinite(minutes) ? minutes : 0;
  const safeSeconds = Number.isFinite(seconds) ? seconds : 0;
  return safeHours * 60 + safeMinutes + safeSeconds / 60;
}

function formatTime(timeValue: string): string {
  const [hoursRaw, minutesRaw] = timeValue.split(":");
  const hours = Number(hoursRaw);
  const minutes = Number(minutesRaw);
  const safeHours = Number.isFinite(hours) ? hours : 0;
  const safeMinutes = Number.isFinite(minutes) ? minutes : 0;
  const period = safeHours >= 12 ? "PM" : "AM";
  const displayHours = ((safeHours + 11) % 12) + 1;
  return `${displayHours}:${safeMinutes.toString().padStart(2, "0")}${period}`;
}

function mergeBusyIntervals(blocks: BusyBlockRow[]) {
  const grouped = new Map<string, BusyInterval[]>();

  for (const block of blocks) {
    const startMinutes = timeToMinutes(block.start_time);
    const endMinutes = timeToMinutes(block.end_time);

    if (!Number.isFinite(startMinutes) || !Number.isFinite(endMinutes)) {
      continue;
    }

    if (endMinutes <= startMinutes) {
      continue;
    }

    const existing = grouped.get(block.user_id) ?? [];
    existing.push({
      startMinutes,
      endMinutes,
      start_time: block.start_time,
      end_time: block.end_time,
    });
    grouped.set(block.user_id, existing);
  }

  const mergedByUser = new Map<string, BusyInterval[]>();
  for (const [userId, intervals] of grouped.entries()) {
    intervals.sort((a, b) => {
      if (a.startMinutes !== b.startMinutes) {
        return a.startMinutes - b.startMinutes;
      }
      return a.endMinutes - b.endMinutes;
    });

    const merged: BusyInterval[] = [];
    for (const interval of intervals) {
      const last = merged.at(-1);
      if (!last) {
        merged.push({ ...interval });
        continue;
      }

      // Merge overlapping or back-to-back blocks so "busy until" reflects the
      // end of the contiguous class run (e.g., 10-1 and 1-3 => busy until 3).
      if (interval.startMinutes <= last.endMinutes) {
        if (interval.endMinutes > last.endMinutes) {
          last.endMinutes = interval.endMinutes;
          last.end_time = interval.end_time;
        }
        continue;
      }

      merged.push({ ...interval });
    }

    mergedByUser.set(userId, merged);
  }

  return mergedByUser;
}

function parseTimeParam(timeValue: string | null) {
  if (!timeValue) {
    return null;
  }

  const match = timeValue.match(
    /^([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/,
  );

  if (!match) {
    return null;
  }

  const normalized = `${match[1]}:${match[2]}:${match[3] ?? "00"}`;
  return {
    minutes: timeToMinutes(normalized),
    label: formatTime(normalized),
  };
}

function getCurrentTimeParts() {
  const parts = NOW_FORMATTER.formatToParts(new Date());
  const weekdayLabel = parts.find((part) => part.type === "weekday")?.value;
  const hours = parts.find((part) => part.type === "hour")?.value ?? "00";
  const minutes = parts.find((part) => part.type === "minute")?.value ?? "00";
  const weekday = weekdayLabel ? WEEKDAY_LOOKUP[weekdayLabel] : undefined;
  return {
    weekday: weekday ?? 1,
    hours: Number(hours),
    minutes: Number(minutes),
  };
}

export async function GET(
  request: Request,
  context: { params: Promise<{ groupId: string }> },
) {
  const supabase = await createClient();
  const { data: authData, error: authError } =
    await supabase.auth.getClaims();

  if (authError || !authData?.claims?.sub) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const requestUrl = new URL(request.url);
  const timeParam = requestUrl.searchParams.get("time");
  const parsedTime = parseTimeParam(timeParam);
  const checkedTime = parsedTime?.label ?? null;

  if (timeParam && !parsedTime) {
    return NextResponse.json(
      { error: "Invalid time format. Use HH:MM." },
      { status: 400 },
    );
  }

  const { groupId } = await context.params;
  const userId = authData.claims.sub;
  const admin = createAdminClient();

  const { data: membership, error: membershipError } = await admin
    .from("group_members")
    .select("group_id")
    .eq("group_id", groupId)
    .eq("user_id", userId)
    .maybeSingle();

  if (membershipError) {
    return NextResponse.json(
      { error: "Failed to validate membership" },
      { status: 500 },
    );
  }

  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: members, error: membersError } = await admin
    .from("group_members")
    .select("user_id, profiles ( display_name )")
    .eq("group_id", groupId);

  if (membersError || !members) {
    return NextResponse.json(
      { error: "Failed to load group members" },
      { status: 500 },
    );
  }

  const memberRows = members as MemberRowRaw[];
  const normalizedMembers: MemberRow[] = memberRows.map((member) => {
    const profile = Array.isArray(member.profiles)
      ? member.profiles[0]
      : member.profiles;
    return {
      user_id: member.user_id,
      profiles: profile ?? null,
    };
  });
  const userIds = normalizedMembers.map((member) => member.user_id);

  if (userIds.length === 0) {
    return NextResponse.json(
      { free: [], busy: [], unknown: [], checked_time: checkedTime },
      { status: 200 },
    );
  }

  const { data: uploads, error: uploadsError } = await admin
    .from("calendar_uploads")
    .select("user_id")
    .in("user_id", userIds);

  if (uploadsError) {
    return NextResponse.json(
      { error: "Failed to load calendar status" },
      { status: 500 },
    );
  }

  const uploadedSet = new Set((uploads ?? []).map((row) => row.user_id));

  const nowParts = getCurrentTimeParts();
  const weekday = nowParts.weekday;
  const isWeekday = weekday >= 1 && weekday <= 5;
  const nowMinutes = nowParts.hours * 60 + nowParts.minutes;
  const referenceMinutes = parsedTime?.minutes ?? nowMinutes;

  let busyBlocks: BusyBlockRow[] = [];
  if (isWeekday) {
    const { data: blocks, error: blocksError } = await admin
      .from("weekday_busy_blocks")
      .select("user_id,start_time,end_time")
      .eq("weekday", weekday)
      .in("user_id", userIds);

    if (blocksError) {
      return NextResponse.json(
        { error: "Failed to load busy blocks" },
        { status: 500 },
      );
    }

    busyBlocks = (blocks ?? []) as BusyBlockRow[];
  }

  const mergedBusyBlocksByUser = mergeBusyIntervals(busyBlocks);

  const busyMap = new Map<string, { busy_until: string; endMinutes: number }>();
  const nextBusyMap = new Map<
    string,
    { startMinutes: number; startLabel: string }
  >();

  for (const [userId, intervals] of mergedBusyBlocksByUser.entries()) {
    for (const interval of intervals) {
      if (interval.startMinutes > referenceMinutes) {
        const existingNext = nextBusyMap.get(userId);
        if (!existingNext || interval.startMinutes < existingNext.startMinutes) {
          nextBusyMap.set(userId, {
            startMinutes: interval.startMinutes,
            startLabel: formatTime(interval.start_time),
          });
        }
      }

      if (
        interval.startMinutes <= referenceMinutes &&
        referenceMinutes < interval.endMinutes
      ) {
        const existing = busyMap.get(userId);
        if (!existing || interval.endMinutes > existing.endMinutes) {
          busyMap.set(userId, {
            busy_until: formatTime(interval.end_time),
            endMinutes: interval.endMinutes,
          });
        }
      }
    }
  }

  const free: Array<{
    user_id: string;
    display_name: string;
    free_until: string | null;
  }> = [];
  const busy: Array<{
    user_id: string;
    display_name: string;
    busy_until: string;
  }> = [];
  const unknown: Array<{ user_id: string; display_name: string }> = [];

  for (const member of normalizedMembers) {
    const displayName = member.profiles?.display_name?.trim();
    const name = displayName || member.user_id;

    if (!uploadedSet.has(member.user_id)) {
      unknown.push({ user_id: member.user_id, display_name: name });
      continue;
    }

    const busyEntry = busyMap.get(member.user_id);
    if (busyEntry) {
      busy.push({
        user_id: member.user_id,
        display_name: name,
        busy_until: busyEntry.busy_until,
      });
      continue;
    }

    const nextBusy = nextBusyMap.get(member.user_id);
    free.push({
      user_id: member.user_id,
      display_name: name,
      free_until: nextBusy?.startLabel ?? null,
    });
  }

  return NextResponse.json(
    { free, busy, unknown, checked_time: checkedTime },
    { status: 200 },
  );
}
