export type GridExtremaKind = "max" | "min";

export type GridExtremaPoint2D = {
  kind: GridExtremaKind;
  value: number;
  prominence: number;
  gridIndex: number;
  i: number; // grid-space x coordinate
  j: number; // grid-space y coordinate
  x: number; // data-space x coordinate (project to geo coords)
  y: number; // data-space y coordinate (project to geo coords)
};

export interface GridExtremaOptions2D {
  radius?: number;
  minSeparation?: number;
  minProminence?: number;
  maxCountPerKind?: number;
}
