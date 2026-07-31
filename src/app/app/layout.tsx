import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AppShell } from "./shell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const store = await cookies();
  if (!store.get("sw_session")) redirect("/signin");
  return <AppShell>{children}</AppShell>;
}
