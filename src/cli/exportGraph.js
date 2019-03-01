// @flow
// Implementation of `sourcecred export-graph`.

import {Graph} from "../core/graph";
import * as NullUtil from "../util/null";
import * as RepoIdRegistry from "../core/repoIdRegistry";
import {repoIdToString, stringToRepoId, type RepoId} from "../core/repoId";
import dedent from "../util/dedent";
import type {Command} from "./command";
import * as Common from "./common";
import stringify from "json-stable-stringify";

import type {IAnalysisAdapter} from "../analysis/analysisAdapter";
import {AnalysisAdapter as GithubAnalysisAdapter} from "../plugins/github/analysisAdapter";
import {AnalysisAdapter as GitAnalysisAdapter} from "../plugins/git/analysisAdapter";

function usage(print: (string) => void): void {
  print(
    dedent`\
    usage: sourcecred export-graph REPO_ID [--help]

    Print a combined SourceCred graph for a given REPO_ID.
    Data must already be loaded for the given REPO_ID, using
    'sourcecred load REPO_ID'

    REPO_ID refers to a GitHub repository in the form OWNER/NAME: for
    example, torvalds/linux. The REPO_ID may be a "combined" repo as
    created by the --output flag to sourcecred load.

    Arguments:
        REPO_ID
            Already-loaded repository for which to load data.

        --help
            Show this help message and exit, as 'sourcecred help export-graph'.

    Environment Variables:
        SOURCECRED_DIRECTORY
            Directory owned by SourceCred, in which data, caches,
            registries, etc. are stored. Optional: defaults to a
            directory 'sourcecred' under your OS's temporary directory;
            namely:
                ${Common.defaultSourcecredDirectory()}
    `.trimRight()
  );
}

function die(std, message) {
  std.err("fatal: " + message);
  std.err("fatal: run 'sourcecred help export-graph' for help");
  return 1;
}

export function makeExportGraph(
  adapters: $ReadOnlyArray<IAnalysisAdapter>
): Command {
  return async function exportGraph(args, std) {
    let repoId: RepoId | null = null;
    if (adapters.length === 0) {
      std.err("fatal: no plugins available");
      std.err("fatal: this is likely a build error");
      return 1;
    }
    for (let i = 0; i < args.length; i++) {
      switch (args[i]) {
        case "--help": {
          usage(std.out);
          return 0;
        }
        default: {
          if (repoId != null)
            return die(std, "multiple repository IDs provided");
          // Should be a repository.
          repoId = stringToRepoId(args[i]);
          break;
        }
      }
    }

    if (repoId == null) {
      return die(std, "no repository ID provided");
    }

    const directory = Common.sourcecredDirectory();
    const registry = RepoIdRegistry.getRegistry(directory);
    if (RepoIdRegistry.getEntry(registry, repoId) == null) {
      const repoIdStr = repoIdToString(repoId);
      std.err(`fatal: repository ID ${repoIdStr} not loaded`);
      std.err(`Try running \`sourcecred load ${repoIdStr}\` first.`);
      return 1;
    }
    async function graphForAdapter(adapter: IAnalysisAdapter): Promise<Graph> {
      try {
        return await adapter.load(directory, NullUtil.get(repoId));
      } catch (e) {
        throw new Error(
          `plugin "${adapter.declaration().name}" errored: ${e.message}`
        );
      }
    }
    let graphs: Graph[];
    try {
      graphs = await Promise.all(adapters.map(graphForAdapter));
    } catch (e) {
      return die(std, e.message);
    }
    const graph = Graph.merge(graphs);
    const graphJSON = graph.toJSON();
    std.out(stringify(graphJSON));
    return 0;
  };
}

const defaultAdapters = [new GithubAnalysisAdapter(), new GitAnalysisAdapter()];

export const exportGraph = makeExportGraph(defaultAdapters);

export const help: Command = async (args, std) => {
  if (args.length === 0) {
    usage(std.out);
    return 0;
  } else {
    usage(std.err);
    return 1;
  }
};

export default exportGraph;