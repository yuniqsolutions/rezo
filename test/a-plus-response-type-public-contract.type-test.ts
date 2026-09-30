// responseType PUBLIC TYPE contract (DECISION-063 C, carrier 6).
//
// Compile-only carrier: never executed by vitest (the filename ends in
// `-test.ts`, not `.test.ts`) and not part of the `src/**` typecheck program,
// so a RED here cannot mask the repository typecheck gate. It is verified by
// its own standalone invocation, recorded in the RED manifest:
//
//   npx tsc --ignoreConfig --noEmit --strict --skipLibCheck \
//     --ignoreDeprecations 6.0 --target esnext --module esnext \
//     --moduleResolution node --esModuleInterop --resolveJsonModule \
//     --types node,bun,deno \
//     test/a-plus-response-type-public-contract.type-test.ts
//
// Every assertion is written against a REAL public call site — what a
// consumer actually types — rather than an internal resolved config shape,
// so a failure always names a public-contract defect. Two authentic RED
// shapes: an unused `@ts-expect-error` (the invalid value is still accepted)
// and a failing `Assert<Equal<...>>` (a declared return/union does not match
// the ruled contract).
import type { Rezo } from '../src/core/rezo';
import type { RezoDefaultOptions } from '../src/types/options';
import type { RezoConfig } from '../src/types/rezo-config';
import type {
  RezoResponse,
  RezoStreamResponse,
  RezoDownloadResponse,
  RezoUploadResponse,
} from '../src/types/response';

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? true
    : false;
type Assert<Value extends true> = Value;

declare const client: Rezo;
const URL_UNDER_TEST = 'https://example.invalid/response-type';

/* ------------------------------------------------------------------------ *
 * TY-00 CONTROL — must compile on today's bytes. If this row ever fails, the
 * imports or the public entry moved and every row below is uninterpretable.
 * ------------------------------------------------------------------------ */
const controlJson = client.get(URL_UNDER_TEST, { responseType: 'json' });
const controlText = client.get(URL_UNDER_TEST, { responseType: 'text' });
const controlBare = client.get(URL_UNDER_TEST);
void controlJson; void controlText; void controlBare;

/* ------------------------------------------------------------------------ *
 * TY-01 — all 11 accepted request tokens compile at a public call site.
 * Today `arraybuffer` and `binary` are absent from `RezoResponseType`, so
 * those two lines are authentic RED.
 * ------------------------------------------------------------------------ */
void client.get(URL_UNDER_TEST, { responseType: 'auto' });
void client.get(URL_UNDER_TEST, { responseType: 'json' });
void client.get(URL_UNDER_TEST, { responseType: 'text' });
void client.get(URL_UNDER_TEST, { responseType: 'blob' });
void client.get(URL_UNDER_TEST, { responseType: 'arrayBuffer' });
void client.get(URL_UNDER_TEST, { responseType: 'arraybuffer' });
void client.get(URL_UNDER_TEST, { responseType: 'buffer' });
void client.get(URL_UNDER_TEST, { responseType: 'binary' });
void client.get(URL_UNDER_TEST, { responseType: 'stream' });
void client.get(URL_UNDER_TEST, { responseType: 'download' });
void client.get(URL_UNDER_TEST, { responseType: 'upload' });

/* ------------------------------------------------------------------------ *
 * TY-02 — invalid and miscased literals are rejected at the call site.
 * Today each marker is UNUSED, which is the authentic RED.
 * ------------------------------------------------------------------------ */
// @ts-expect-error unknown token
void client.get(URL_UNDER_TEST, { responseType: 'bogus' });
// @ts-expect-error miscased buffered token
void client.get(URL_UNDER_TEST, { responseType: 'JSON' });
// @ts-expect-error miscased facade token
void client.get(URL_UNDER_TEST, { responseType: 'STREAM' });
// @ts-expect-error whitespace-padded token
void client.get(URL_UNDER_TEST, { responseType: 'json ' });
// @ts-expect-error non-string value
void client.get(URL_UNDER_TEST, { responseType: 5 });
// @ts-expect-error null is not "not supplied"
void client.get(URL_UNDER_TEST, { responseType: null });

/* ------------------------------------------------------------------------ *
 * TY-03 — instance defaults accept only the 8 buffered inputs. A facade
 * default is ill-formed: a targetless default download cannot be honored.
 * ------------------------------------------------------------------------ */
const acceptedDefaults: RezoDefaultOptions[] = [
  { responseType: 'auto' },
  { responseType: 'json' },
  { responseType: 'text' },
  { responseType: 'blob' },
  { responseType: 'arrayBuffer' },
  { responseType: 'arraybuffer' },
  { responseType: 'buffer' },
  { responseType: 'binary' },
];
void acceptedDefaults;

const rejectedDefaults: RezoDefaultOptions[] = [
  // @ts-expect-error facade tokens are not valid instance defaults
  { responseType: 'stream' },
  // @ts-expect-error facade tokens are not valid instance defaults
  { responseType: 'download' },
  // @ts-expect-error facade tokens are not valid instance defaults
  { responseType: 'upload' },
  // @ts-expect-error miscased default
  { responseType: 'JSON' },
];
void rejectedDefaults;

/* ------------------------------------------------------------------------ *
 * TY-04 — effective `RezoConfig.responseType` records exactly the 9 canonical
 * modes: aliases never survive intake, and `auto` is a real recorded mode.
 * ------------------------------------------------------------------------ */
type EffectiveResponseType = NonNullable<RezoConfig['responseType']>;
type CanonicalModes =
  | 'auto' | 'json' | 'text' | 'blob' | 'arrayBuffer' | 'buffer'
  | 'stream' | 'download' | 'upload';
type EffectiveIsCanonical = Assert<Equal<EffectiveResponseType, CanonicalModes>>;
declare const effectiveIsCanonical: EffectiveIsCanonical;
void effectiveIsCanonical;

/* ------------------------------------------------------------------------ *
 * TY-05 — every ORDINARY facade-selecting call is Promise-shaped. The runtime
 * has always returned a Promise; the declarations claim otherwise on exactly
 * 22 PUT/PATCH rows (11 + 11) plus the adjacent download rows.
 * ------------------------------------------------------------------------ */
const putStream = client.put(URL_UNDER_TEST, {}, { responseType: 'stream' });
type PutStreamIsPromise = Assert<Equal<typeof putStream, Promise<RezoStreamResponse>>>;
declare const putStreamIsPromise: PutStreamIsPromise;
void putStreamIsPromise;

const putDownload = client.put(URL_UNDER_TEST, {}, { responseType: 'download' });
type PutDownloadIsPromise = Assert<Equal<typeof putDownload, Promise<RezoDownloadResponse>>>;
declare const putDownloadIsPromise: PutDownloadIsPromise;
void putDownloadIsPromise;

const patchStream = client.patch(URL_UNDER_TEST, {}, { responseType: 'stream' });
type PatchStreamIsPromise = Assert<Equal<typeof patchStream, Promise<RezoStreamResponse>>>;
declare const patchStreamIsPromise: PatchStreamIsPromise;
void patchStreamIsPromise;

const patchUpload = client.patch(URL_UNDER_TEST, {}, { responseType: 'upload' });
type PatchUploadIsPromise = Assert<Equal<typeof patchUpload, Promise<RezoUploadResponse>>>;
declare const patchUploadIsPromise: PatchUploadIsPromise;
void patchUploadIsPromise;

/* ------------------------------------------------------------------------ *
 * TY-06 — the one response-data generic axis. `buffer`/`binary` resolve to
 * `Buffer | ArrayBuffer` on every entry, because Fetch/XHR/React Native
 * cannot honestly promise a Node `Buffer`.
 * ------------------------------------------------------------------------ */
const getText = client.get(URL_UNDER_TEST, { responseType: 'text' });
type GetTextIsString = Assert<Equal<typeof getText, Promise<RezoResponse<string>>>>;
declare const getTextIsString: GetTextIsString;
void getTextIsString;

const getBuffer = client.get(URL_UNDER_TEST, { responseType: 'buffer' });
type GetBufferIsUnion = Assert<Equal<typeof getBuffer, Promise<RezoResponse<Buffer | ArrayBuffer>>>>;
declare const getBufferIsUnion: GetBufferIsUnion;
void getBufferIsUnion;

/* ------------------------------------------------------------------------ *
 * TY-07 — one DefaultData axis. An instance carries its own default response
 * data type, so a consumer states it once instead of on every call.
 * ------------------------------------------------------------------------ */
interface User { id: string; name: string }
declare const typedClient: Rezo<User>;

const typedGet = typedClient.get(URL_UNDER_TEST);
type TypedGetUsesDefault = Assert<Equal<typeof typedGet, Promise<RezoResponse<User>>>>;
declare const typedGetUsesDefault: TypedGetUsesDefault;
void typedGetUsesDefault;

const typedDelete = typedClient.delete(URL_UNDER_TEST);
type TypedDeleteUsesDefault = Assert<Equal<typeof typedDelete, Promise<RezoResponse<User>>>>;
declare const typedDeleteUsesDefault: TypedDeleteUsesDefault;
void typedDeleteUsesDefault;

/* ------------------------------------------------------------------------ *
 * TY-08 — a per-call generic still wins over the instance default, and a
 * fixed mode still wins over both: the axis adds a default, never a ceiling.
 * ------------------------------------------------------------------------ */
const perCallWins = typedClient.get<{ different: true }>(URL_UNDER_TEST);
type PerCallWins = Assert<Equal<typeof perCallWins, Promise<RezoResponse<{ different: true }>>>>;
declare const perCallWins2: PerCallWins;
void perCallWins2;

const fixedModeWins = typedClient.get(URL_UNDER_TEST, { responseType: 'blob' });
type FixedModeWins = Assert<Equal<typeof fixedModeWins, Promise<RezoResponse<Blob>>>>;
declare const fixedModeWins2: FixedModeWins;
void fixedModeWins2;

/* ------------------------------------------------------------------------ *
 * TY-09 CONTROL — source compatibility. A bare `Rezo` keeps today's `any`
 * default, so every existing call site and every explicit per-call generic
 * compiles exactly as before. If this row ever fails, the axis was a breaking
 * change rather than an additive one.
 * ------------------------------------------------------------------------ */
const bareStillAny = client.get(URL_UNDER_TEST);
type BareStillAny = Assert<Equal<typeof bareStillAny, Promise<RezoResponse<any>>>>;
declare const bareStillAny2: BareStillAny;
void bareStillAny2;

const bareExplicitGeneric = client.get<User>(URL_UNDER_TEST);
type BareExplicitGeneric = Assert<Equal<typeof bareExplicitGeneric, Promise<RezoResponse<User>>>>;
declare const bareExplicitGeneric2: BareExplicitGeneric;
void bareExplicitGeneric2;
