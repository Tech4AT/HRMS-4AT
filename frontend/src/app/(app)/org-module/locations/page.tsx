import { redirect } from "next/navigation";

export default function RedirectToUnified() {
  redirect("/org-module/org-structure?tab=locations");
}
