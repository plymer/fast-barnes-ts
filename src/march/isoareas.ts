/*
 * This file contains functions and types related to computing isoareas
 * for scalar fields using the marching squares algorithm. We use use isolines
 * as the basis for our polygons.
 * 
 * In general we have 5 cases:

    A closed polyline with no interior geometries (i.e a 1000 hPa line surrounding a 998 hPa low)
    A closed polyline with at least one interior geometry (i.e. a 1000 hPa line with a 996 hPa line inside of it)
    An open polyline that touches the edge of the data domain with no interior geometries (i.e. a 1000 hPa line over the eastern Pacific that may or may not contain an extrema)
    An open polyline that touches the edge of the data domain with at least one interior geometry, with none of the interior geometries touching the edge of the data domain
    An open polyline that touches the edge of the data domain with at least one open interior geometry, with at least one of those open interior geometries touching the edge of the data domain

The general approach is:

    Ensure that we have computed all polylines and the line(s) that represent the data field boundary (both the exterior border and any interior holes) and enforce a consistent winding order
    Close any open polylines using the exterior border line segments that they intersect with and flag the resulting polygons as having touched the boundary for later cleanup
    Determine containment of each polyline within the others
    Build a topology tree to establish the parent-child(ren) relationship
    Compute polygons using the parent-child(ren) relationship and invert the child polyline winding order
    Walk any boundary-touching-flagged polygons' rings and remove line segments that are shared between exterior and interior rings

 * 
 */

import type { generateMarchedIsolines } from "./isolines";

type IsoareaOptions = {};

export function generateIsoareas(isolines: ReturnType<typeof generateMarchedIsolines>, options: IsoareaOptions) {
  const { polylines, polylineLevelIndex, levelValues, boundaryPolylines } = isolines;
}
