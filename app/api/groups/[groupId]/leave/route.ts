import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

export async function POST(
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

  const { data: group, error: groupError } = await supabase
    .from("groups")
    .select("created_by")
    .eq("id", groupId)
    .maybeSingle();

  if (groupError || !group) {
    return NextResponse.json({ error: "Group not found" }, { status: 404 });
  }

  if (group.created_by === userId) {
    return NextResponse.json(
      { error: "Group owners cannot leave their own group." },
      { status: 400 },
    );
  }

  const { data: deletedRows, error: deleteError } = await supabase
    .from("group_members")
    .delete()
    .eq("group_id", groupId)
    .eq("user_id", userId)
    .select("group_id");

  if (deleteError) {
    return NextResponse.json(
      { error: "Failed to leave group" },
      { status: 500 },
    );
  }

  if (!deletedRows || deletedRows.length === 0) {
    return NextResponse.json(
      { error: "You are not a member of this group" },
      { status: 404 },
    );
  }

  return NextResponse.json({ left: true, groupId }, { status: 200 });
}
