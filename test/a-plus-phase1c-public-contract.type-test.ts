import type { OutgoingHttpHeaders } from 'node:http';
import type {
  BeforeRedirectContext,
  BeforeRedirectHook,
  RezoHooks,
} from '../src/core/hooks';
import {
  RezoErrorCode,
  type RezoErrorCodeString,
} from '../src/errors/rezo-error';
import type { RezoConfig } from '../src/types/rezo-config';
import type { RezoDefaultOptions } from '../src/types/options';
import type { RezoResponse } from '../src/types/response';
import type {
  OnRedirectOptions,
  OnRedirectResponse,
  RezoRequestConfig,
} from '../src/types/rezo-request';
import type { RezoHeaders } from '../src/utils/headers';

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? true
    : false;
type Assert<Value extends true> = Value;

interface ExpectedOnRedirectOptions {
  url: URL;
  status: number;
  headers: RezoHeaders;
  sameDomain: boolean;
  method: string;
  // Public compatibility pin: the existing callback body is intentionally any.
  body?: any;
}
type ExpectedRedirectDecision =
  | { redirect: false; message?: string }
  | {
      redirect: true;
      url: string;
      method?: 'POST' | 'GET' | 'PUT' | 'DELETE' | 'PATCH' | 'OPTIONS';
      // Public compatibility pin: the existing callback body is intentionally any.
      body?: any;
      withoutBody?: boolean;
      setHeaders?: RezoHeaders | OutgoingHttpHeaders;
      setHeadersOnRedirects?: RezoHeaders | OutgoingHttpHeaders;
    };
type ExpectedOnRedirectResponse =
  | boolean
  | ExpectedRedirectDecision
  | undefined;
type ExpectedRedirectCallback = (
  options: ExpectedOnRedirectOptions,
) => ExpectedOnRedirectResponse;
type ExpectedBeforeRedirectHook = (
  context: BeforeRedirectContext,
  config: RezoConfig,
  response: RezoResponse,
) => void | Promise<void>;
type RedirectFollowDecision = Extract<
  Exclude<OnRedirectResponse, boolean | undefined>,
  { redirect: true }
>;

type _OnRedirectOptionsShape = Assert<Equal<
  OnRedirectOptions,
  ExpectedOnRedirectOptions
>>;
type _OnRedirectResponseShape = Assert<Equal<
  OnRedirectResponse,
  ExpectedOnRedirectResponse
>>;

type _BeforeRedirectSignature = Assert<Equal<
  NonNullable<RezoRequestConfig['beforeRedirect']>,
  ExpectedRedirectCallback
>>;
type _OnRedirectSignature = Assert<Equal<
  NonNullable<RezoRequestConfig['onRedirect']>,
  ExpectedRedirectCallback
>>;
type _DefaultBeforeRedirectAlias = Assert<Equal<
  RezoDefaultOptions['beforeRedirect'],
  RezoRequestConfig['beforeRedirect']
>>;
type _DefaultOnRedirectAlias = Assert<Equal<
  RezoDefaultOptions['onRedirect'],
  RezoRequestConfig['onRedirect']
>>;
type _PreparedBeforeRedirectAlias = Assert<Equal<
  RezoConfig['beforeRedirect'],
  RezoRequestConfig['beforeRedirect']
>>;
type _PreparedOnRedirectAlias = Assert<Equal<
  RezoConfig['onRedirect'],
  RezoRequestConfig['onRedirect']
>>;
type _HookCarrier = Assert<Equal<
  NonNullable<NonNullable<RezoRequestConfig['hooks']>['beforeRedirect']>,
  ExpectedBeforeRedirectHook[]
>>;
type _HookDefinition = Assert<Equal<
  BeforeRedirectHook,
  ExpectedBeforeRedirectHook
>>;
type _HookCollection = Assert<Equal<
  RezoHooks['beforeRedirect'],
  ExpectedBeforeRedirectHook[]
>>;
type _RedirectOptionKeys = Assert<Equal<
  keyof OnRedirectOptions,
  'url' | 'status' | 'headers' | 'sameDomain' | 'method' | 'body'
>>;
type _SetHeadersCarrier = Assert<Equal<
  RedirectFollowDecision['setHeaders'],
  RezoHeaders | OutgoingHttpHeaders | undefined
>>;
type _PersistentHeadersCarrier = Assert<Equal<
  RedirectFollowDecision['setHeadersOnRedirects'],
  RezoHeaders | OutgoingHttpHeaders | undefined
>>;

const approvedCode: RezoErrorCodeString = RezoErrorCode.UNSUPPORTED_CAPABILITY;
const futureExtensionCode: RezoErrorCodeString = 'REZ_FUTURE_EXTENSION_SENTINEL';

void approvedCode;
void futureExtensionCode;
