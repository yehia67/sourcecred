// @flow

import {run} from "./testUtil";
import analyzeCommand, {help} from "./analyze";

describe("cli/analyze", () => {
  describe("'help' command", () => {
    it("prints usage when given no arguments", async () => {
      expect(await run(help, [])).toEqual({
        exitCode: 0,
        stdout: expect.arrayContaining([
          expect.stringMatching(/^usage: sourcecred analyze/),
        ]),
        stderr: [],
      });
    });
    it("fails when given arguments", async () => {
      expect(await run(help, ["foo/bar"])).toEqual({
        exitCode: 1,
        stdout: [],
        stderr: expect.arrayContaining([
          expect.stringMatching(/^usage: sourcecred analyze/),
        ]),
      });
    });
  });

  describe("'analyze' command", () => {
    it("prints usage with '--help'", async () => {
      expect(await run(analyzeCommand, ["--help"])).toEqual({
        exitCode: 0,
        stdout: expect.arrayContaining([
          expect.stringMatching(/^usage: sourcecred analyze/),
        ]),
        stderr: [],
      });
    });

    it("errors if no repository is specified", async () => {
      expect(await run(analyzeCommand, [])).toEqual({
        exitCode: 1,
        stdout: [],
        stderr: [
          "fatal: repository not specified",
          "fatal: run 'sourcecred help analyze' for help",
        ],
      });
    });

    it("errors if multiple repositories are specified", async () => {
      expect(await run(analyzeCommand, ["foo/bar", "zoink/zod"])).toEqual({
        exitCode: 1,
        stdout: [],
        stderr: [
          "fatal: multiple repositories provided",
          "fatal: run 'sourcecred help analyze' for help",
        ],
      });
    });

    it("errors if provided a invalid repository", async () => {
      expect(await run(analyzeCommand, ["--zoomzoom"])).toEqual({
        exitCode: 1,
        stdout: [],
        stderr: [
          expect.stringContaining("Error: Invalid repo string: --zoomzoom"),
        ],
      });
    });

    it("prints a not-yet-implemented message for a valid repo", async () => {
      expect(await run(analyzeCommand, ["sourcecred/example-github"])).toEqual({
        exitCode: 0,
        stdout: [
          "would analyze sourcecred/example-github, but not yet implemented",
        ],
        stderr: [],
      });
    });
  });
});
