export var HttpStatusCode;
((HttpStatusCode) => {
  HttpStatusCode[HttpStatusCode["Continue"] = 100] = "Continue";
  HttpStatusCode[HttpStatusCode["SwitchingProtocols"] = 101] = "SwitchingProtocols";
  HttpStatusCode[HttpStatusCode["Processing"] = 102] = "Processing";
  HttpStatusCode[HttpStatusCode["EarlyHints"] = 103] = "EarlyHints";
  HttpStatusCode[HttpStatusCode["Ok"] = 200] = "Ok";
  HttpStatusCode[HttpStatusCode["Created"] = 201] = "Created";
  HttpStatusCode[HttpStatusCode["Accepted"] = 202] = "Accepted";
  HttpStatusCode[HttpStatusCode["NonAuthoritativeInformation"] = 203] = "NonAuthoritativeInformation";
  HttpStatusCode[HttpStatusCode["NoContent"] = 204] = "NoContent";
  HttpStatusCode[HttpStatusCode["ResetContent"] = 205] = "ResetContent";
  HttpStatusCode[HttpStatusCode["PartialContent"] = 206] = "PartialContent";
  HttpStatusCode[HttpStatusCode["MultiStatus"] = 207] = "MultiStatus";
  HttpStatusCode[HttpStatusCode["AlreadyReported"] = 208] = "AlreadyReported";
  HttpStatusCode[HttpStatusCode["ImUsed"] = 226] = "ImUsed";
  HttpStatusCode[HttpStatusCode["MultipleChoices"] = 300] = "MultipleChoices";
  HttpStatusCode[HttpStatusCode["MovedPermanently"] = 301] = "MovedPermanently";
  HttpStatusCode[HttpStatusCode["Found"] = 302] = "Found";
  HttpStatusCode[HttpStatusCode["SeeOther"] = 303] = "SeeOther";
  HttpStatusCode[HttpStatusCode["NotModified"] = 304] = "NotModified";
  HttpStatusCode[HttpStatusCode["UseProxy"] = 305] = "UseProxy";
  HttpStatusCode[HttpStatusCode["Unused"] = 306] = "Unused";
  HttpStatusCode[HttpStatusCode["TemporaryRedirect"] = 307] = "TemporaryRedirect";
  HttpStatusCode[HttpStatusCode["PermanentRedirect"] = 308] = "PermanentRedirect";
  HttpStatusCode[HttpStatusCode["BadRequest"] = 400] = "BadRequest";
  HttpStatusCode[HttpStatusCode["Unauthorized"] = 401] = "Unauthorized";
  HttpStatusCode[HttpStatusCode["PaymentRequired"] = 402] = "PaymentRequired";
  HttpStatusCode[HttpStatusCode["Forbidden"] = 403] = "Forbidden";
  HttpStatusCode[HttpStatusCode["NotFound"] = 404] = "NotFound";
  HttpStatusCode[HttpStatusCode["MethodNotAllowed"] = 405] = "MethodNotAllowed";
  HttpStatusCode[HttpStatusCode["NotAcceptable"] = 406] = "NotAcceptable";
  HttpStatusCode[HttpStatusCode["ProxyAuthenticationRequired"] = 407] = "ProxyAuthenticationRequired";
  HttpStatusCode[HttpStatusCode["RequestTimeout"] = 408] = "RequestTimeout";
  HttpStatusCode[HttpStatusCode["Conflict"] = 409] = "Conflict";
  HttpStatusCode[HttpStatusCode["Gone"] = 410] = "Gone";
  HttpStatusCode[HttpStatusCode["LengthRequired"] = 411] = "LengthRequired";
  HttpStatusCode[HttpStatusCode["PreconditionFailed"] = 412] = "PreconditionFailed";
  HttpStatusCode[HttpStatusCode["PayloadTooLarge"] = 413] = "PayloadTooLarge";
  HttpStatusCode[HttpStatusCode["UriTooLong"] = 414] = "UriTooLong";
  HttpStatusCode[HttpStatusCode["UnsupportedMediaType"] = 415] = "UnsupportedMediaType";
  HttpStatusCode[HttpStatusCode["RangeNotSatisfiable"] = 416] = "RangeNotSatisfiable";
  HttpStatusCode[HttpStatusCode["ExpectationFailed"] = 417] = "ExpectationFailed";
  HttpStatusCode[HttpStatusCode["ImATeapot"] = 418] = "ImATeapot";
  HttpStatusCode[HttpStatusCode["MisdirectedRequest"] = 421] = "MisdirectedRequest";
  HttpStatusCode[HttpStatusCode["UnprocessableEntity"] = 422] = "UnprocessableEntity";
  HttpStatusCode[HttpStatusCode["Locked"] = 423] = "Locked";
  HttpStatusCode[HttpStatusCode["FailedDependency"] = 424] = "FailedDependency";
  HttpStatusCode[HttpStatusCode["TooEarly"] = 425] = "TooEarly";
  HttpStatusCode[HttpStatusCode["UpgradeRequired"] = 426] = "UpgradeRequired";
  HttpStatusCode[HttpStatusCode["PreconditionRequired"] = 428] = "PreconditionRequired";
  HttpStatusCode[HttpStatusCode["TooManyRequests"] = 429] = "TooManyRequests";
  HttpStatusCode[HttpStatusCode["RequestHeaderFieldsTooLarge"] = 431] = "RequestHeaderFieldsTooLarge";
  HttpStatusCode[HttpStatusCode["UnavailableForLegalReasons"] = 451] = "UnavailableForLegalReasons";
  HttpStatusCode[HttpStatusCode["InternalServerError"] = 500] = "InternalServerError";
  HttpStatusCode[HttpStatusCode["NotImplemented"] = 501] = "NotImplemented";
  HttpStatusCode[HttpStatusCode["BadGateway"] = 502] = "BadGateway";
  HttpStatusCode[HttpStatusCode["ServiceUnavailable"] = 503] = "ServiceUnavailable";
  HttpStatusCode[HttpStatusCode["GatewayTimeout"] = 504] = "GatewayTimeout";
  HttpStatusCode[HttpStatusCode["HttpVersionNotSupported"] = 505] = "HttpVersionNotSupported";
  HttpStatusCode[HttpStatusCode["VariantAlsoNegotiates"] = 506] = "VariantAlsoNegotiates";
  HttpStatusCode[HttpStatusCode["InsufficientStorage"] = 507] = "InsufficientStorage";
  HttpStatusCode[HttpStatusCode["LoopDetected"] = 508] = "LoopDetected";
  HttpStatusCode[HttpStatusCode["NotExtended"] = 510] = "NotExtended";
  HttpStatusCode[HttpStatusCode["NetworkAuthenticationRequired"] = 511] = "NetworkAuthenticationRequired";
})(HttpStatusCode ||= {});
export const RezoStatusCodes = {
  100: "Continue",
  101: "Switching Protocols",
  102: "Processing",
  103: "Early Hints",
  200: "OK",
  201: "Created",
  202: "Accepted",
  203: "Non-Authoritative Information",
  204: "No Content",
  205: "Reset Content",
  206: "Partial Content",
  207: "Multi-Status",
  208: "Already Reported",
  226: "IM Used",
  300: "Multiple Choices",
  301: "Moved Permanently",
  302: "Found",
  303: "See Other",
  304: "Not Modified",
  305: "Use Proxy",
  306: "Switch Proxy",
  307: "Temporary Redirect",
  308: "Permanent Redirect",
  400: "Bad Request",
  401: "Unauthorized",
  402: "Payment Required",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed",
  406: "Not Acceptable",
  407: "Proxy Authentication Required",
  408: "Request Timeout",
  409: "Conflict",
  410: "Gone",
  411: "Length Required",
  412: "Precondition Failed",
  413: "Payload Too Large",
  414: "URI Too Long",
  415: "Unsupported Media Type",
  416: "Range Not Satisfiable",
  417: "Expectation Failed",
  418: "I'm a Teapot",
  421: "Misdirected Request",
  422: "Unprocessable Entity",
  423: "Locked",
  424: "Failed Dependency",
  425: "Too Early",
  426: "Upgrade Required",
  428: "Precondition Required",
  429: "Too Many Requests",
  431: "Request Header Fields Too Large",
  451: "Unavailable For Legal Reasons",
  500: "Internal Server Error",
  501: "Not Implemented",
  502: "Bad Gateway",
  503: "Service Unavailable",
  504: "Gateway Timeout",
  505: "HTTP Version Not Supported",
  506: "Variant Also Negotiates",
  507: "Insufficient Storage",
  508: "Loop Detected",
  510: "Not Extended",
  511: "Network Authentication Required"
};
