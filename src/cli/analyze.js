// @flow
// Implementation of `sourcecred analyze`

import pako from "pako";
import fs from "fs";
import stringify from "json-stable-stringify";
import path from "path";
import {stringToRepoId, repoIdToString, type RepoId} from "../core/repoId";
import dedent from "../util/dedent";
import type {Command} from "./command";
import * as Common from "./common";
import {
  type PagerankOptions,
  pagerank,
  type PagerankNodeDecomposition,
} from "../analysis/pagerank";
import {Graph, type EdgeAddressT} from "../core/graph";
import type {IAnalysisAdapter} from "../analysis/analysisAdapter";
import {toJSON as pndToJSON} from "../analysis/pagerankNodeDecomposition";
import {
  defaultWeightsForDeclaration,
  combineWeights,
} from "../analysis/weights";
import {weightsToEdgeEvaluator} from "../analysis/weightsToEdgeEvaluator";
import {Prefix as GithubPrefix} from "../plugins/github/nodes";
import {AnalysisAdapter as GithubAnalysisAdapter} from "../plugins/github/analysisAdapter";
import {AnalysisAdapter as GitAnalysisAdapter} from "../plugins/git/analysisAdapter";
import {type NodeScore} from "../analysis/nodeScore";
import type {EdgeWeight} from "../core/attribution/graphToMarkovChain";
import * as MapUtil from "../util/map";

type AnalysisResult = {|
  +graph: Graph,
  +pagerankNodeDecomposition: PagerankNodeDecomposition,
  +scores: NodeScore,
  +edgeWeightsMap: Map<EdgeAddressT, EdgeWeight>,
|};

function defaultAdapters(): IAnalysisAdapter[] {
  return [new GithubAnalysisAdapter(), new GitAnalysisAdapter()];
}

function usage(print: (string) => void): void {
  print(
    dedent`\
    usage: sourcecred analyze REPO_ID
           sourcecred analyze --help

    Analyze a loaded repository, generating a cred attribution for it.

    REPO_ID refers to a GitHub repository in the form OWNER/NAME: for
    example, torvalds/linux. The REPO_ID may be an 'aggregated
    repository' generated via the \`--output\` flag to \`sourcecred
    load\`

    Arguments:
        REPO_ID
            Repository to analyze

        --help
            Show this help message and exit, as 'sourcecred help analyze'.

    Environment variables:
        SOURCECRED_DIRECTORY
            Directory owned by SourceCred, in which data, caches,
            registries, etc. are stored. Optional: defaults to a
            directory 'sourcecred' under your OS's temporary directory;
            namely:
                ${Common.defaultSourcecredDirectory()}
    `.trimRight()
  );
}

export async function analyze(
  repoId: RepoId,
  sourcecredDirectory: string,
  adapters: $ReadOnlyArray<IAnalysisAdapter>,
  pagerankOptions: PagerankOptions
): Promise<AnalysisResult> {
  function load(x: IAnalysisAdapter): Promise<Graph> {
    return x.load(sourcecredDirectory, repoId);
  }
  const graph = await Promise.all(adapters.map(load)).then(Graph.merge);
  // TODO: Add support for using customized weights (#945)
  const weights = combineWeights(
    adapters.map((x) => defaultWeightsForDeclaration(x.declaration()))
  );
  const evaluator = weightsToEdgeEvaluator(weights);
  const {pnd, scores, edgeWeightsMap} = await pagerank(
    graph,
    evaluator,
    pagerankOptions
  );
  return {graph, pagerankNodeDecomposition: pnd, scores, edgeWeightsMap};
}

function die(std, message) {
  std.err("fatal: " + message);
  std.err("fatal: run 'sourcecred help analyze' for help");
  return 1;
}

type Size = {|+compressed: number, +uncompressed: number|};
const analyzeCommand: Command = async (args, std) => {
  let repoId: RepoId | null = null;
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--help": {
        usage(std.out);
        return 0;
      }
      default: {
        // Should be a repository
        if (repoId != null) {
          return die(std, "multiple repositories provided");
        }
        repoId = stringToRepoId(args[i]);
        break;
      }
    }
  }
  if (repoId == null) {
    return die(std, "repository not specified");
  }

  const outputDirectory = path.join(
    Common.sourcecredDirectory(),
    "data",
    repoIdToString(repoId)
  );
  function writeAndMeasureFile(fileName, contents): Size {
    const uncompressedPath = path.join(outputDirectory, fileName + ".json");
    const compressedPath = path.join(outputDirectory, fileName + ".json.gz");
    const json = stringify(contents);
    const gzip = pako.gzip(json);
    fs.writeFileSync(uncompressedPath, json);
    fs.writeFileSync(compressedPath, gzip);
    const uncompressedSize = fs.statSync(uncompressedPath).size;
    const compressedSize = fs.statSync(compressedPath).size;
    return {uncompressed: uncompressedSize, compressed: compressedSize};
  }

  const pagerankOptions = {totalScoreNodePrefix: GithubPrefix.user};
  const {
    graph,
    pagerankNodeDecomposition,
    scores,
    edgeWeightsMap,
  } = await analyze(
    repoId,
    Common.sourcecredDirectory(),
    defaultAdapters(),
    pagerankOptions
  );
  const graphSize = writeAndMeasureFile("graph", graph.toJSON());
  const pndSize = writeAndMeasureFile(
    "pagerankNodeDecomposition",
    pndToJSON(pagerankNodeDecomposition)
  );

  const scoresArray = Array.from(scores.values());
  const weightsArray = Array.from(edgeWeightsMap.values());
  const scoresObjectSize = writeAndMeasureFile(
    "nodeAddressToScoreObject",
    MapUtil.toObject(scores)
  );
  const scoresArraySize = writeAndMeasureFile(
    "unsortedNodeScoreArray",
    scoresArray
  );
  const edgeWeightObjectSize = writeAndMeasureFile(
    "edgeAddressToEdgeWeightObject",
    MapUtil.toObject(edgeWeightsMap)
  );
  const edgeWeightArraySize = writeAndMeasureFile(
    "unsortedEdgeWeightArray",
    weightsArray
  );

  function combineSizes(sizes: $ReadOnlyArray<Size>): Size {
    let uncompressed = 0;
    let compressed = 0;
    for (const size of sizes) {
      uncompressed += size.uncompressed;
      compressed += size.compressed;
    }
    return {
      uncompressed,
      compressed,
    };
  }

  const objectSize = combineSizes([
    graphSize,
    edgeWeightObjectSize,
    scoresObjectSize,
  ]);
  const optimalSize = combineSizes([
    graphSize,
    edgeWeightArraySize,
    scoresArraySize,
  ]);
  function formatSize(n: number) {
    return `${(n / 1000000).toFixed(1)}M`;
  }
  console.log(
    `| Name | Uncompressed | Compressed | Uncompressed/Optimal | Compressed/Optimal |`
  );
  console.log(`| --- | --- | --- | --- | --- |`);
  function reportResultRow(name, size) {
    const uncompressedMultiple = size.uncompressed / optimalSize.uncompressed;
    const compressedMultiple = size.compressed / optimalSize.compressed;
    console.log(
      `${name} | ${formatSize(size.uncompressed)} | ${formatSize(
        size.compressed
      )} | ${uncompressedMultiple.toFixed(2)}x | ${compressedMultiple.toFixed(
        2
      )}x`
    );
  }
  reportResultRow("pND", pndSize);
  reportResultRow("easy", objectSize);
  reportResultRow("optimal", optimalSize);
  return 0;
};

export const help: Command = async (args, std) => {
  if (args.length === 0) {
    usage(std.out);
    return 0;
  } else {
    usage(std.err);
    return 1;
  }
};

export default analyzeCommand;
