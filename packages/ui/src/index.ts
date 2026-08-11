/**
 * Aperture's design system: tokens, primitives, motion.
 *
 * **Nothing in here knows what a post is.** The test is whether a component
 * would make sense in a different product — `Button` and `DevelopImage`
 * would, `PostCard` would not. Feature components live in
 * `apps/web/src/features/`.
 *
 * `theme.css` and `fonts` are separate subpath exports: the stylesheet
 * belongs to the app's Tailwind entry point, and `fonts` pulls in
 * `next/font`, which nothing else here should have to carry.
 */

export { cn } from "./lib/cn";

export { Button, buttonVariants } from "./primitives/button";
export { Input } from "./primitives/input";
export {
  Avatar,
  AvatarFallback,
  AvatarGroup,
  AvatarImage,
} from "./primitives/avatar";
export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
} from "./primitives/dialog";
export { Skeleton } from "./primitives/skeleton";
export { Grain } from "./primitives/grain";

export { AmbientGlow } from "./media/ambient-glow";
export { DevelopImage } from "./media/develop-image";
export type { DevelopImageProps, ImageSource } from "./media/develop-image";
