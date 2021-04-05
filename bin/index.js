#!/usr/bin/env node

"use strict";

const yargs = require("yargs");
const { exec } = require("child_process");

const execute = async (
  startDateString,
  endDateString,
  regexp,
  isLightweight,
  path
) => {
  if (!path) {
    throw "No path to the Git repository provided";
  }

  const startDate = Date.parse(startDateString);
  const endDate = Date.parse(endDateString);

  if (!startDate) {
    throw "Couldn't parse start-date argument";
  }

  const refOption = isLightweight ? "creatordate" : "taggerdate";
  const releaseTags = await runShellCommand(
    path,
    `git for-each-ref --format="%(refname:short) %(${refOption})" --sort="${refOption}" refs/tags`
  );

  if (!endDateString) {
    throw "Couldn't parse end-date argument";
  }

  const result = await calculateCycleTime(
    path,
    releaseTags,
    startDate,
    endDate,
    regexp
  );

  const periodStartString = new Date(startDate).toDateString();
  const periodEndString = new Date(endDate).toDateString();

  const periodString = `[${periodStartString} –– ${periodEndString}]`;
  const releasesString = `${result.numberOfReleases} release${
    result.numberOfReleases == 1 ? "" : "s"
  }`;
  const timeString = `${result.cycleTime.toFixed()} hours (${(
    result.cycleTime / 24
  ).toFixed()} days)`;

  console.log(
    `Cycle Time for ${periodString} period based on ${releasesString}: ${timeString}`
  );
};

const calculateCycleTime = async (
  path,
  tagsData,
  startDate,
  endDate,
  regexp
) => {
  const tagLines = tagsData.split("\n");
  let releaseCommits = [];
  for (let tagLine of tagLines) {
    const tagByDate = parseTagLine(tagLine);
    if (!tagByDate) {
      continue;
    }
    const { tag, date } = tagByDate;

    if (date > endDate) {
      continue;
    }

    if (tag.match(regexp)) {
      releaseCommits.push(tagByDate);
    }
  }

  let upper = releaseCommits.slice(1);
  const zippedReleases = zip(releaseCommits, upper);

  let durationsData = [];
  let numberOfReleasesInPeriod = 0;
  for (let release of zippedReleases) {
    const oldRelease = release[0];
    const currentRelease = release[1];

    if (!currentRelease || currentRelease.date < startDate) {
      continue;
    }

    const durations = await getDurationsForRelease(
      path,
      oldRelease.tag,
      currentRelease.tag,
      currentRelease.date
    );

    durationsData = durationsData.concat(durations);
    numberOfReleasesInPeriod += 1;
    const releaseCycleTime = (mean(durations) / 1000 / 60 / 60).toFixed();
    console.log(
      `[${oldRelease.tag}-${currentRelease.tag}]: ${releaseCycleTime} hour(s)`
    );
  }

  const cycleTime = mean(durationsData) / 1000 / 60 / 60;
  return {
    cycleTime: cycleTime,
    numberOfReleases: numberOfReleasesInPeriod,
  };
};

const parseTagLine = (tagLine) => {
  if (tagLine.length == 0) {
    return null;
  }

  const tag = tagLine.split(" ")[0];
  const date = Date.parse(tagLine.substring(tag.length));
  return { tag: tag, date: date };
};

const getDurationsForRelease = async (path, upstream, head, releaseDate) => {
  const commitsDiff = await getCherryForRelease(path, upstream, head);

  let commitDates = [];
  for (let cherryCommit of commitsDiff.split("\n")) {
    if (cherryCommit.startsWith("+")) {
      const commit = cherryCommit.split(" ")[1];
      const time = await getCommitTime(path, commit);
      commitDates.push(time);
    }
  }

  return commitDates.map((date) => {
    return Math.abs(releaseDate - date);
  });
};

const getCherryForRelease = async (path, upstream, head) => {
  return runShellCommand(path, `git cherry ${upstream} ${head}`);
};

const getCommitTime = async (path, sha) => {
  const stdout = await runShellCommand(
    path,
    `git log -n 1 --format=format:%cI ${sha}`
  );

  return Date.parse(stdout);
};

const runShellCommand = async (path, command) => {
  return new Promise((resolve, reject) => {
    exec(`cd ${path} && ${command}`, (err, stdout, stderr) => {
      if (err) {
        console.log(`${err}`);
        reject(err);
      }

      resolve(stdout);
    });
  });
};

const mean = (data) => {
  if (data.length == 0) {
    return NaN;
  }

  const sum = data.reduce((a, b) => {
    return a + b;
  });
  return sum / data.length;
};
const zip = (a, b) =>
  Array.from(Array(Math.max(b.length, a.length)), (_, i) => [a[i], b[i]]);

yargs.command({
  command: "run [path]",
  desc: "Calculate cycle time in your Git repository",
  builder: (yargs) => {
    yargs
      .option("start-date", {
        alias: "start",
        describe: "Start date to calculate cycle time from",
        type: "string",
        demandOption: true,
      })
      .option("end-date", {
        alias: "end",
        describe: "End date to calculate cycle time to",
        type: "string",
        default: new Date().toDateString(),
      })
      .option("regexp", {
        alias: "reg",
        describe: "Regular Experssion to match release tags",
        type: "string",
        demandOption: true,
      })
      .option("lightweight", {
        describe:
          "Calculate cycle time based on creatordate rather than taggerdate",
        type: "boolean",
        default: false,
      })
      .positional("path", {
        describe: "Path to a Git repository",
        type: "string",
        demandOption: true,
      });
  },
  handler: (argv) => {
    execute(
      argv.startDate,
      argv.endDate,
      argv.regexp,
      argv.lightweight,
      argv.path
    )
      .then()
      .catch((error) => {
        console.log(error);
      });
  },
});
yargs.argv;
