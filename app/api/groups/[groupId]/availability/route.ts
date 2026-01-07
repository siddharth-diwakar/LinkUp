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

function timeToMinutes(timeValue: string): number {
  const [hours, minutes, seconds] = timeValue.split(":").map(Number);
  const safeHours = Number.isFinite(hours) ? hours : 0;
  const safeMinutes = Number.isFinite(minutes) ? minutes : 0;
  const safeSeconds = Number.isFinite(seconds) ? seconds : 0;
  return safeHours * 60 + safeMinutes + safeSeconds / 60;
}

function formatEndTime(timeValue: string): string {
  return timeValue.slice(0, 5);
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ groupId: string }> },
) {
  const supabase = await createClient();
  const { data: authData, error: authError } =
    await supabase.auth.getClaims();

  if (authError || !authData?.claims?.sub) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
      { free: [], busy: [], unknown: [] },
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

  const now = new Date();
  const jsDay = now.getDay();
  const weekday = jsDay === 0 ? 7 : jsDay;
  const isWeekday = weekday >= 1 && weekday <= 5;
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

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

  const busyMap = new Map<string, { busy_until: string }>();

  for (const block of busyBlocks) {
    const startMinutes = timeToMinutes(block.start_time);
    const endMinutes = timeToMinutes(block.end_time);
    if (startMinutes <= nowMinutes && nowMinutes < endMinutes) {
      const existing = busyMap.get(block.user_id);
      if (!existing || endMinutes < timeToMinutes(existing.busy_until)) {
        busyMap.set(block.user_id, {
          busy_until: formatEndTime(block.end_time),
        });
      }
    }
  }

  const free: Array<{ user_id: string; display_name: string }> = [];
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

    free.push({ user_id: member.user_id, display_name: name });
  }

  return NextResponse.json({ free, busy, unknown }, { status: 200 });
}
