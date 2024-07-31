function startOperations() {
  const operations = new Operations();
  operations.run();
}

function continueOperations() {
  const operations = new Operations();
  operations.run();
}

class Operations {
  SSID: string;
  sheets: {
    main: GoogleAppsScript.Spreadsheet.Sheet | null;
    diff: GoogleAppsScript.Spreadsheet.Sheet | null;
    changelog: GoogleAppsScript.Spreadsheet.Sheet | null;
    archive: GoogleAppsScript.Spreadsheet.Sheet | null;
  };
  task: string | null;
  INCREMENT: number;
  headers: string[];
  changelogHeaders: string[];

  constructor() {
    this.SSID = "";

    this.sheets = {
      // "main" sheet is the authoritative sheet for reporting
      main: SpreadsheetApp.openById(this.SSID).getSheetByName("main"),
      // "diff" sheet is used to gather new and updated data dduring the operations runs
      diff: SpreadsheetApp.openById(this.SSID).getSheetByName("diff"),
      // "changelog" sheet is used to track changes to the links
      changelog: SpreadsheetApp.openById(this.SSID).getSheetByName("changelog"),
      // "archive" sheet is used to store links where the ticket and issue are closed
      archive: SpreadsheetApp.openById(this.SSID).getSheetByName("archive"),
    };

    // "TASK" is a marker to determine the current state of the operations
    this.task = PropertiesService.getScriptProperties().getProperty("TASK");

    // the number of rows to update at a time
    this.INCREMENT = 100;

    // headers for "main", "diff", and "archive" sheets
    this.headers = [
      "link_id",
      "link_created_at",
      "link_updated_at",
      "ticket_id",
      "issue_id",
      "issue_key",
      "ticket_created_at",
      "ticket_updated_at",
      "ticket_status",
      "ticket_priority",
      "ticket_type",
      "ticket_subject",
      "ticket_problem_id",
      "ticket_organization_id",
      "ticket_organization_name",
      "ticket_organization_arr",
      "ticket_organization_sf_full_id",
      "ticket_organization_strikedeck_health",
      "ticket_organization_sf_sitekey",
      "ticket_organization_sitekey",
      "ticket_group_id",
      "ticket_group_name",
      "ticket_brand_id",
      "ticket_brand_name",
      "issue_project",
      "issue_summary",
      "issue_created_at",
      "issue_updated_at",
      "issue_status",
      "issue_status_key",
      "issue_priority",
      "issue_type",
      "issue_team",
      "issue_components",
    ];

    // headers for "changelog" sheet
    this.changelogHeaders = [
      "date",
      "link_id",
      "field",
      "value_from",
      "value_to",
      "notes",
    ];
  }

  run() {
    // we want to run a trigger ever 24 hours, which will
    // - create a trigger ever 5 minutes,
    // - run the main function through various subfunctions until all updates are complete
    // - delete the trigger.
    switch (this.task) {
      // every 24 hours, start the operations if the task is idle
      case "IDLE":
        this.initGetLinks();
        break;
      // every 5 minutes, continue the operations if the task is running
      case "RUNNING":
        this.initUpdateLinks();
        break;
      // on the next trigger after the updates are complete, diff the links and update the changelog
      case "DIFF":
        this.initDiffLinks();
        break;
    }
  }

  initGetLinks() {
    try {
      // create a trigger to continue the operations every 5 minutes
      this.createContinueOperationsTrigger();
      // run the main function to get new links
      const success = new GetLinks().runGetLinks();
      if (!success) throw new Error("GetLinks::runGetLinks:: failed");
      // set the current task to running
      PropertiesService.getScriptProperties().setProperty("TASK", "RUNNING");
    } catch (e) {
      console.error(e);
    }
  }

  initUpdateLinks() {
    try {
      const isFinished = new UpdateLinks().runUpdateLinks();

      if (isFinished) {
        // set the current task to diff
        PropertiesService.getScriptProperties().setProperty("TASK", "DIFF");
      }
    } catch (e) {
      console.error(e);
    }
  }

  initDiffLinks() {
    try {
      const success = new DiffLinks().runDiffLinks();
      if (!success) throw new Error("DiffLinks::runDiffLinks:: failed");
      // set the current task to idle
      PropertiesService.getScriptProperties().setProperty("TASK", "IDLE");
      // delete the trigger to continue the operations
      this.deleteContinueOperationsTrigger();
    } catch (e) {
      console.error(e);
    }
  }

  createContinueOperationsTrigger() {
    ScriptApp.newTrigger("continueOperations")
      .timeBased()
      .everyMinutes(5)
      .create();
  }

  deleteContinueOperationsTrigger() {
    const triggerToDelete = ScriptApp.getProjectTriggers().find(
      (trigger) => trigger.getHandlerFunction() === "continueOperations"
    );
    if (triggerToDelete) {
      ScriptApp.deleteTrigger(triggerToDelete);
    }
  }

  createJSONObjectOfValuesFromSheet(
    sheet: GoogleAppsScript.Spreadsheet.Sheet,
    key: string
  ) {
    const values = sheet.getDataRange().getValues();
    if (!values) return;
    const keys = values?.splice(0, 1)[0];
    const kexIdx = keys.indexOf(key);
    return values.reduce((acc: any, row) => {
      acc[row[kexIdx]] = row.reduce((rowAcc, col, j) => {
        rowAcc[keys[j]] = col;
        return rowAcc;
      }, {});
      return acc;
    }, {});
  }
}

class DiffLinks extends Operations {
  changelogWriteout: any[][];
  archiveWriteout: any[];
  mainWriteout: any[];

  constructor() {
    super();
    this.changelogWriteout = [];
    this.archiveWriteout = [];
    this.mainWriteout = [];
  }
  runDiffLinks() {
    if (!this.sheets.main || !this.sheets.diff) {
      console.error(
        `DiffLinks::runDiffLinks:: this.sheets.main or this.sheets.diff not found`
      );
      return;
    }

    // grab all data from the main sheet
    const mainValues = this.createJSONObjectOfValuesFromSheet(
      this.sheets.main,
      "link_id"
    );
    if (!mainValues) return;

    // grab all data from the diff sheet
    const diffValues = this.createJSONObjectOfValuesFromSheet(
      this.sheets.diff,
      "link_id"
    );
    if (!diffValues) return;

    // compare main values to diff values
    this.compareMainToDiff(mainValues, diffValues);

    // write the data to the main sheet, archive sheet, and changelog sheet
    this.writeToMainSheet();
    this.writeToArchiveSheet();
    this.writeToChangelogSheet();
    this.clearDiffSheet();

    // if all is successful, return true
    return true;
  }

  pushLinkToProperWriteout(link: any) {
    if (link.ticket_status === "closed" && link.issue_status === "closed") {
      this.archiveWriteout.push(link);
    } else {
      this.mainWriteout.push(link);
    }
  }

  pushChangesToChangelogWriteout(
    link_id: string,
    key: string,
    value_from: string = "",
    value_to: string = ""
  ) {
    let notes = "updated";
    if (value_from === "") {
      notes = "created";
    }
    if (value_to === "") {
      notes = "deleted";
    }
    this.changelogWriteout.push([
      new Date(),
      link_id,
      key,
      value_from,
      value_to,
      notes,
    ]);
  }

  compareMainToDiff(mainValues: any, diffValues: any) {
    Object.keys(diffValues).forEach((link) => {
      // if the link_id exists in the current values
      if (mainValues[link]) {
        // compare the values
        Object.keys(diffValues[link]).forEach((key) => {
          if (diffValues[link][key] !== mainValues[link][key]) {
            // write the differences to the changelog
            this.pushChangesToChangelogWriteout(
              link,
              key,
              mainValues[link][key],
              diffValues[link][key]
            );
          }
        });

        // if the ticket is closed, and the jira is closed, move to the archive
        this.pushLinkToProperWriteout(diffValues[link]);

        // remove the link_id from the current values
        delete mainValues[link];
      }
      // if the link_id does not exist in the current values, the link is new
      else {
        // write the differences to the changelog
        this.pushChangesToChangelogWriteout(
          link,
          "link_id",
          "",
          diffValues[link]["link_id"]
        );
        // if the ticket is closed, and the jira is closed, move to the archive
        this.pushLinkToProperWriteout(diffValues[link]);
      }
    });
    // loop through the remaining current values
    Object.keys(mainValues).forEach((link) => {
      // write the differences to the changelog
      this.pushChangesToChangelogWriteout(
        link,
        "link_id",
        mainValues[link]["link_id"]
      );
    });
  }

  writeToMainSheet() {
    if (!this.sheets.main) {
      console.error(`DiffLinks::writeToMainSheet:: this.sheets.main not found`);
      return;
    }

    // clear the main sheet
    this.sheets.main.getDataRange().clear();

    // convert data from []{} to [][] with the first row as headers
    const writeout = this.mainWriteout.map((link) => {
      return this.headers.map((header) => link[header]);
    });
    // write the data to the main sheet
    this.sheets.main
      .getRange(2, 1, writeout.length, this.headers.length)
      .setValues(writeout);

    // sort the main sheet by link_id
    this.sheets.main.sort(1);
  }

  writeToArchiveSheet() {
    if (!this.sheets.archive) {
      console.error(
        `DiffLinks::writeToArchiveSheet:: this.sheets.archive not found`
      );
      return;
    }
    // convert the data from []{} to [][]
    const writeout = this.archiveWriteout.map((link) => {
      return this.headers.map((header) => link[header]);
    });

    // insert the data to the archive sheet from row 2
    this.sheets.archive.insertRows(2, writeout.length);

    this.sheets.archive
      .getRange(2, 1, writeout.length, this.headers.length)
      .setValues(writeout);

    // sort the archive sheet by link_id
    this.sheets.archive.sort(1);
  }

  writeToChangelogSheet() {
    if (!this.sheets.changelog) {
      console.error(
        `DiffLinks::writeToChangelogSheet:: this.sheets.changelog not found`
      );
      return;
    }

    // insert the changelog data to the changelog sheet from row 2
    this.sheets.changelog.insertRows(2, this.changelogWriteout.length);

    // write the changelog data to the changelog sheet
    this.sheets.changelog
      .getRange(
        2,
        1,
        this.changelogWriteout.length,
        this.changelogHeaders.length
      )
      .setValues(this.changelogWriteout);

    // sort the changelog sheet by date
    this.sheets.changelog.sort(1);
  }

  clearDiffSheet() {
    if (!this.sheets.diff) {
      console.error(`DiffLinks::clearDiffSheet:: this.sheets.diff not found`);
      return;
    }
    this.sheets.diff.getDataRange().clear();
  }
}

class GetLinks extends Operations {
  lastLinkId: number;
  linkHeaders: string[];

  constructor() {
    super();
    // we want to keep track of the latest (greatest) current link_id
    this.lastLinkId = 0;

    // the headers for the link data we're getting
    this.linkHeaders = [
      "link_id",
      "link_created_at",
      "link_updated_at",
      "ticket_id",
      "issue_id",
      "issue_key",
    ];
  }

  runGetLinks() {
    // pull all links from the main sheet
    const mainLinkValues = this.getLinkValuesFromMainSheet();
    if (!mainLinkValues) {
      console.error(
        `GetLinks::runGetLinks:: mainLinkValues is null or undefined`
      );
      return;
    }

    // get all new links since the last run from zendesk
    const getJiraLinksResponse = this.getNewJiraLinksFromZendesk();
    if (getJiraLinksResponse instanceof Error) {
      console.error(
        `GetLinks::runGetLinks:: getJiraLinksResponse is an instance of Error`
      );
      return;
    }

    // merge the new links into the main link values
    const allLinkValues = this.mergeJiraLinksResponseIntoMainLinkValues(
      mainLinkValues,
      getJiraLinksResponse
    );

    // write all link data to the diff sheet
    this.writeAllLinkValuesToSheet(allLinkValues);

    // if all is successful, return true
    return true;
  }

  getLinkValuesFromMainSheet() {
    if (!this.sheets.main) {
      console.error(
        `GetLinks::getCurrentLinkValues:: this.sheets.main not found`
      );
      return;
    }
    // sort the sheet by the link_id column, just in case
    this.sheets.main.sort(1);
    const mainValues = this.sheets.main.getDataRange().getValues();
    const mainValueKeys = mainValues.splice(0, 1)[0];

    // created an index of the headers to the main values
    const idx: { [key: string]: number } = this.linkHeaders.reduce(
      (acc: { [key: string]: number }, key, i) => {
        acc[key] = mainValueKeys.indexOf(key);
        return acc;
      },
      {}
    );

    return mainValues.map((row) => {
      const linkId = row[idx.link_id];
      // update the lastLinkId if the current linkId is greater
      this.lastLinkId = linkId > this.lastLinkId ? linkId : this.lastLinkId;
      return [
        linkId,
        row[idx.link_created_at],
        row[idx.link_updated_at],
        row[idx.ticket_id],
        row[idx.issue_id],
        row[idx.issue_key],
      ];
    });
  }

  getNewJiraLinksFromZendesk(): ZendeskAPI.GetJiraLinksResponse | Error {
    const zendeskAPI = new ZendeskAPI();
    return zendeskAPI.getJiraLinks(this.lastLinkId);
  }

  mergeJiraLinksResponseIntoMainLinkValues(
    mainLinkValues: string[][],
    newLinkValues: ZendeskAPI.GetJiraLinksResponse
  ): string[][] {
    newLinkValues.links.forEach((link) => {
      mainLinkValues.push([
        link.id.toString(),
        link.created_at,
        link.updated_at,
        link.ticket_id,
        link.issue_id,
        link.issue_key,
      ]);
    });
    return mainLinkValues;
  }

  writeAllLinkValuesToSheet(allLinkValues: string[][]) {
    if (!this.sheets.diff) {
      console.error(
        `GetLinks::getCurrentLinkValues:: this.sheets.main not found`
      );
      return;
    }
    // write the new link values without the headers
    this.sheets.diff
      .getRange(2, 1, allLinkValues.length, allLinkValues[0].length)
      .setValues(allLinkValues);

    // then write the full headers to the first row
    this.sheets.diff
      .getRange(1, 1, 1, this.headers.length)
      .setValues([this.headers]);
  }
}

class UpdateLinks extends Operations {
  rowStart: number;
  rowEnd: number;
  increment: number;
  isLastRun: boolean;
  lastColumn: number;
  idx: { [key: string]: number };
  data: {
    links: { [key: string]: any };
    ticket_x_links: { [key: string]: string };
    tickets: { [key: string]: any };
    organizations: { [key: string]: any };
    groups: { [key: string]: any };
    brands: { [key: string]: any };
    ticket_ids: string[];
    jira_ids: string[];
    problem_ticket_ids: number[];
  };
  zendeskAPI: ZendeskAPI;
  jiraAPI: JiraAPI;
  zendeskLegacyAPI: ZendeskLegacyAPI;

  constructor() {
    super();
    this.increment = this.INCREMENT;
    this.rowStart = 2;
    this.rowEnd = this.rowStart - 1 + this.increment;
    this.isLastRun = false;
    this.lastColumn = this.headers.length;
    this.idx = {
      id: this.headers.indexOf("link_id"),
      created_at: this.headers.indexOf("link_created_at"),
      updated_at: this.headers.indexOf("link_updated_at"),
      ticket_id: this.headers.indexOf("ticket_id"),
      issue_id: this.headers.indexOf("issue_id"),
      issue_key: this.headers.indexOf("issue_key"),
    };
    this.data = {
      links: {},
      ticket_x_links: {},
      tickets: {},
      organizations: {},
      groups: {},
      brands: {},
      ticket_ids: [],
      jira_ids: [],
      problem_ticket_ids: [],
    };
    this.zendeskAPI = new ZendeskAPI();
    this.jiraAPI = new JiraAPI();
    this.zendeskLegacyAPI = new ZendeskLegacyAPI();
  }

  runUpdateLinks() {
    // grab rows 2 - 101 (100 rows inclusive)
    // delete rows 2 - 101 from sheet
    // get all the data
    // append the data to the diff sheet
    // find the last row of the diff sheet
    // if the last row is greater than the increment, set the increment to the remaining rows

    // grab links from current row through set increment
    if (!this.sheets.diff) {
      console.error(`UpdateLinks::runUpdateLinks:: this.sheets.diff not found`);
      return;
    }

    // grab the default range of rows to update from the diff sheet
    const linkValues = this.sheets.diff
      .getRange(this.rowStart, 1, this.increment, this.lastColumn)
      .getValues();

    // the linkValues should be an array of arrays
    // each array is a row of the diff sheet
    // only the first 6 columns should have content
    // so if there is content in the 7th column, we know we have reached the end of the data

    const rowIndexWithContent = linkValues.findIndex((row) => !row[6]);
    // say rowIndexWithContent is -1, then we have reached the end of the data
    // say rowIndexWithContent is 1,
    // then row 3 has content, so we'd only want to update row 2
    // so we'd set the rowEnd to 2
    if (rowIndexWithContent > -1) {
      this.isLastRun = true;
      this.rowEnd = this.rowStart - 1 + rowIndexWithContent; // 2
    }

    // do the things...
    // get all the unique ticket ids
    // const this.idx = {
    //   id: this.headers.indexOf("link_id"),
    //   created_at: this.headers.indexOf("link_created_at"),
    //   updated_at: this.headers.indexOf("link_updated_at"),
    //   ticket_id: this.headers.indexOf("ticket_id"),
    //   issue_id: this.headers.indexOf("issue_id"),
    //   issue_key: this.headers.indexOf("issue_key"),
    // };

    linkValues.forEach((link) => {
      this.data.tickets[link[this.idx.ticket_id]] = {};
      this.data.links[link[this.idx.id]] = {
        created_at: link[this.idx.created_at],
        updated_at: link[this.idx.updated_at],
        ticket_id: link[this.idx.ticket_id],
        issue_id: link[this.idx.issue_id],
        issue_key: link[this.idx.issue_key],
      };
      this.data.ticket_x_links[link[this.idx.ticket_id]] = link[this.idx.id];
    });

    this.data.ticket_ids = Object.keys(this.data.tickets);

    const getTicketsResponse = this.zendeskAPI.getTickets(this.data.ticket_ids);
    if (getTicketsResponse instanceof Error) return;

    getTicketsResponse.tickets.forEach((ticket) => {
      this.processResponseDataForTickets(ticket);

      if (ticket.type === "problem") {
        this.data.problem_ticket_ids.push(ticket.id);
      }
    });

    getTicketsResponse.organizations.forEach((organization) => {
      this.processResponseDataForOrganizations(organization);
    });

    getTicketsResponse.groups.forEach((group) => {
      this.processResponseDataForGroups(group);
    });

    getTicketsResponse.brands.forEach((brand) => {
      this.processResponseDataForBrands(brand);
    });

    const getAllTicketIncidentsResponse = this.zendeskAPI.getAllTicketIncidents(
      this.data.problem_ticket_ids
    );
    if (getAllTicketIncidentsResponse instanceof Error) return;

    getAllTicketIncidentsResponse.forEach((response) => {
      response.tickets.forEach((ticket) => {
        // if there is already a ticket with the same id,
        // there must be a link, so skip
        if (this.data.tickets[ticket.id]) {
          return;
        }
        // if there is no ticket with the same id,
        // there must be no link, so create the link
        if (ticket.problem_id) {
          const link_id = this.data.ticket_x_links[ticket.problem_id];
          const link = this.data.links[link_id];
          const linkResponse = this.zendeskLegacyAPI.createJiraLink({
            link: {
              ticket_id: ticket.id,
              issue_id: link.issue_id,
              issue_key: link.issue_key,
            },
          });
          if (linkResponse instanceof Error) return;
          this.processResponseDataForLinks(linkResponse.link);
        }
        this.data.ticket_ids.push(ticket.id.toString());
        this.processResponseDataForTickets(ticket);
      });

      response.organizations.forEach((organization) => {
        if (this.data.organizations[organization.id]) {
          return;
        }
        this.processResponseDataForOrganizations(organization);
      });

      response.groups.forEach((group) => {
        if (this.data.groups[group.id]) {
          return;
        }
        this.processResponseDataForGroups(group);
      });

      response.brands.forEach((brand) => {
        if (this.data.brands[brand.id]) {
          return;
        }
        this.processResponseDataForBrands(brand);
      });
    });

    this.data.jira_ids = Object.keys(this.data.links);

    const getAllIssuesResponse = this.jiraAPI.getAllIssues(this.data.jira_ids);
    if (getAllIssuesResponse instanceof Error) return;

    getAllIssuesResponse.forEach((issue: JiraAPI.GetIssueResponse) => {
      this.processResponseDataForIssues(issue);
    });

    const writeOut = this.data.links.map((link: ZendeskAPI.JiraLink) => {
      const ticket_id = link.ticket_id;
      const organization_id = this.data.tickets[ticket_id].organization_id;
      const group_id = this.data.tickets[ticket_id].group_id;
      const brand_id = this.data.tickets[ticket_id].brand_id;
      const jira_id = link.issue_id;
      return [
        link.id,
        link.created_at,
        link.updated_at,
        link.ticket_id,
        link.issue_id,
        link.issue_key,
        this.data.tickets[ticket_id].ticket_created_at,
        this.data.tickets[ticket_id].ticket_updated_at,
        this.data.tickets[ticket_id].ticket_status,
        this.data.tickets[ticket_id].ticket_priority,
        this.data.tickets[ticket_id].ticket_type,
        this.data.tickets[ticket_id].ticket_subject,
        this.data.tickets[ticket_id].ticket_problem_id,
        organization_id,
        this.data.organizations[organization_id].ticket_organization_name,
        this.data.organizations[organization_id].ticket_organization_arr,
        this.data.organizations[organization_id].ticket_organization_sf_full_id,
        this.data.organizations[organization_id]
          .ticket_organization_strikedeck_health,
        this.data.organizations[organization_id].ticket_organization_sf_sitekey,
        this.data.organizations[organization_id].ticket_organization_sitekey,
        group_id,
        this.data.groups[group_id].ticket_group_name,
        brand_id,
        this.data.brands[brand_id].ticket_brand_name,
        this.data.links[jira_id].issue_project,
        this.data.links[jira_id].issue_summary,
        this.data.links[jira_id].issue_created_at,
        this.data.links[jira_id].issue_updated_at,
        this.data.links[jira_id].issue_status,
        this.data.links[jira_id].issue_status_key,
        this.data.links[jira_id].issue_priority,
        this.data.links[jira_id].issue_type,
        this.data.links[jira_id].issue_team,
        this.data.links[jira_id].issue_components,
      ];
    });

    // delete the rows that were just updated
    this.sheets.diff.deleteRows(this.rowStart, this.rowEnd);

    // append the data to the bottom of the diff sheet
    const insertRow = this.sheets.diff.getLastRow() + 1;
    this.sheets.diff
      .getRange(insertRow, 1, writeOut.length, this.lastColumn)
      .setValues(writeOut);

    return this.isLastRun; // run the diffLinks function
  }

  processResponseDataForLinks(link: ZendeskAPI.JiraLink) {
    this.data.links[link.id] = {
      link_created_at: link.created_at,
      link_updated_at: link.updated_at,
      ticket_id: link.ticket_id,
      issue_id: link.issue_id,
      issue_key: link.issue_key,
    };
  }

  processResponseDataForTickets(ticket: ZendeskAPI.Ticket) {
    this.data.tickets[ticket.id] = {
      ticket_created_at: ticket.created_at,
      ticket_updated_at: ticket.updated_at,
      ticket_status: ticket.status,
      ticket_priority: ticket.priority,
      ticket_type: ticket.type,
      ticket_subject: ticket.subject,
      ticket_problem_id: ticket.problem_id,
      ticket_organization_id: ticket.organization_id,
      ticket_group_id: ticket.group_id,
      ticket_brand_id: ticket.brand_id,
    };
    this.data.organizations[ticket.organization_id] = {};
    this.data.groups[ticket.group_id] = {};
    this.data.brands[ticket.brand_id] = {};
  }

  processResponseDataForOrganizations(organization: ZendeskAPI.Organization) {
    this.data.organizations[organization.id] = {
      ticket_organization_name: organization.name,
      ticket_organization_arr: organization.organization_fields.arr,
      ticket_organization_sf_full_id:
        organization.organization_fields.sf_full_account_id,
      ticket_organization_strikedeck_health:
        organization.organization_fields.strikedeck_health,
      ticket_organization_sf_sitekey:
        organization.organization_fields.sf_keyword,
      ticket_organization_sitekey: organization.organization_fields.sitekey,
    };
  }

  processResponseDataForGroups(group: ZendeskAPI.Group) {
    this.data.groups[group.id] = {
      ticket_group_name: group.name,
    };
  }

  processResponseDataForBrands(brand: ZendeskAPI.Brand) {
    this.data.brands[brand.id] = {
      ticket_brand_name: brand.name,
    };
  }

  processResponseDataForIssues(issue: JiraAPI.GetIssueResponse) {
    this.data.links[issue.id] = {
      issue_project: issue.fields.project.name,
      issue_summary: issue.fields.summary,
      issue_created_at: issue.fields.created,
      issue_updated_at: issue.fields.updated,
      issue_status: issue.fields.status.name,
      issue_status_key: issue.fields.status.statusCategory.key,
      issue_priority: issue.fields.priority.name,
      issue_type: issue.fields.issuetype.name,
      issue_team: issue.fields.customfield_11903,
      issue_components: issue.fields.components.map(
        (component: { name: string }) => component.name
      ),
    };
  }
}
