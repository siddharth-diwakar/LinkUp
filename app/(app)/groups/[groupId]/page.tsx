import { notFound } from "next/navigation";

import { AvailabilityPanel } from "@/components/groups/availability-panel";
import { LeaveGroupButton } from "@/components/groups/leave-group-button";
import { createClient } from "@/lib/supabase/server";

type MemberRow = {
  user_id: string;
  profiles?: { display_name: string | null } | null;
};

type MemberRowRaw = {
  user_id: string;
  profiles?: { display_name: string | null }[] | { display_name: string | null } | null;
};

export default async function GroupPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;
  const supabase = await createClient();
  const { data: group } = await supabase
    .from("groups")
    .select("id,name,join_code,created_at")
    .eq("id", groupId)
    .maybeSingle();

  if (!group) {
    notFound();
  }

  const { data: members } = await supabase
    .from("group_members")
    .select("user_id, profiles ( display_name )")
    .eq("group_id", groupId);

  const memberRows = (members ?? []) as MemberRowRaw[];
  const normalizedMembers: MemberRow[] = memberRows.map((member) => {
    const profile = Array.isArray(member.profiles)
      ? member.profiles[0]
      : member.profiles;
    return {
      user_id: member.user_id,
      profiles: profile ?? null,
    };
  });
  const sortedMembers = [...normalizedMembers].sort((a, b) => {
    const nameA = a.profiles?.display_name?.trim() || a.user_id;
    const nameB = b.profiles?.display_name?.trim() || b.user_id;
    return nameA.localeCompare(nameB);
  });

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-3">
        <p className="text-sm uppercase tracking-[0.3em] text-muted-foreground">
          Group
        </p>
        <h1 className="font-display text-4xl md:text-5xl">{group.name}</h1>
        <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
          <span>
            Join code{" "}
            <span className="font-semibold text-foreground">
              {group.join_code}
            </span>
          </span>
          <span>{sortedMembers.length} members</span>
        </div>
        <LeaveGroupButton groupId={group.id} />
      </header>
      <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
        <section className="rounded-3xl border border-border/60 bg-card/80 p-6 shadow-sm">
          <h2 className="font-display text-2xl">Members</h2>
          <ul className="mt-4 space-y-3 text-sm">
            {sortedMembers.length === 0 ? (
              <li className="text-muted-foreground">
                No members yet. Share the join code to add people.
              </li>
            ) : (
              sortedMembers.map((member) => {
                const name = member.profiles?.display_name?.trim();
                return (
                  <li
                    key={member.user_id}
                    className="flex items-center justify-between rounded-2xl border border-border/60 bg-background/70 px-4 py-3"
                  >
                    <span>{name || member.user_id}</span>
                    <span className="text-xs text-muted-foreground">
                      Active
                    </span>
                  </li>
                );
              })
            )}
          </ul>
        </section>
        <section className="rounded-3xl border border-border/60 bg-card/80 p-6 shadow-sm">
          <h2 className="font-display text-2xl">Right now</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Availability is based on everyone&apos;s weekday class blocks.
          </p>
          <div className="mt-6">
            <AvailabilityPanel groupId={group.id} />
          </div>
        </section>
      </div>
    </div>
  );
}
