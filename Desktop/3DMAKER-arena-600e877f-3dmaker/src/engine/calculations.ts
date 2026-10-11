import { executePlan, type AssistantPlan } from "../services/assistantPlan";
import type {
  GeometryData,
  SceneNode,
  Vec3,
  SceneDocument,
  EditMode,
} from "../types";
import {
  bevel,
  extrude,
  subdivide,
  decimate,
  mirror,
  latheGeometry,
  sweepGeometry,
  spinGeometry,
  booleanOperation,
} from "./geometry";
export type MeshOperation =
  | "extrude"
  | "bevel"
  | "subdivide"
  | "decimate"
  | "mirror"
  | "lathe"
  | "sweep"
  | "spin";
export interface MeshOptions {
  amount?: number;
  faces?: number[];
  iterations?: number;
  smooth?: boolean;
  ratio?: number;
  axis?: "x" | "y" | "z";
  combine?: boolean;
  segments?: number;
  angle?: number;
  path?: Vec3[];
  center?: Vec3;
}
export type GeometryJob =
  | {
      type: "mesh";
      operation: MeshOperation;
      data: GeometryData;
      options: MeshOptions;
    }
  | {
      type: "assistant";
      document: SceneDocument;
      selection: string[];
      plan: AssistantPlan;
      context?: { mode: EditMode; components: number[] };
    }
  | {
      type: "boolean";
      a: SceneNode;
      b: SceneNode;
      operation: "union" | "difference" | "intersection";
    };
export interface AssistantJobResult {
  document: SceneDocument;
  selection: string[];
  unchangedIds: string[];
  sameGeometryIds: string[];
}
export async function calculateJob(
  job: GeometryJob,
): Promise<GeometryData | SceneNode | AssistantJobResult> {
  if (job.type === "assistant") {
    const original = new Map(job.document.nodes.map((n) => [n.id, n])),
      result = executePlan(job.document, job.selection, job.plan, job.context);
    return {
      ...result,
      unchangedIds: result.document.nodes
        .filter((n) => n === original.get(n.id))
        .map((n) => n.id),
      sameGeometryIds: result.document.nodes
        .filter(
          (n) =>
            original.has(n.id) && n.geometry === original.get(n.id)?.geometry,
        )
        .map((n) => n.id),
    };
  }
  if (job.type === "boolean")
    return booleanOperation(job.a, job.b, job.operation);
  const { data, operation, options: o } = job;
  switch (operation) {
    case "extrude":
      return extrude(data, o.faces || [], o.amount ?? 0.3);
    case "bevel":
      return bevel(data, o.amount ?? 0.1);
    case "subdivide":
      return subdivide(data, o.iterations ?? 1, o.smooth ?? true);
    case "decimate":
      return decimate(data, o.ratio ?? 0.5);
    case "mirror":
      return mirror(data, o.axis ?? "x", o.combine ?? true);
    case "spin":
      return spinGeometry(
        data,
        o.faces || [],
        o.axis ?? "y",
        o.center || [0, 0, 0],
        o.segments ?? 48,
        o.angle ?? Math.PI * 2,
      );
    case "lathe":
      return latheGeometry(data, o.segments ?? 48, o.angle ?? Math.PI * 2);
    case "sweep":
      return sweepGeometry(
        data,
        o.path || [
          [0, 0, 0],
          [0, 1, 2],
        ],
        o.segments ?? 48,
      );
  }
}
