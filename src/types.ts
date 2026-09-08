export type PointInput = number[] | ArrayLike<number> | ReadonlyArray<ReadonlyArray<number>>;
export type ValueInput = ArrayLike<number>;
export type ScalarOrVector = number | ArrayLike<number>;
export type SizeInput = number | ReadonlyArray<number>;

export type Tuple1DWithValue = [number, number];
export type Tuple2DWithValue = [number, number, number];
export type Tuple3DWithValue = [number, number, number, number];
export type TupleWithValue = Tuple1DWithValue | Tuple2DWithValue | Tuple3DWithValue;
