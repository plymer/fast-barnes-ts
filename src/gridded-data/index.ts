import type { ScalarField } from "../march/types";

export class GriddedData {
  field: ScalarField;
  constructor(field: ScalarField) {
    this.field = field;
  }
}
