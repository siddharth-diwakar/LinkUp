import { redirect } from "next/navigation";
import { Suspense } from "react";

import { createClient } from "@/lib/supabase/server";

function HomeFallback() {
  return <div className="min-h-screen bg-background" />;
}

async function HomeRedirect() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims?.sub) {
    redirect("/auth/login");
  }

  redirect("/dashboard");
}

export default function Home() {
  return (
    <Suspense fallback={<HomeFallback />}>
      <HomeRedirect />
    </Suspense>
  );
}
