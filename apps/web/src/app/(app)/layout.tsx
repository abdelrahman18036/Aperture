import { AppShell } from "@/features/nav/app-shell";

/**
 * The authenticated shell.
 *
 * Three columns, and the widths matter: nav rail 72px collapsed and 240px
 * expanded, feed column **fixed at 640px and centred, never fluid**, right
 * rail 320px and dropped below 1280px.
 *
 * A photo feed that reflows on window resize feels unstable, so the window
 * is absorbed by the rails rather than by the photographs.
 *
 * This is a route group, not a boolean prop: `(auth)` has no chrome at all,
 * and that difference is structural rather than conditional.
 */
export default function AppLayout({ children }: LayoutProps<"/">) {
  return <AppShell>{children}</AppShell>;
}
