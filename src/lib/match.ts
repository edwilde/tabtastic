import type { Project } from './types';

/**
 * Match a window title against project names. Chrome's "Name window" feature
 * prefixes the OS title with the user-chosen string, so a window labelled
 * "Foo" surfaces as `"Foo - <active tab> - Google Chrome"`. We treat that as
 * a strong (`name-window`) match; a looser case-insensitive word-boundary
 * contains is offered as a softer (`title-contains`) fallback.
 */
export function bestTitleMatch(
  title: string,
  projects: Project[],
): { project: Project; reason: 'name-window' | 'title-contains' } | null {
  // Strip "(12) " unread-tab notification counter Chrome prepends.
  const cleaned = title.replace(/^\(\d+\)\s+/, '').trim();
  if (!cleaned || projects.length === 0) return null;
  const lower = cleaned.toLowerCase();

  let fallback: Project | null = null;
  for (const p of projects) {
    const n = p.name.trim().toLowerCase();
    if (!n) continue;
    if (lower === n || lower.startsWith(`${n} - `) || lower.startsWith(`${n} – `)) {
      return { project: p, reason: 'name-window' };
    }
    if (!fallback && hasBoundedSubstring(lower, n)) fallback = p;
  }
  return fallback ? { project: fallback, reason: 'title-contains' } : null;
}

// Substring match that won't fire inside a larger alphanumeric run.
// "Acme" matches "(Acme)" but not "Acmewidgets". Works for project names
// containing regex metacharacters (e.g. "C++ (work)") without re-escaping.
function hasBoundedSubstring(haystack: string, needle: string): boolean {
  const idx = haystack.indexOf(needle);
  if (idx < 0) return false;
  const alnum = /[a-z0-9]/i;
  const before = idx > 0 ? haystack[idx - 1] : '';
  const after = idx + needle.length < haystack.length ? haystack[idx + needle.length] : '';
  if (alnum.test(needle[0] ?? '') && before && alnum.test(before)) return false;
  if (alnum.test(needle[needle.length - 1] ?? '') && after && alnum.test(after)) return false;
  return true;
}
