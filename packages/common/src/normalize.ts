import { JiraIssuePayload, NotifyJob } from './types';

function isEmail(s?: string | null): s is string {
  return !!s && /.+@.+\..+/.test(s);
}

/**
 * Normalize a Jira issue webhook payload to one or more NotifyJob(s).
 * MVP: fan-out to the assignee's email only.
 */
export function normalizeJiraIssue(payload: JiraIssuePayload): NotifyJob[] {
  const issue = payload?.issue;
  const key = issue?.key ?? '';
  const summary = issue?.fields?.summary ?? '';
  const assigneeEmail = issue?.fields?.assignee?.emailAddress ?? undefined;

  const jobs: NotifyJob[] = [];
  if (isEmail(assigneeEmail)) {
    const message = key && summary ? `[${key}] ${summary}` : summary || key || 'New Jira event';
    jobs.push({
      source: 'jira',
      email: assigneeEmail,
      message,
      url: undefined, // Could map to issue.self or a browse URL if available
      eventId: issue?.id,
    });
  }
  return jobs;
}
