import { redirect } from 'next/navigation';

/** Documents now live in the Documents tab of the employee profile. */
export default function MyDocumentsRedirect() {
  redirect('/profile?tab=documents');
}
