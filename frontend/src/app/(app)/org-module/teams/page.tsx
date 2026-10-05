import { redirect } from 'next/navigation';

/** Teams live on the unified Org Structure screen now (Teams tab). */
export default function TeamsPage() {
  redirect('/org-module/org-structure?tab=teams');
}
