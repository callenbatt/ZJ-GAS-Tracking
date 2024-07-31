class APIService {
  usernameProp: string;
  passwordProp: string;
  username: string | null;
  password: string | null;
  auth: string;
  baseUrl: string;

  constructor() {
    this.usernameProp = ""; // defined in subclasses
    this.passwordProp = ""; // defined in subclasses
    this.baseUrl = ""; // defined in subclasses
    this.username = PropertiesService.getScriptProperties().getProperty(
      this.usernameProp
    );
    this.password = PropertiesService.getScriptProperties().getProperty(
      this.passwordProp
    );
    this.auth = Utilities.base64Encode(`${this.username}:${this.password}`);
  }

  req(
    path: string,
    params?: string,
    method: GoogleAppsScript.URL_Fetch.HttpMethod = "get",
    body?: Record<string, any>
  ): any | Error {
    try {
      const options: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions = {
        method: method,
        headers: {
          Authorization: `Basic ${this.auth}`,
        },
        contentType: "application/json",
        muteHttpExceptions: false,
      };

      if (body && Object.keys(body).length > 0) {
        options.payload = JSON.stringify(body);
      }

      const url = `${this.baseUrl}${path}${params ? `?${params}` : ""}`;
      const response = UrlFetchApp.fetch(url, options);

      if (
        response.getResponseCode() < 200 ||
        response.getResponseCode() > 299
      ) {
        throw new Error(`Error: ${response.getResponseCode()}`);
      }

      return JSON.parse(response.getContentText());
    } catch (e) {
      console.error("Error in ZendeskAPI.req", e);
      return e;
    }
  }

  reqAll(requests: GoogleAppsScript.URL_Fetch.URLFetchRequest[]): any | Error {
    try {
      const responses = UrlFetchApp.fetchAll(requests);
      return responses.map((response) => {
        return JSON.parse(response.getContentText());
      });
    } catch (e) {
      console.error("Error in ZendeskAPI.reqAll", e);
      return e;
    }
  }
}

class ZendeskAPI extends APIService {
  baseUrl: string;

  constructor() {
    super();
    this.usernameProp = "ZENDESK_API_USERNAME";
    this.passwordProp = "ZENDESK_API_PASSWORD";
    this.baseUrl = `https://finalsite.zendesk.com/api/v2/`;
  }

  getJiraLinks(lastLinkId: number): ZendeskAPI.GetJiraLinksResponse {
    return this.req(`jira/links`, `page[after]=${lastLinkId}`);
  }

  getTickets(ids: string[]): ZendeskAPI.GetTicketsResponse {
    return this.req(
      "tickets/show_many",
      `ids=${ids.join(",")}&include=organizations,groups,brands`
    );
  }

  getTicketIncidents(id: number): ZendeskAPI.GetTicketIncidentsResponse {
    return this.req(
      `v2/tickets/${id}/incidents`,
      `include=organizations,groups,brands`
    );
  }
  getAllTicketIncidents(
    ids: number[]
  ): ZendeskAPI.GetTicketIncidentsResponse[] {
    return this.reqAll(
      ids.map((id) => {
        return {
          url: `${this.baseUrl}tickets/${id}/incidents?include=organizations,groups,brands`,
          method: "get",
          headers: {
            Authorization: `Basic ${this.auth}`,
          },
          contentType: "application/json",
          muteHttpExceptions: false,
        };
      })
    );
  }
}

class JiraAPI extends APIService {
  baseUrl: string;

  constructor() {
    super();
    this.baseUrl = `https://finalsite.atlassian.net/rest/api/3/`;
  }

  getIssue(id: number): JiraAPI.GetIssueResponse {
    return this.req(`/issue/${id}`);
  }

  getAllIssues(ids: string[]): JiraAPI.GetIssueResponse[] {
    return this.reqAll(
      ids.map((id) => {
        return {
          url: `${this.baseUrl}/issue/${id}`,
          method: "get",
          headers: {
            Authorization: `Basic ${this.auth}`,
          },
          contentType: "application/json",
          muteHttpExceptions: false,
        };
      })
    );
  }
}

class ZendeskLegacyAPI extends ZendeskAPI {
  constructor() {
    super();
    this.baseUrl = `https://finalsite.zendesk.com/api/services/`;
  }
  createJiraLink(
    body: ZendeskLegacyAPI.CreateJiraLinkRequest
  ): ZendeskLegacyAPI.CreateJiraLinkResponse {
    return this.req("jira/links", undefined, "post", body);
  }
}
