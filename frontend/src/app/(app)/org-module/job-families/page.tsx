import { redirect } from 'next/navigation';

/** Job families live on the unified Org Structure screen now (Job Families tab). */
export default function JobFamiliesPage() {
  redirect('/org-module/org-structure?tab=job-families');
}
