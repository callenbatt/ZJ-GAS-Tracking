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
  row: string;

  constructor() {
    this.SSID = "";
    this.sheets = {
      main: SpreadsheetApp.openById(this.SSID).getSheetByName("main"),
      diff: SpreadsheetApp.openById(this.SSID).getSheetByName("diff"),
      changelog: SpreadsheetApp.openById(this.SSID).getSheetByName("changelog"),
      archive: SpreadsheetApp.openById(this.SSID).getSheetByName("archive"),
    };
    this.task = PropertiesService.getScriptProperties().getProperty("TASK");
    this.row =
      PropertiesService.getScriptProperties().getProperty("ROW") || "0";
  }

  run() {
    // we want to run a trigger ever 24 hours, which will
    // - create a trigger ever 5 minutes,
    // - run the main function through various subfunctions until all updates are complete
    // - delete the trigger.
    switch (this.task) {
      // every 24 hours, start the operations if the task is idle
      case "IDLE":
        this.initFetchNewLinks();
        break;
      // every 5 minutes, continue the operations if the task is running
      case "RUNNING":
        this.initUpdateExistingLinks();
        break;
      // on the next trigger after the updates are complete, diff the links and update the changelog
      case "DIFF":
        this.initDiffLinks();
        break;
    }
  }

  initFetchNewLinks() {
    try {
      this.createContinueOperationsTrigger();
      new GetLinks().run();
      PropertiesService.getScriptProperties().setProperty("TASK", "RUNNING");
    } catch (e) {
      console.error(e);
    }
  }

  initUpdateExistingLinks() {
    try {
      const newRow = new UpdateLinks().runUpdate(this.row);

      PropertiesService.getScriptProperties().setProperty("ROW", newRow);

      if (newRow === "0") {
        PropertiesService.getScriptProperties().setProperty("TASK", "DIFF");
      }
    } catch (e) {
      console.error(e);
    }
  }

  initDiffLinks() {
    try {
      new DiffLinks().run();
      PropertiesService.getScriptProperties().setProperty("TASK", "IDLE");
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
}

class DiffLinks extends Operations {
  constructor() {
    super();
  }

  runDiff() {
    // run the diffLinks function
  }
}

class GetLinks extends Operations {
  constructor() {
    super();
  }

  runGet() {
    // run the diffLinks function
  }
}

class UpdateLinks extends Operations {
  constructor() {
    super();
  }

  runUpdate(row: string) {
    return "0"; // run the diffLinks function
  }
}
