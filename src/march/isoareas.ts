import type { Position } from "geojson";
import type { PolylinesWithLevels } from "./types";
import { getIsolineThreshold } from "./helpers";

type IsoareaOptions = {};

export function generateIsoareas(polylines: PolylinesWithLevels, boundaries: Position[][], options: IsoareaOptions) {
  // close any open polylines using the exterior border line segments that they intersect with and flag the resulting polygons as having touched the boundary for later cleanup
  // determine containment of each polyline within the others
  // build a topology tree to establish the parent-child(ren) relationship
  // compute polygons using the parent-child(ren) relationship and ensure that the child polylines are in the correct winding order
  // walk any boundary-touching-flagged polygons' rings and remove line segments that are shared between interior and exterior rings
}
