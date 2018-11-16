// @flow

import {type Edge, Graph, NodeAddress, type NodeAddressT} from "../core/graph";
import {
  distributionToNodeDistribution,
  createConnections,
  createOrderedSparseMarkovChain,
  type EdgeWeight,
  createWeightedGraph,
  type WeightedGraph,
} from "../core/attribution/graphToMarkovChain";
import {
  decompose,
  type PagerankNodeDecomposition,
} from "./pagerankNodeDecomposition";

import {scoreByConstantTotal} from "./nodeScore";

import {findStationaryDistribution} from "../core/attribution/markovChain";

export type {NodeDistribution} from "../core/attribution/graphToMarkovChain";
export type {PagerankNodeDecomposition} from "./pagerankNodeDecomposition";
export type PagerankOptions = {|
  +selfLoopWeight?: number,
  +verbose?: boolean,
  +convergenceThreshold?: number,
  +maxIterations?: number,
  // Scores will be normalized so that scores sum to totalScore
  +totalScore?: number,
  // Only nodes matching this prefix will count for normalization
  +totalScoreNodePrefix?: NodeAddressT,
|};

export type {EdgeWeight} from "../core/attribution/graphToMarkovChain";
export type EdgeEvaluator = (Edge) => EdgeWeight;

export type PagerankResult = {|
  +weightedGraph: WeightedGraph,
  +nodeScores: Map<NodeAddressT, number>,
|};

function defaultOptions(): PagerankOptions {
  return {
    verbose: false,
    selfLoopWeight: 1e-3,
    convergenceThreshold: 1e-7,
    maxIterations: 255,
    totalScore: 1000,
    totalScoreNodePrefix: NodeAddress.empty,
  };
}

export async function pagerank(
  graph: Graph,
  edgeWeight: EdgeEvaluator,
  options?: PagerankOptions
): Promise<PagerankNodeDecomposition> {
  const fullOptions = {
    ...defaultOptions(),
    ...(options || {}),
  };
  const weightedGraph = createWeightedGraph(
    graph,
    edgeWeight,
    fullOptions.selfLoopWeight
  );
  const connections = createConnections(weightedGraph);
  const osmc = createOrderedSparseMarkovChain(connections);
  const distribution = await findStationaryDistribution(osmc.chain, {
    verbose: fullOptions.verbose,
    convergenceThreshold: fullOptions.convergenceThreshold,
    maxIterations: fullOptions.maxIterations,
    yieldAfterMs: 30,
  });
  const pi = distributionToNodeDistribution(osmc.nodeOrder, distribution);
  const scores = scoreByConstantTotal(
    pi,
    fullOptions.totalScore,
    fullOptions.totalScoreNodePrefix
  );
  const pnd = decompose(scores, connections);
}
