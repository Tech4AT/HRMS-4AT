import { redirect } from 'next/navigation';

/** Job titles live on the unified Org Structure screen now (Job Titles tab). */
export default function JobTitlesPage() {
  redirect('/org-module/org-structure?tab=job-titles');
}
