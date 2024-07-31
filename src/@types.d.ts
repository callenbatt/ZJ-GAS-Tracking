declare namespace ZendeskAPI {
  export interface GetJiraLinksResponse {
    links: JiraLink[];
    total: number;
    meta: {
      after_cursor: string;
      has_more: boolean;
    };
  }

  export interface GetTicketsResponse {
    tickets: Ticket[];
    organizations: Organization[];
    groups: Group[];
    brands: Brand[];
    next_page: string;
    previous_page: string;
    count: number;
  }

  export interface GetTicketIncidentsResponse {
    tickets: Ticket[];
    organizations: Organization[];
    groups: Group[];
    brands: Brand[];
    next_page: string;
    previous_page: string;
    count: number;
  }

  export interface Brand {
    id: number;
    name: string;
  }

  export interface Group {
    id: number;
    name: string;
  }

  export interface JiraLink {
    ticket_id: string;
    issue_id: string;
    issue_key: string;
    created_at: string;
    id: number;
    updated_at: string;
    url?: string;
  }

  export interface Organization {
    id: number;
    name: string;
    organization_fields: {
      arr: number;
      strikedeck_health: string;
      sitekey: string;
      sf_keyword: string;
      sf_full_account_id: string;
    };
  }

  export interface Ticket {
    id: number;
    subject: string;
    created_at: string;
    updated_at: string;
    status: string;
    priority: string;
    type: string;
    organization_id: number;
    group_id: number;
    brand_id: number;
    problem_id: number | null;
  }
}

declare namespace JiraAPI {
  export interface GetIssueResponse {
    id: number;
    fields: {
      status: {
        name: string;
        statusCategory: {
          key: string;
        };
      };
      priority: {
        name: string;
      };
      project: {
        name: string;
        key: string;
      };
      components: [
        {
          self: string;
          id: string;
          name: string;
          description: string;
        }
      ];
      customfield_11903?: {
        value: string;
      };
      created: string;
      updated: string;
      issuetype: {
        name: string;
      };
      summary: string;
    };
  }
}

declare namespace ZendeskLegacyAPI {
  export interface CreateJiraLinkRequest {
    link: {
      issue_id: number;
      issue_key: string;
      ticket_id: number;
    };
  }

  export interface CreateJiraLinkResponse {
    link: ZendeskAPI.JiraLink;
  }
}
