import { AppShell } from "@/features/nav/app-shell";

/** The authenticated social workspace; auth routes intentionally have no chrome. */
export default function AppLayout({ children }: LayoutProps<"/">) {
  return <AppShell>{children}</AppShell>;
}
