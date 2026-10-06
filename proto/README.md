# Chronicle event schema

`chronicle.proto` is a documentation snapshot of Chronicle's canonical event schema:

- Canonical source: `api/chronicleproto/chronicle.proto` in `Emyrk/chronicle`
- Generated TypeScript snapshot: `src/generated/chronicle_pb.ts`
- Wire framing documentation and decoder: `src/sdk/stream.ts`

When Chronicle changes the schema used by `chronicle-event-stream-v1`, update both snapshots and rebuild. The generated TypeScript file comes from Chronicle's `protoc-gen-es` configuration in `api/chronicleproto/buf.gen.yaml`.
