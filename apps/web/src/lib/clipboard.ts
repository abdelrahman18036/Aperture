"use client";

/**
 * Copy text, and say whether it worked.
 *
 * Two attempts, because the modern API is the one that fails: `writeText`
 * needs a permission that an embedded webview, a non-secure origin or a
 * stricter browser will refuse, and it refuses by rejecting rather than by
 * doing something visible. `execCommand("copy")` is deprecated and needs no
 * permission, which makes it exactly the right fallback — it is what actually
 * works in a locked-down webview.
 *
 * **The return value is the point.** Swallowing the failure leaves a button
 * that does nothing and says nothing, which is indistinguishable from broken.
 * The caller shows the link itself when this returns false, so there is
 * always a way to get the URL.
 */
export async function writeToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fall through.
  }

  const field = document.createElement("textarea");
  field.value = text;
  // Off-screen rather than hidden: `display: none` cannot hold a selection.
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.append(field);
  field.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    field.remove();
  }
}
