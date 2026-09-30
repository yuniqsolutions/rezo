const { RezoFormData } = require('../utils/form-data.cjs');
async function encodeMultipartBody(body) {
  const form = body instanceof RezoFormData ? body.toNativeFormData() : body;
  const response = new Response(form);
  const contentType = response.headers.get("content-type");
  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    contentType
  };
}

exports.encodeMultipartBody = encodeMultipartBody;