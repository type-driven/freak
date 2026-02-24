import { Data } from "effect";

export class KvError extends Data.TaggedError("KvError")<{
  readonly message: string;
}> {}

export class NotFoundError extends Data.TaggedError("NotFoundError")<{
  readonly id: string;
}> {}
