export type SourceType = 'jira' | string;

export interface NotifyJob {
  source: SourceType;
  email: string;
  message: string;
  url?: string;
  eventId?: string;
  companyId?: string;
}

export interface Normalizer<TPayload = unknown> {
  (payload: TPayload): NotifyJob[];
}

export interface JiraIssuePayload {
  issue?: {
    id?: string;
    key?: string;
    self?: string;
    fields?: {
      summary?: string;
      assignee?: {
        emailAddress?: string;
      } | null;
    };
  };
}
