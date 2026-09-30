const { Readable } = require("node:stream");
const { assertBodyAvailable, extractWebBodyStream, claimBodyStream, isBlobBody, isNodeStreamBody, isWebStreamBody, isStreamBody } = require('../utils/request-body.cjs');
function assertNodeBodyAvailable(body, config, request) {
  assertBodyAvailable(body, config, request, isStreamBody(body) && Readable.isDisturbed(body));
}
function claimNodeBodyStream(body, config, request) {
  assertNodeBodyAvailable(body, config, request);
  claimBodyStream(body, config, request);
  return isWebStreamBody(body) ? extractWebBodyStream(body, config, request) : body;
}
function nodeRequestBodyStream(body) {
  if (isBlobBody(body))
    return Readable.fromWeb(body.stream());
  if (isWebStreamBody(body)) {
    return Readable.fromWeb(body);
  }
  if (isNodeStreamBody(body)) {
    return body;
  }
  return;
}
function pipeRequestBody(source, target, fail = (error) => {
  target.destroy(error);
}) {
  let cleaned = false;
  const onError = (error) => fail(error);
  const onSourceClose = () => {
    if (!source.readableEnded && !target.destroyed) {
      fail(Object.assign(new Error("Request body stream closed before its end"), { code: "ERR_STREAM_PREMATURE_CLOSE" }));
    }
  };
  const cleanup = () => {
    if (cleaned)
      return;
    cleaned = true;
    source.unpipe(target);
    source.off("close", onSourceClose);
    target.off("close", cleanup);
    target.off("end", onResponseEnd);
    if (!source.destroyed)
      source.destroy();
    if (source.closed)
      source.off("error", onError);
    else
      source.once("close", () => source.off("error", onError));
  };
  const onResponseEnd = () => {
    cleanup();
    if (!target.destroyed && !target.writableEnded)
      target.end();
  };
  source.once("error", onError);
  source.once("close", onSourceClose);
  target.once("close", cleanup);
  target.once("end", onResponseEnd);
  source.pipe(target);
  return cleanup;
}

exports.assertNodeBodyAvailable = assertNodeBodyAvailable;
exports.claimNodeBodyStream = claimNodeBodyStream;
exports.nodeRequestBodyStream = nodeRequestBodyStream;
exports.pipeRequestBody = pipeRequestBody;