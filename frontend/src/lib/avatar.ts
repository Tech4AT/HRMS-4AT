/** Deterministic avatar look for people who have no photo: the same person
 *  always gets the same gradient, and initials come from their name. */

const GRADIENTS = [
  'from-slate-600 to-slate-800',
  'from-rose-600 to-pink-600',
  'from-blue-600 to-indigo-600',
  'from-fuchsia-600 to-purple-600',
  'from-emerald-600 to-teal-600',
  'from-amber-600 to-orange-600',
  'from-cyan-600 to-blue-600',
  'from-indigo-600 to-violet-600',
];

export function avatarGradient(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return GRADIENTS[hash % GRADIENTS.length];
}

export function initialsOf(firstName: string, lastName: string): string {
  return `${firstName?.[0] ?? ''}${lastName?.[0] ?? ''}`.toUpperCase() || '—';
}
